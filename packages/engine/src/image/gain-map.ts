// XMP about an HDR gain map: the one block of metadata a clean copy keeps
// on purpose, since a gain map is drawn by it. It's kept only when it says
// nothing but a gain map's own values, and then it isn't kept as it was:
// it's written anew from those values alone, so nothing else in the
// packet (its layout, its spacing, a namespace, a toolkit's name) can
// come along.
//
// A packet passes only when it's made of exactly these, and nothing more:
// - an xpacket wrapper (its fixed form), x:xmpmeta with a toolkit name
//   such as "XMP Core 6.0.0", rdf:RDF, and rdf:Description with
//   rdf:about="";
// - namespace declarations for those and the two gain map namespaces;
// - Apple's HDRGainMap values (its version and headroom) and Adobe's
//   hdrgm values (version, gain map range, gamma, offsets, HDR capacity,
//   and which rendition is HDR), each at most once, as an attribute or an
//   element; a per-channel list (rdf:Seq of rdf:li) where Adobe allows
//   one;
// - each value a plain number, or True or False where Adobe's is a yes
//   or no;
// - spaces and line breaks between tags.
// Anything else (another namespace or name, an attribute RDF doesn't
// need, text, a comment, CDATA, a processing instruction, a character
// reference) and the packet counts as the photo's own XMP: blanked.

const NS = {
  x: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  apple: "http://ns.apple.com/HDRGainMap/1.0/",
  adobe: "http://ns.adobe.com/hdr-gain-map/1.0/",
};
const KNOWN_NS = new Set(Object.values(NS));
// The prefixes the packet is written with.
const PREFIX: Record<string, string> = {
  [NS.apple]: "HDRGainMap",
  [NS.adobe]: "hdrgm",
};

// Each gain map value: whether it can be a per-channel list, and whether
// it's a yes or no rather than a number.
const VALUES: Record<string, Record<string, { list?: true; yesNo?: true }>> = {
  [NS.apple]: { HDRGainMapVersion: {}, HDRGainMapHeadroom: {} },
  [NS.adobe]: {
    Version: {},
    GainMapMin: { list: true },
    GainMapMax: { list: true },
    Gamma: { list: true },
    OffsetSDR: { list: true },
    OffsetHDR: { list: true },
    HDRCapacityMin: {},
    HDRCapacityMax: {},
    BaseRenditionIsHDR: { yesNo: true },
  },
};

const NUMBER = /^-?\d{1,12}(\.\d{1,12})?$/;
const YES_NO = /^(True|False)$/;
const TOOLKIT = /^(Adobe )?XMP Core [\d.]{1,16}$/;
const SPACE = /^[ \t\r\n]*$/;
/** A byte order mark, which may open a packet and its xpacket wrapper. */
const BOM = String.fromCharCode(0xfeff);
const XPACKET_BEGIN = new RegExp(
  String.raw`^${BOM}?<\?xpacket begin=(["'])${BOM}?\1 id=(["'])W5M0MpCehiHzreSzNTczkc9d\2\?>`,
);
const XPACKET_END = /<\?xpacket end=(["'])[rw]\1\?>[ \t\r\n\0]*$/;
/** The longest packet looked at: a gain map's is a few hundred bytes. */
const LONGEST = 16_384;

export interface Element {
  prefix: string;
  local: string;
  attributes: [string, string][];
  children: Element[];
  text: string;
}

class Refused extends Error {}
function refuse(): never {
  throw new Refused();
}

/** The packet's one root element, read with a deliberately small XML: tags,
 * attributes in quotes, plain text. Anything else is refused. */
function parse(xml: string): Element {
  let at = 0;
  const spaces = () => {
    while (at < xml.length && " \t\r\n".includes(xml[at] ?? "")) at++;
  };
  const name = () => {
    const m = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?/.exec(xml.slice(at));
    if (!m) return refuse();
    at += m[0].length;
    return m[0];
  };
  const element = (depth: number): Element => {
    if (depth > 8 || xml[at] !== "<") return refuse();
    at++;
    const tag = name();
    const [prefix = "", local = ""] = tag.split(":");
    if (!tag.includes(":")) refuse();
    const attributes: [string, string][] = [];
    for (;;) {
      const before = at;
      spaces();
      if (xml.startsWith("/>", at)) {
        at += 2;
        return { prefix, local, attributes, children: [], text: "" };
      }
      if (xml[at] === ">") {
        at++;
        break;
      }
      if (at === before) refuse(); // attributes are set apart by spaces
      const key = name();
      spaces();
      if (xml[at] !== "=") refuse();
      at++;
      spaces();
      const quote = xml[at];
      if (quote !== '"' && quote !== "'") return refuse();
      const end = xml.indexOf(quote, at + 1);
      if (end < 0) refuse();
      const value = xml.slice(at + 1, end);
      if (/[<&]/.test(value)) refuse();
      at = end + 1;
      attributes.push([key, value]);
    }
    const children: Element[] = [];
    let text = "";
    for (;;) {
      const next = xml.indexOf("<", at);
      if (next < 0) refuse();
      const between = xml.slice(at, next);
      at = next;
      if (xml.startsWith("</", at)) {
        // Text only on its own, never beside other elements.
        if (children.length) {
          if (!SPACE.test(between)) refuse();
        } else text = between;
        at += 2;
        if (name() !== tag) refuse();
        spaces();
        if (xml[at] !== ">") refuse();
        at++;
        return { prefix, local, attributes, children, text };
      }
      if (!SPACE.test(between) || "?!".includes(xml[at + 1] ?? "")) refuse();
      children.push(element(depth + 1));
    }
  };
  spaces();
  const root = element(0);
  spaces();
  if (at !== xml.length) refuse();
  return root;
}

interface Value {
  ns: string;
  local: string;
  /** One value, or a per-channel list. */
  values: string[];
  list: boolean;
  /** Written as an attribute (on the description), not an element. */
  attribute: boolean;
}

/** The gain map values in a parsed packet; refuses anything else. */
function values(root: Element): Value[] {
  // Every prefix declared, wherever; one prefix can't mean two things.
  const prefixes = new Map<string, string>();
  const declare = (e: Element) => {
    for (const [key, value] of e.attributes) {
      if (key === "xmlns") refuse();
      if (!key.startsWith("xmlns:")) continue;
      if (!KNOWN_NS.has(value)) refuse();
      const prefix = key.slice(6);
      if ((prefixes.get(prefix) ?? value) !== value) refuse();
      prefixes.set(prefix, value);
    }
    e.children.forEach(declare);
  };
  declare(root);
  const nsOf = (qualified: string) => {
    const [prefix = "", local = ""] = qualified.split(":");
    const ns = prefixes.get(prefix) ?? refuse();
    return { ns, local };
  };
  const is = (e: Element, ns: string, local: string) =>
    nsOf(`${e.prefix}:${e.local}`).ns === ns && e.local === local;
  /** Its attributes other than namespace declarations. */
  const own = (e: Element) =>
    e.attributes.filter(([key]) => !key.startsWith("xmlns:"));
  const noText = (e: Element) => {
    if (!SPACE.test(e.text)) refuse();
  };

  const out: Value[] = [];
  const add = (
    { ns, local }: { ns: string; local: string },
    found: string[],
    list: boolean,
    attribute: boolean,
  ) => {
    const rule = VALUES[ns]?.[local] ?? refuse();
    if (list && !rule.list) refuse();
    const shape = rule.yesNo ? YES_NO : NUMBER;
    if (!found.length || !found.every((v) => shape.test(v))) refuse();
    if (out.some((v) => v.ns === ns && v.local === local)) refuse();
    out.push({ ns, local, values: found, list, attribute });
  };

  let rdf = root;
  if (is(root, NS.x, "xmpmeta")) {
    for (const [key, value] of own(root)) {
      const { ns, local } = nsOf(key);
      if (ns !== NS.x || local !== "xmptk" || !TOOLKIT.test(value)) refuse();
    }
    noText(root);
    if (root.children.length !== 1) refuse();
    rdf = root.children[0] ?? refuse();
  }
  if (!is(rdf, NS.rdf, "RDF") || own(rdf).length) refuse();
  noText(rdf);
  for (const description of rdf.children) {
    if (!is(description, NS.rdf, "Description")) refuse();
    noText(description);
    for (const [key, value] of own(description)) {
      const name = nsOf(key);
      if (name.ns === NS.rdf && name.local === "about") {
        if (value !== "") refuse();
      } else add(name, [value.trim()], false, true);
    }
    for (const property of description.children) {
      if (own(property).length) refuse();
      const name = nsOf(`${property.prefix}:${property.local}`);
      if (!property.children.length) {
        add(name, [property.text.trim()], false, false);
        continue;
      }
      noText(property);
      const [seq, ...more] = property.children;
      if (!seq || more.length || !is(seq, NS.rdf, "Seq") || own(seq).length) {
        refuse();
      }
      noText(seq);
      if (seq.children.length > 4) refuse();
      const items = seq.children.map((li) => {
        if (!is(li, NS.rdf, "li") || own(li).length || li.children.length) {
          refuse();
        }
        return li.text.trim();
      });
      add(name, items, true, false);
    }
  }
  if (!out.length) refuse();
  return out;
}

/** The packet written from these values alone. */
function write(found: Value[]): string {
  const used = [NS.apple, NS.adobe].filter((ns) =>
    found.some((v) => v.ns === ns),
  );
  const q = (v: Value) => `${PREFIX[v.ns] ?? ""}:${v.local}`;
  const declarations = used
    .map((ns) => ` xmlns:${PREFIX[ns] ?? ""}="${ns}"`)
    .join("");
  const attributes = found
    .filter((v) => v.attribute)
    .map((v) => ` ${q(v)}="${v.values[0] ?? ""}"`)
    .join("");
  const elements = found
    .filter((v) => !v.attribute)
    .map((v) => {
      const inner = v.list
        ? `<rdf:Seq>${v.values.map((x) => `<rdf:li>${x}</rdf:li>`).join("")}</rdf:Seq>`
        : (v.values[0] ?? "");
      return `<${q(v)}>${inner}</${q(v)}>`;
    })
    .join("");
  const description = `<rdf:Description rdf:about=""${declarations}${attributes}`;
  return (
    `<x:xmpmeta xmlns:x="${NS.x}"><rdf:RDF xmlns:rdf="${NS.rdf}">` +
    (elements
      ? `${description}>${elements}</rdf:Description>`
      : `${description}/>`) +
    `</rdf:RDF></x:xmpmeta>`
  );
}

/** A packet's root element, read with the small XML above: its xpacket
 * wrapper (in its fixed form) and trailing zeros set aside. Null when it
 * isn't UTF-8, is longer than a few small packets, or holds anything that
 * small XML refuses. */
export function smallXmp(packet: Uint8Array): Element | null {
  if (packet.length > LONGEST) return null;
  try {
    let xml = new TextDecoder("utf-8", { fatal: true }).decode(packet);
    const begin = XPACKET_BEGIN.exec(xml);
    if (begin) {
      xml = xml.slice(begin[0].length);
      const end = XPACKET_END.exec(xml);
      if (!end) return null;
      xml = xml.slice(0, end.index);
    } else xml = xml.replace(/\0+$/, "");
    if (xml.includes(BOM)) return null;
    return parse(xml);
  } catch (error) {
    if (error instanceof Refused || error instanceof TypeError) return null;
    throw error;
  }
}

/** A gain map's XMP packet written anew from its values alone, padded with
 * spaces to the packet's length; null when the packet holds anything but
 * a gain map's values, or the new one wouldn't fit in its place. */
export function gainMapPacket(packet: Uint8Array): Uint8Array | null {
  const root = smallXmp(packet);
  if (!root) return null;
  try {
    const written = new TextEncoder().encode(write(values(root)));
    if (written.length > packet.length) return null;
    const out = new Uint8Array(packet.length).fill(0x20);
    out.set(written);
    return out;
  } catch (error) {
    if (error instanceof Refused) return null;
    throw error;
  }
}
