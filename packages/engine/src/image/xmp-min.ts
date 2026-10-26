// The one XMP field a clean copy keeps when labels are kept: IPTC's
// DigitalSourceType, the field that says how the picture was made (by a
// camera, by an AI). Nothing else: no IDs, no tool, no dates, not even an
// xpacket wrapper.

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
