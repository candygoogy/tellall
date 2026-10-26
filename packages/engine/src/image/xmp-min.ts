// The one XMP field a clean copy keeps when labels are kept: IPTC's
// DigitalSourceType, the field that says how the picture was made (by a
// camera, by an AI). Nothing else: no IDs, no tool, no dates, not even an
// xpacket wrapper.
import { smallXmp, type Element } from "./gain-map.ts";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** An x:xmpmeta packet holding only Iptc4xmpExt:DigitalSourceType. */
export function minimalXmp(digitalSourceType: string): string {
  const value = digitalSourceType.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
  return (
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
    '<rdf:Description rdf:about="" ' +
    'xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">' +
    `<Iptc4xmpExt:DigitalSourceType>${value}</Iptc4xmpExt:DigitalSourceType>` +
    "</rdf:Description></rdf:RDF></x:xmpmeta>"
  );
}

/** The packet as bytes (UTF-8, as XMP is stored). */
export const minimalXmpBytes = (digitalSourceType: string) =>
  new TextEncoder().encode(minimalXmp(digitalSourceType));

const NS = {
  x: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  iptc: "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
};
const KNOWN_NS = new Set(Object.values(NS));
/** An IPTC source type, as the URI IPTC gives each one. */
const SOURCE_URI =
  /^https?:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/[A-Za-z]{1,64}$/;
const TOOLKIT = /^(Adobe )?XMP Core [\d.]{1,16}$/;
const SPACE = /^[ \t\r\n]*$/;

/** The source type a packet holds when it holds nothing else: x:xmpmeta
 * (with at most a toolkit's name), rdf:RDF, descriptions about the file
 * itself, and one Iptc4xmpExt:DigitalSourceType that's one of IPTC's
 * URIs, as an attribute, an element or a resource; an xpacket wrapper and
 * spaces around them. Null for anything else: such a packet is the
 * photo's own XMP, and a clean copy writes the minimal one instead. */
export function sourceOnly(packet: Uint8Array): string | null {
  const root = smallXmp(packet);
  if (!root) return null;
  const prefixes = new Map<string, string>();
  let ok = true;
  const declare = (e: Element) => {
    for (const [key, value] of e.attributes) {
      if (key === "xmlns") ok = false;
      if (!key.startsWith("xmlns:")) continue;
      const prefix = key.slice(6);
      if (!KNOWN_NS.has(value) || (prefixes.get(prefix) ?? value) !== value) {
        ok = false;
      }
      prefixes.set(prefix, value);
    }
    e.children.forEach(declare);
  };
  declare(root);
  if (!ok) return null;
  const name = (qualified: string) => {
    const [prefix = "", local = ""] = qualified.split(":");
    return `${prefixes.get(prefix) ?? "?"}${local}`;
  };
  const is = (e: Element, ns: string, local: string) =>
    name(`${e.prefix}:${e.local}`) === ns + local;
  const own = (e: Element) =>
    e.attributes.filter(([key]) => !key.startsWith("xmlns:"));
  const SOURCE = `${NS.iptc}DigitalSourceType`;

  let rdf = root;
  if (is(root, NS.x, "xmpmeta")) {
    for (const [key, value] of own(root)) {
      if (name(key) !== `${NS.x}xmptk` || !TOOLKIT.test(value)) return null;
    }
    if (!SPACE.test(root.text) || root.children.length !== 1) return null;
    rdf = root.children[0] ?? root;
  }
  if (!is(rdf, NS.rdf, "RDF") || own(rdf).length || !SPACE.test(rdf.text)) {
    return null;
  }
  const found: string[] = [];
  for (const d of rdf.children) {
    if (!is(d, NS.rdf, "Description") || !SPACE.test(d.text)) return null;
    for (const [key, value] of own(d)) {
      const n = name(key);
      if (n === `${NS.rdf}about`) {
        if (value !== "") return null;
      } else if (n === SOURCE) found.push(value.trim());
      else return null;
    }
    for (const p of d.children) {
      if (name(`${p.prefix}:${p.local}`) !== SOURCE || p.children.length) {
        return null;
      }
      const attrs = own(p);
      if (!attrs.length) found.push(p.text.trim());
      else {
        const [[key = "", value = ""] = [], ...more] = attrs;
        if (more.length || name(key) !== `${NS.rdf}resource`) return null;
        if (!SPACE.test(p.text)) return null;
        found.push(value.trim());
      }
    }
  }
  const [only, ...others] = found;
  return only !== undefined && !others.length && SOURCE_URI.test(only)
    ? only
    : null;
}
