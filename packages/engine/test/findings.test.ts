// Sentences built from odd metadata (engine audit, 2026-10-26): values out
// of range, markup in a value, and very long lists.
import { expect, test } from "vitest";
import { metaFindings, momentOf, pngTime, utcMoment } from "../src/findings.ts";
import type { Block, Meta, Read } from "../src/image/read.ts";
import { en } from "../src/words/en.ts";

const read = (...groups: [Block, Meta][]): Read => ({
  meta: Object.assign({}, ...groups.map(([, m]) => m)),
  groups,
});
const sentence = (r: Read, group: string) =>
  metaFindings(r, null, "PNG text").find((f) => f.group === group)?.sentence;

test("GPS out of range reads as a plain sentence", () => {
  const bad = read([
    "gps",
    {
      GPSLatitude: [124, 16, 39],
      GPSLatitudeRef: "N",
      GPSLongitude: [400, 0, 0],
      GPSLongitudeRef: "E",
    },
  ]);
  expect(sentence(bad, "location")).toBe("It records where it was taken.");
  const minutes = read([
    "gps",
    { GPSLatitude: [51, 75, 0], GPSLongitude: [0, 0, 1.8] },
  ]);
  expect(sentence(minutes, "location")).toBe(en.location.gpsUnreadable);
  const good = read([
    "gps",
    {
      GPSLatitude: [51, 28, 36.84],
      GPSLatitudeRef: "N",
      GPSLongitude: [0, 0, 1.8],
      GPSLongitudeRef: "W",
    },
  ]);
  expect(sentence(good, "location")).toBe(
    "It records the exact place it was taken: 51.4769° N, 0.0005° W.",
  );
});

test("dates that aren't real days and times read as plain sentences", () => {
  for (const v of ["2026:02:31 12:00:00", "2026:10:01 25:61:00", "2025:02:29"])
    expect(momentOf(v), v).toBeNull();
  expect(momentOf("2024:02:29 23:59:59")).not.toBeNull(); // a leap year
  expect(utcMoment("2026-02-31T00:00:00Z")).toBeNull();
  expect(utcMoment("2026-10-25T14:46:19.830385961Z")?.second).toBe(19);
  const r = read([
    "exif",
    {
      DateTimeOriginal: "2026:02:31 25:61:00",
      ModifyDate: "2026:13:01 00:00:00",
    },
  ]);
  expect(sentence(r, "dates")).toBe(
    "It records when it was taken. It records when it was last saved.",
  );
  // A PNG tIME of 31 Feb.
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 7, 0x74, 0x49,
    0x4d, 0x45, 0x07, 0xea, 2, 31, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  expect(pngTime(png)).toBeNull();
  png[19] = 28;
  expect(pngTime(png)?.day).toBe(28);
});

test("values with markup stay out of sentences, in the fields", () => {
  const broken = "<rd\uFFFD:li>Test Person</rdf:li#undefined>";
  const r = read([
    "xmp",
    { creator: ["Test Person", broken], Software: "<b>x</b>" },
  ]);
  const found = metaFindings(r, null, "PNG text");
  const other = found.find((f) => f.group === "other-text");
  expect(other?.sentence).toBe("It names a person: Test Person.");
  expect(other?.fields[0]?.value).toContain(broken);
  expect(found.find((f) => f.group === "software")?.sentence).toBe(
    "It names the software that saved it.",
  );
  const only = read(["text", { parameters: "<script>alert(1)</script>" }]);
  expect(sentence(only, "other-text")).toBe("It carries other text.");
});

test("long lists end in 'and N more'; long fields are cut", () => {
  const many: Meta = {};
  for (let i = 0; i < 80_000; i++) many[`k${i}`] = "v";
  many["big"] = "x".repeat(949_000);
  const t0 = performance.now();
  const found = metaFindings(read(["text", many]), null, "PNG text");
  expect(performance.now() - t0).toBeLessThan(2000);
  const other = found.find((f) => f.group === "other-text");
  expect(other?.sentence).toMatch(/ \/ and 79,991 more\.$/);
  expect(other?.sentence.length).toBeLessThan(400);
  const big = other?.fields.find((f) => f.name === "big")?.value ?? "";
  expect(big).toMatch(/… \(949,000 characters in all\)$/);
  expect(big.length).toBeLessThan(2100);
  const names = Array.from({ length: 14 }, (_, i) => `Person ${i}`);
  expect(en.otherText.names(names)).toBe(
    `It names people: ${names.slice(0, 10).join(", ")}, and 4 more.`,
  );
});

test("clean and source notes use plain words, no codes", () => {
  expect(en.clean.heicXmpKept(["creator", "CreatorTool"])).toBe(
    "The tag that says how it was made is stored together with other details, so they stay too: names and the software that saved it.",
  );
  expect(en.clean.heicXmpKept(["format", "GPSLatitude"])).toBe(
    "The tag that says how it was made is stored together with other details, so they stay too: the place and other details.",
  );
  expect(en.source("somethingNew")).toBe(
    "A tag in the file says how it was made.",
  );
});
