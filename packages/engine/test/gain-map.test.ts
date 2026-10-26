// XMP about an HDR gain map is the one piece of metadata a clean copy
// keeps on purpose. It's kept only when it holds nothing but a gain map's
// own values (Apple's or Adobe's, numbers), and then it's written anew
// from those values alone. Anything else in it, and it's blanked like the
// photo's own XMP: a lost HDR look, never a leak.
import { describe, expect, test } from "vitest";
import { gainMapPacket } from "../src/image/gain-map.ts";
import { heifMeta, itemBytes, heifLayout } from "../src/image/heif.ts";
import { readImage } from "../src/image/read.ts";
import { stripHeic } from "../src/image/strip/index.ts";
import { box, heic, HELPER, PICTURES, u16 } from "./craft.ts";
import { leaks, text } from "./forge.ts";

const BOM = String.fromCharCode(0xfeff);
/** A packet's bytes, as UTF-8. */
const bytes = (s: string) => [...Buffer.from(s, "utf8")];
const RDF = `xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"`;
const APPLE = `xmlns:HDRGainMap="http://ns.apple.com/HDRGainMap/1.0/"`;
const ADOBE = `xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/"`;

/** A packet the way Apple writes it, with this inside its description. */
const apple = (
  inside: string,
  { xmptk = "XMP Core 6.0.0", about = `rdf:about=""`, extra = "" } = {},
) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${xmptk}">\n <rdf:RDF ${RDF}>\n  <rdf:Description ${about} ${APPLE}${extra}>\n   ${inside}\n  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>`;
const VERSION = `<HDRGainMap:HDRGainMapVersion>131072</HDRGainMap:HDRGainMapVersion>`;
const HEADROOM = `<HDRGainMap:HDRGainMapHeadroom>2.85</HDRGainMap:HDRGainMapHeadroom>`;

/** The packet as a helper picture's XMP in a HEIC: the main picture, its
 * gain map, and this packet describing the gain map. */
const withPacket = (packet: string) =>
  heic(
    [...PICTURES, { id: 4, type: "xmp", payload: bytes(packet) }],
    [HELPER, box("cdsc", u16(4), u16(1), u16(2))],
  );

const packetOf = (b: Uint8Array) => {
  const item = heifLayout(b).items.find((x) => x.id === 4);
  if (!item) throw new Error("no XMP item");
  return text(itemBytes(b, item));
};

describe("a gain map's own XMP", () => {
  test("Apple's: kept, written anew with only its values", async () => {
    const packet = `<?xpacket begin="${BOM}" id="W5M0MpCehiHzreSzNTczkc9d"?>${apple(`${VERSION}\n   ${HEADROOM}`)}<?xpacket end="w"?>`;
    const file = withPacket(packet);
    expect(heifMeta(file).xmp).toEqual([]);
    const out = stripHeic(file, 1);
    const kept = packetOf(out);
    expect(kept.trimEnd()).toBe(
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ${RDF}><rdf:Description rdf:about="" ${APPLE}>${VERSION}${HEADROOM}</rdf:Description></rdf:RDF></x:xmpmeta>`,
    );
    // The same length, padded with spaces: nothing in the file moves.
    expect(kept.length).toBe(bytes(packet).length);
    expect(/^ *$/.test(kept.slice(kept.trimEnd().length))).toBe(true);
    expect(await readImage(out, "heic")).toBeUndefined();
  });

  test("Adobe's, as attributes and per-channel lists: kept as written", () => {
    const packet = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ${RDF}><rdf:Description rdf:about="" ${ADOBE} hdrgm:Version="1.0" hdrgm:BaseRenditionIsHDR="False" hdrgm:HDRCapacityMax="2.3"><hdrgm:GainMapMax><rdf:Seq><rdf:li>2.1</rdf:li><rdf:li>2.2</rdf:li><rdf:li>-0.5</rdf:li></rdf:Seq></hdrgm:GainMapMax></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const out = gainMapPacket(new Uint8Array(bytes(packet)));
    expect(out && text(out)).toBe(packet);
  });
});

describe("XMP that only looks like a gain map's is blanked, and read", () => {
  test.each([
    [
      "names under the gain map's prefix that it doesn't use",
      apple(
        `${VERSION}<HDRGainMap:GPSLatitude>51.50072</HDRGainMap:GPSLatitude><HDRGainMap:Owner>LEAK_Jane_Doe</HDRGainMap:Owner>`,
      ),
    ],
    [
      "a processing instruction",
      apple(`<?LEAK-PI Jane Doe, 51.5007 N, 0.1246 W?>${VERSION}`),
    ],
    [
      "words inside a tag",
      apple(
        `<HDRGainMap:HDRGainMapVersion LEAK-TAGJUNK Jane Doe lives at 1 Main St>131072</HDRGainMap:HDRGainMapVersion>`,
      ),
    ],
    [
      "a toolkit name with words in it",
      apple(VERSION, { xmptk: "LEAK Jane Doe, 51.50 (0.12)" }),
    ],
    [
      "an RDF attribute",
      apple(
        `<HDRGainMap:HDRGainMapVersion rdf:resource="LEAK_rdf">131072</HDRGainMap:HDRGainMapVersion>`,
      ),
    ],
    [
      "a namespace nothing uses",
      apple(VERSION, { extra: ` xmlns:a="http://LEAK.example/51.5007/"` }),
    ],
    ["a comment", apple(`<!-- LEAK-COMMENT -->${VERSION}`)],
    ["CDATA", apple(`${VERSION}<![CDATA[LEAK-CDATA]]>`)],
    ["text beside the values", apple(`${VERSION} LEAK-TEXT`)],
    [
      "an attribute on the description",
      apple(VERSION, { extra: ` rdf:ID="LEAK-ID"` }),
    ],
    [
      "a description about something",
      apple(VERSION, { about: `rdf:about="LEAK"` }),
    ],
    [
      "a language on a value",
      apple(
        `<HDRGainMap:HDRGainMapVersion xml:lang="LEAK">131072</HDRGainMap:HDRGainMapVersion>`,
      ),
    ],
    [
      "a character reference",
      apple(
        `<HDRGainMap:HDRGainMapVersion>&#76;EAK</HDRGainMap:HDRGainMapVersion>`,
      ),
    ],
    [
      "a value that isn't a number",
      apple(
        `<HDRGainMap:HDRGainMapVersion>LEAK</HDRGainMap:HDRGainMapVersion>`,
      ),
    ],
    [
      "a value given twice",
      apple(
        `${VERSION}<HDRGainMap:HDRGainMapVersion>4242</HDRGainMap:HDRGainMapVersion>`,
      ),
    ],
    [
      "another namespace's value",
      apple(VERSION, {
        extra: ` xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="LEAK"`,
      }),
    ],
    [
      "a default namespace",
      apple(VERSION, { extra: ` xmlns="http://LEAK.example/"` }),
    ],
    ["no gain map values at all", apple(`<!--LEAK-->`)],
  ])("%s", async (_name, packet) => {
    const file = withPacket(packet);
    expect(gainMapPacket(new Uint8Array(bytes(packet)))).toBeNull();
    // It's the photo's XMP now: read like any other, then blanked.
    expect(heifMeta(file).xmp.map((x) => x.id)).toEqual([4]);
    const out = stripHeic(file, 1);
    expect(leaks(out)).toBe(false);
    expect(/^ *$/.test(packetOf(out))).toBe(true);
  });

  test("a gain map's XMP about a picture nobody draws is blanked too", () => {
    // Item 2 is the helper of item 3, a picture the main one never uses.
    const file = heic(
      [
        ...PICTURES,
        { id: 3, type: "hvc1", payload: [0x55, 0x55, 0x55, 0x55] },
        { id: 4, type: "xmp", payload: bytes(apple(VERSION)) },
      ],
      [
        box("auxl", u16(2), u16(1), u16(3)),
        box("cdsc", u16(4), u16(1), u16(2)),
      ],
    );
    expect(/^ *$/.test(packetOf(stripHeic(file, 1)))).toBe(true);
  });
});
