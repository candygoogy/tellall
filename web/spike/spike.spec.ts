// Spike (plan Task 2): the C2PA reader runs in a browser worker.
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../fixtures/ai/${name}`, import.meta.url));

const cases = [
  {
    file: "chatgpt-image.png",
    expected: [
      '"type": "png"',
      '"signer": "OpenAI OpCo, LLC"',
      '"when": "2026-10-25T14:46:19.830385961Z"',
    ],
  },
  {
    file: "gemini-image.jpg",
    expected: [
      '"type": "jpeg"',
      '"signer": "Google LLC"',
      '"description": "Applied imperceptible SynthID watermark."',
    ],
  },
];

for (const { file, expected } of cases) {
  test(`worker reads ${file}`, async ({ page }) => {
    await page.goto("/");
    await page.locator("#file").setInputFiles(fixture(file));
    const out = page.locator("#out");
    for (const text of expected) {
      await expect(out).toContainText(text, { timeout: 15_000 });
    }
    await expect(out).toContainText('"signatureMatches": true');
    await expect(out).toContainText('"watermarkStated": true');
  });
}
