// The built page, end to end (plan Task 10, spec §8), under its real CSP
// (playwright.config.ts serves dist/ with dist/_headers' headers). What
// the page should say is asked of the engine here, never typed in.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { inspect } from "@tellall/engine";
import { unzipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";

const FIXTURES = new URL("../../fixtures/", import.meta.url);
const bytesOf = (path: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(path, FIXTURES))));
const fileReport = (path: string) =>
  inspect({
    kind: "file",
    name: path.split("/").pop() ?? path,
    bytes: bytesOf(path),
  });

interface Drop {
  name: string;
  b64: string;
  type: string;
  /** How many copies to drop, each named name-001.ext and on. */
  copies?: number;
}

/** Drops files on the page, as a drag and drop from the desktop does. */
async function drop(page: Page, files: Drop[]): Promise<void> {
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      if (!f.copies) dt.items.add(new File([bytes], f.name, { type: f.type }));
      for (let i = 1; i <= (f.copies ?? 0); i++) {
        const name = f.name.replace(
          /(\.\w+)$/,
          `-${String(i).padStart(3, "0")}$1`,
        );
        dt.items.add(new File([bytes], name, { type: f.type }));
      }
    }
    dispatchEvent(
      new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }),
    );
    dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, files);
}
const fixtureDrop = (path: string, type: string): Drop => ({
  name: path.split("/").pop() ?? path,
  b64: Buffer.from(bytesOf(path)).toString("base64"),
  type,
});

/** The reader shows the visitor's own file, read. */
async function readerShows(page: Page, name: string) {
  await expect(page.locator("#r-group")).toHaveText("Your files");
  await expect(page.locator("#r-name")).toHaveText(name);
  await expect(page.locator("#r-view .rv-headline")).toBeVisible({
    timeout: 30_000,
  });
}

// Every request the page makes goes to its own origin (or stays in the
// tab: blob: and data: URLs). Any other fails the test it happened in.
// A test that provokes a request on purpose (the privacy button) allows
// exactly that one. The listener sees the worker's requests too (the
// offline test waits for one).
let offsite: string[] = [];
let violations: string[] = [];
let allowed: RegExp | null = null;
test.beforeEach(async ({ page, baseURL }) => {
  offsite = [];
  violations = [];
  allowed = null;
  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith(origin + "/") && !/^(blob|data):/.test(url))
      offsite.push(url);
  });
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
});
test.afterEach(() => {
  const unexpected = (list: string[]) => list.filter((x) => !allowed?.test(x));
  expect(
    unexpected(offsite),
    "requests to anywhere but the page's own origin",
  ).toEqual([]);
  expect(unexpected(violations), "CSP violations").toEqual([]);
});

for (const [path, type] of [
  ["ai/chatgpt-image.png", "image/png"],
  ["ai/gemini-image.jpg", "image/jpeg"],
] as const) {
  test(`an AI image: ${path}`, async ({ page }) => {
    const expected = await fileReport(path);
    // The ChatGPT image with the page's motion on, the other settled.
    await page.goto(path.includes("chatgpt") ? "/" : "/?still");
    await drop(page, [fixtureDrop(path, type)]);
    await readerShows(page, expected.name);
    await expect(page.locator("#r-view .rv-headline")).toHaveText(
      expected.headline,
    );
    // The anatomy map draws the label, where the engine found it.
    expect(expected.anatomy.some((p) => p.part === "label")).toBe(true);
    await expect(
      page.locator('#r-view .an-main .part[data-kind="label"]'),
    ).toHaveCount(1);
  });
}

test("gps.jpg: the location, and a clean copy without it", async ({ page }) => {
  const expected = await fileReport("photo/gps.jpg");
  const location = expected.findings.find(
    (f) => f.group === "location" && f.kind === "private",
  );
  expect(location).toBeDefined();
  await page.goto("/?still");
  await drop(page, [fixtureDrop("photo/gps.jpg", "image/jpeg")]);
  await readerShows(page, "gps.jpg");
  await expect(
    page.locator("#r-view .finding", { hasText: location?.sentence ?? "" }),
  ).toBeVisible();

  const download = page.waitForEvent("download");
  await page.locator("#r-view .js-dl").click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("gps.clean.jpg");
  const path = await saved.path();
  const copy = await inspect({
    kind: "file",
    name: "gps.clean.jpg",
    bytes: new Uint8Array(readFileSync(path)),
  });
  expect(copy.findings.filter((f) => f.group === "location")).toEqual([]);
  expect(copy.findings.filter((f) => f.kind === "private")).toEqual([]);
});

test("pasted text: hidden characters marked, copied back as plain text", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const plain = "Send it today.​ The total is right\u{e0041}\u{e0042}.⁠";
  const html = `<p class="answer" style="color:red">${plain}</p>`;
  const expected = await inspect({ kind: "text", plain, html });
  const hidden = expected.findings
    .filter((f) => f.group === "hidden-chars" && f.kind === "private")
    .flatMap((f) => f.fields)
    .flatMap(
      (f) => / at ([\d, ]+)$/.exec(f.value)?.[1]?.split(/,\s*/) ?? [],
    ).length;
  expect(hidden).toBeGreaterThan(0);

  await page.goto("/?still");
  await page.evaluate(
    ([plain, html]) => {
      const dt = new DataTransfer();
      dt.setData("text/plain", plain);
      dt.setData("text/html", html);
      document.body.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [plain, html],
  );
  await readerShows(page, "Pasted text");
  await expect(page.locator("#r-view .rv-headline")).toHaveText(
    expected.headline,
  );
  await expect(page.locator("#r-view .tx .chip.c-hidden")).toHaveCount(hidden);
  // The page's HTML (no SourceURL, as a browser paste has none) still
  // brings the page's styling along, and the reader says so.
  const extras = expected.findings.filter((f) => f.group === "copy-extras");
  expect(extras.length).toBeGreaterThan(0);
  for (const f of extras) {
    await expect(
      page.locator("#r-view .finding", { hasText: f.sentence }),
    ).toBeVisible();
  }

  await page.locator("#r-view .js-copy-clean").click();
  await expect(page.locator("#r-view .js-copy-status")).toContainText("Copied");
  const clip = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const types = items.flatMap((i) => [...i.types]);
    return { types, text: await navigator.clipboard.readText() };
  });
  expect(clip.types).toEqual(["text/plain"]);
  expect(clip.text).not.toContain("<");
  const after = await inspect({ kind: "text", plain: clip.text });
  expect(after.findings.filter((f) => f.kind === "private")).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`axe: no serious violations at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      );
    expect(serious).toEqual([]);
  });
}

test("390 px: no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?still");
  await page.evaluate(() => document.fonts.ready);
  const { scroll, view } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    view: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(view);
});

test("200 small files: every one gets its row, and the page keeps answering", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/?still");
  // A frame clock: the longest the page went without drawing a frame.
  await page.evaluate(() => {
    const w = window as unknown as { __gap: number };
    w.__gap = 0;
    let last = performance.now();
    const tick = (t: number) => {
      w.__gap = Math.max(w.__gap, t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await drop(page, [
    { ...fixtureDrop("photo/gps.jpg", "image/jpeg"), copies: 200 },
  ]);
  const rows = page.locator("#side-live-list .file-item");
  await expect(rows).toHaveCount(200);
  // While they're read, the page still answers a click at once.
  const t0 = Date.now();
  await page.locator('#side-examples [data-ex="text"]').click();
  await expect(page.locator("#r-name")).toHaveText("Example text");
  expect(Date.now() - t0).toBeLessThan(2_000);
  await expect(page.locator("#side-live-list .dot-reading")).toHaveCount(0, {
    timeout: 150_000,
  });
  await expect(page.locator("#side-live-list .dot-private")).toHaveCount(200);
  // More beyond 200 in all: the oldest finished ones make room.
  await drop(page, [
    { ...fixtureDrop("photo/meta.png", "image/png"), copies: 5 },
  ]);
  await expect(page.locator("#side-live-list .dot-reading")).toHaveCount(0);
  await expect(rows).toHaveCount(200);
  await expect(rows.filter({ hasText: "meta-005.png" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "gps-001.jpg" })).toHaveCount(0);
  const gap = await page.evaluate(
    () => (window as unknown as { __gap: number }).__gap,
  );
  expect(gap).toBeLessThan(500);
});

test("offline after loading: a photo is still read", async ({
  page,
  context,
}) => {
  // The worker loads the metadata reader before it says it's ready; the
  // request listener sees it go by, as it sees all the worker's requests.
  const reader = page.waitForResponse(/\/assets\/full\.esm-[\w-]+\.js$/);
  await page.goto("/?still");
  await reader;
  const expected = await fileReport("photo/gps.jpg");
  await context.setOffline(true);
  await drop(page, [fixtureDrop("photo/gps.jpg", "image/jpeg")]);
  await readerShows(page, "gps.jpg");
  await expect(page.locator("#r-view .rv-headline")).toHaveText(
    expected.headline,
  );
  await context.setOffline(false);
});

test("privacy: the page's rules block the request", async ({ page }) => {
  allowed = /tellall\.invalid/;
  await page.goto("/?still");
  await page.locator("#req-try").click();
  await expect(page.locator("#req-status")).toHaveText(/^Blocked before/);
  await expect(page.locator("#req-blocked")).toHaveText(
    "1 attempt blocked, 0 sent",
  );
});

test("privacy: without the rules, the page doesn't claim a block", async ({
  page,
  baseURL,
}) => {
  allowed = /tellall\.invalid/;
  // The page served without its Content-Security-Policy.
  await page.route(`${baseURL}/**`, async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });
  await page.goto("/?still");
  await page.locator("#req-try").click();
  await expect(page.locator("#req-status")).toContainText(
    "should have stopped it",
  );
  await expect(page.locator("#req-blocked")).toHaveText(
    "0 attempts blocked, 1 sent",
  );
});

test("paste your own: an edited paste drops the page's HTML", async ({
  page,
}) => {
  const plain = "Here is the summary you asked for.";
  const html = `<p class="answer" style="color:red">${plain}</p>`;
  const withHtml = await inspect({ kind: "text", plain, html });
  const typed = "typed by hand";
  const alone = await inspect({ kind: "text", plain: typed });
  expect(withHtml.headline).not.toBe(alone.headline);

  await page.goto("/?still");
  await page.locator("#hx-own").click();
  const box = page.locator("#hx-input");
  await box.evaluate(
    (el, [plain, html]) => {
      const ta = el as HTMLTextAreaElement;
      const dt = new DataTransfer();
      dt.setData("text/plain", plain);
      dt.setData("text/html", html);
      ta.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }),
      );
      ta.value = plain;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [plain, html],
  );
  await expect(page.locator("#hx-headline")).toHaveText(withHtml.headline);
  await box.fill(typed);
  await expect(page.locator("#hx-headline")).toHaveText(alone.headline);
  await box.fill("");
  await expect(page.locator("#hx-src")).toHaveText(
    "Example text with planted characters",
  );
});

test("download all clean: one zip with each clean copy", async ({ page }) => {
  await page.goto("/?still");
  await drop(page, [
    fixtureDrop("photo/gps.jpg", "image/jpeg"),
    fixtureDrop("photo/meta.png", "image/png"),
  ]);
  await expect(page.locator("#side-live-list .dot-reading")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.locator("#dl-all").click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("tellall-clean.zip");
  const files = unzipSync(new Uint8Array(readFileSync(await saved.path())));
  expect(Object.keys(files).sort()).toEqual([
    "gps.clean.jpg",
    "meta.clean.png",
  ]);
  for (const [name, bytes] of Object.entries(files)) {
    const r = await inspect({ kind: "file", name, bytes });
    expect(r.findings.filter((f) => f.kind === "private")).toEqual([]);
  }
});
