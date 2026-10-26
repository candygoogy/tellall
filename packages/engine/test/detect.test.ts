import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { detect } from "../src/image/detect.ts";

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(join(import.meta.dirname, "../../../fixtures/photo", name)),
  );

describe("detect", () => {
  test.each([
    ["gps.jpg", "jpeg"],
    ["rotated.jpg", "jpeg"],
    ["clean.jpg", "jpeg"],
    ["xmp-gps.jpg", "jpeg"],
    ["damaged.jpg", "jpeg"],
    ["meta.png", "png"],
    ["meta.webp", "webp"],
    ["sample.heic", "heic"],
  ] as const)("%s is %s", (name, type) => {
    expect(detect(fixture(name))).toBe(type);
  });

  test("by its bytes, not its name: a PNG called .jpg is a PNG", () => {
    // The same bytes under a misleading name: detect never sees the name.
    const renamed = new File([fixture("meta.png")], "photo.jpg", {
      type: "image/jpeg",
    });
    expect(renamed.name).toBe("photo.jpg");
    expect(detect(fixture("meta.png"))).toBe("png");
  });

  test.each([
    ["text", new TextEncoder().encode("Not a photo.\n")],
    ["random bytes", new Uint8Array([7, 3, 99, 250, 1, 0, 42, 17, 8, 8, 8, 8])],
    ["nothing", new Uint8Array(0)],
    [
      "a RIFF that isn't WebP",
      new TextEncoder().encode("RIFF\u0004\u0000\u0000\u0000WAVE"),
    ],
  ])("%s is unknown", (_name, bytes) => {
    expect(detect(bytes)).toBeNull();
  });

  test("an AVIF is not taken for HEIC", () => {
    const bytes = fixture("sample.heic").slice();
    bytes.set(new TextEncoder().encode("avif"), 8);
    expect(detect(bytes)).toBeNull();
  });

  /** A file type box with this main brand and these compatible ones. */
  const ftyp = (major: string, ...compatible: string[]) => {
    const body = `ftyp${major}\0\0\0\0${compatible.join("")}`;
    const out = new Uint8Array(4 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set(new TextEncoder().encode(body), 4);
    return out;
  };

  test("plain HEIF that also names AVIF is not taken for HEIC", () => {
    expect(detect(ftyp("mif1", "mif1", "miaf", "avif"))).toBeNull();
    expect(detect(ftyp("msf1", "msf1", "avis"))).toBeNull();
  });

  test("a phone's HEIC, and plain HEIF on its own, are HEIC", () => {
    expect(detect(ftyp("heic", "mif1", "heic"))).toBe("heic");
    expect(detect(ftyp("mif1", "mif1", "heic", "avif"))).toBe("heic");
    expect(detect(ftyp("mif1", "mif1", "miaf"))).toBe("heic");
  });
});
