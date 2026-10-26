// exifr that can't be loaded (a page gone offline, or replaced since it
// opened) is the engine's own failure: inspect() fails, and never says the
// file is damaged.
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { inspect, ReaderMissing } from "../src/index.ts";

vi.mock("exifr", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

test("a photo with metadata, exifr missing: an error, not damage", async () => {
  const bytes = new Uint8Array(
    readFileSync(new URL("../../../fixtures/photo/gps.jpg", import.meta.url)),
  );
  await expect(
    inspect({ kind: "file", name: "gps.jpg", bytes }),
  ).rejects.toBeInstanceOf(ReaderMissing);
});
