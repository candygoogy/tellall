// What counts as the AI label, and what the label itself holds: only a
// C2PA manifest store's JUMBF is the label (other JUMBF is metadata, and
// goes); a label's metadata assertions (stds.exif and the like) are read
// into findings; "No location, camera or other personal data" is said
// only of a label that was read.
import { readFileSync } from "node:fs";
import { DescriptionBox, JSONBox, SuperBox } from "@trustnxt/c2pa-ts/jumbf";
import { expect, test } from "vitest";
import { clean, inspect, words as en } from "../src/index.ts";
import { crc32 } from "../src/image/crc32.ts";
import { cleanImage } from "../src/image/strip/index.ts";
import { segments } from "../src/image/strip/jpeg.ts";
import { ascii, segment, u32 } from "./forge.ts";

const ROOT = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) =>
  new Uint8Array(readFileSync(new URL(path, ROOT)));
const file = (bytes: Uint8Array) =>
  ({ kind: "file", name: "x", bytes }) as const;
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(s);

/** clean.jpg or gps.jpg with these segments right after its SOI. */
const jpegWith = (base: Uint8Array, ...parts: number[][]) =>
  new Uint8Array([
    ...base.subarray(0, 2),
    ...parts.flat(),
    ...base.subarray(2),
  ]);

test("JUMBF that isn't a C2PA manifest store is metadata, not the label", async () => {
  const notC2pa = segment(0xeb, [
    ...ascii("JP"),
    0,
    1,
    0,
    0,
    0,
    1,
    ...u32(40),
    ...ascii("jumb"),
    ...u32(32),
    ...ascii("jumdLEAK-GPS-51.48N owner Jane"),
  ]);
  const b = jpegWith(fixture("photo/gps.jpg"), notC2pa);
  const out = cleanImage(b, "jpeg", 1, { keepLabels: true });
  expect(has(out, "LEAK")).toBe(false);
  expect(segments(out).list.some((s) => s.marker === 0xeb)).toBe(false);
  // The real thing stays: Gemini's label, byte for byte.
  const gemini = fixture("ai/gemini-image.jpg");
  const kept = cleanImage(gemini, "jpeg", 1, { keepLabels: true });
  const labels = (x: Uint8Array) =>
    segments(x)
      .list.filter((s) => s.marker === 0xeb)
      .map((s) => Buffer.from(x.subarray(s.start, s.end)).toString("hex"));
  expect(labels(kept)).toEqual(labels(gemini));
  expect(labels(gemini).length).toBeGreaterThan(0);
});

test("a label that can't be read isn't said to hold nothing", async () => {
  // Found as a C2PA label (its first box says c2pa), but unreadable.
  const broken = segment(0xeb, [
    ...ascii("JP"),
    0,
    1,
    0,
    0,
    0,
    1,
    ...u32(200),
    ...ascii("jumb"),
    ...u32(30),
    ...ascii("jumdc2pa"),
    ...new Array(18).fill(0),
    ...ascii("stds.exif exif:GPSLatitude=51,28.614N"),
  ]);
  const report = await inspect(
    file(jpegWith(fixture("photo/clean.jpg"), broken)),
  );
  const said = report.findings.map((f) => f.sentence);
  expect(said).toContain(en.label.damaged);
  expect(said).not.toContain(en.label.nothingElse);
  // A label that was read, with nothing else in the file, still says it.
  const chatgpt = await inspect(file(fixture("ai/chatgpt-image.png")));
  expect(chatgpt.findings.map((f) => f.sentence)).toContain(
    en.label.nothingElse,
  );
});

/** ChatGPT's PNG with a stds.exif assertion added to its label: a place
 * and a camera, as a camera that signs its photos would write them. */
function labelWithExif(): Uint8Array {
  const png = fixture("ai/chatgpt-image.png");
  // The caBX chunk (c2pa.test.ts: offset 33, 21,893 bytes).
  const start = 33;
  const length = new DataView(png.buffer, png.byteOffset).getUint32(start);
  const store = SuperBox.fromBuffer(
    png.subarray(start + 8, start + 8 + length),
  );
  const assertions = store.contentBoxes
    .filter((b): b is SuperBox => b instanceof SuperBox)
    .at(-1)
    ?.contentBoxes.filter((b): b is SuperBox => b instanceof SuperBox)
    .find((b) => b.descriptionBox?.label === "c2pa.assertions");
  if (!assertions) throw new Error("no assertion store");
  const exif = new SuperBox();
  exif.descriptionBox = new DescriptionBox();
  // JSON content type: 6A736F6E-0011-0010-8000-00AA00389B71.
  exif.descriptionBox.uuid = new Uint8Array([
    0x6a, 0x73, 0x6f, 0x6e, 0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa,
    0x00, 0x38, 0x9b, 0x71,
  ]);
  exif.descriptionBox.label = "stds.exif";
  const json = new JSONBox();
  json.content = {
    "@context": {
      exif: "http://ns.adobe.com/exif/1.0/",
      tiff: "http://ns.adobe.com/tiff/1.0/",
    },
    "exif:GPSLatitude": "51,28.614N",
    "exif:GPSLongitude": "0,0.030W",
    "tiff:Make": "Example Cam",
  };
  exif.contentBoxes.push(json);
  assertions.contentBoxes.push(exif);
  // toBuffer() writes the box's content; its header comes first.
  const content = store.toBuffer();
  const data = new Uint8Array([
    ...u32(content.length + 8),
    ...ascii("jumb"),
    ...content,
  ]);
  const head = new Uint8Array([...u32(data.length), ...ascii("caBX")]);
  const crc = crc32(new Uint8Array([...head.subarray(4), ...data]));
  return new Uint8Array([
    ...png.subarray(0, start),
    ...head,
    ...data,
    ...u32(crc),
    ...png.subarray(start + 12 + length),
  ]);
}

test("what a label's stds.exif says is a finding, kept with the label", async () => {
  const b = labelWithExif();
  const report = await inspect(file(b));
  const location = report.findings.find((f) => f.group === "location");
  expect(location?.sentence).toBe(
    "The AI label records the exact place it was taken: 51.4769° N, 0.0005° W.",
  );
  expect(location?.cleanedBy).toBe("remove-labels");
  expect(report.findings.map((f) => f.sentence)).not.toContain(
    en.label.nothingElse,
  );
  // Kept by default, and the note says so; gone with the label.
  const kept = await clean(file(b));
  expect(kept.notes).toEqual([en.clean.labelKeeps]);
  expect(kept.removed).toEqual([]);
  const dropped = await clean(file(b), { removeLabels: true });
  expect(dropped.removed).toEqual(
    expect.arrayContaining(["ai-label", "location", "device"]),
  );
});
