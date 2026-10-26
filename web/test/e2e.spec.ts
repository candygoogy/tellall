// The built page, end to end (plan Task 10, spec §8), under its real CSP
// (playwright.config.ts serves dist/ with dist/_headers' headers). What
// the page should say is asked of the engine here, never typed in.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { inspect } from "@tellall/engine";
import { unzipSync } from "fflate";
import { expect, test, type Locator, type Page } from "@playwright/test";

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

// WebKit's Windows port can't put a page's data on the system clipboard:
// what a copy handler or the Clipboard API writes never reaches a real
// paste. Its ClipboardEvent constructor keeps the data it's given, though
// (Firefox's drops it), so there a paste is dispatched instead.
const windowsWebKit = (browserName: string) =>
  browserName === "webkit" && process.platform === "win32";

/** The system clipboard is one for all the browsers the suite runs at
 * once: a test that copies or pastes holds this lock (a folder, made or
 * waited for) while it does. */
async function withClipboard(run: () => Promise<void>): Promise<void> {
  const lock = join(test.info().project.outputDir, ".clipboard-lock");
  mkdirSync(test.info().project.outputDir, { recursive: true });
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    await run();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

/** Pastes text and its formatted copy into `target`, as a visitor's copy
 * from another page and Ctrl+V do: a copy handler puts both on the real
 * clipboard, and a real Ctrl+V pastes them. */
async function paste(
  page: Page,
  browserName: string,
  target: Locator,
  plain: string,
  html: string,
): Promise<void> {
  if (windowsWebKit(browserName)) {
    await target.evaluate(
      (el, [plain, html]) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", plain);
        dt.setData("text/html", html);
        const go = el.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
          }),
        );
        // A real paste the page doesn't take over types the text in.
        if (go && el instanceof HTMLTextAreaElement) {
          el.value = plain;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
      [plain, html],
    );
    return;
  }
  await page.evaluate(
    ([plain, html]) =>
      document.addEventListener(
        "copy",
        (e) => {
          e.clipboardData?.setData("text/plain", plain);
          e.clipboardData?.setData("text/html", html);
          e.preventDefault();
        },
        { once: true, capture: true },
      ),
    [plain, html],
  );
  // Every engine copies only with something selected; the handler
  // replaces what's copied.
  await page.locator("#hero-title").selectText();
  await page.keyboard.press("ControlOrMeta+C");
  await target.click();
  await page.keyboard.press("ControlOrMeta+V");
}

/** What a real paste into a plain box gets from the clipboard. */
async function pasteBack(
  page: Page,
): Promise<{ types: string[]; text: string }> {
  await page.evaluate(() => {
    const ta = document.createElement("textarea");
    ta.id = "paste-back";
    ta.setAttribute("aria-label", "Paste back");
    document.body.appendChild(ta);
    ta.addEventListener(
      "paste",
      (e) => {
        ta.dataset["types"] = [...(e.clipboardData?.types ?? [])].join(",");
      },
      { once: true },
    );
  });
  const box = page.locator("#paste-back");
  await box.click();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(box).not.toHaveValue("");
  const types = ((await box.getAttribute("data-types")) ?? "").split(",");
  return { types, text: await box.inputValue() };
}

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
  browserName,
}) => {
  // Only Chromium has these permissions (and needs them for the page's
  // navigator.clipboard.writeText); the others allow a copy on a click.
  if (browserName === "chromium")
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
  await withClipboard(async () => {
    await page.locator(".hero .hero-actions .js-paste").click();
    await paste(page, browserName, page.locator("#paste-area"), plain, html);
    await readerShows(page, "Pasted text");
    await expect(page.locator("#r-view .rv-headline")).toHaveText(
      expected.headline,
    );
    await expect(page.locator("#r-view .tx .chip.c-hidden")).toHaveCount(
      hidden,
    );
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
    await expect(page.locator("#r-view .js-copy-status")).toContainText(
      "Copied",
    );
    // Read back with a real paste; WebKit on Windows writes nowhere a paste
    // can read (windowsWebKit), so there the page's own "Copied" is all.
    if (windowsWebKit(browserName)) return;
    const clip = await pasteBack(page);
    expect(clip.types).toEqual(["text/plain"]);
    expect(clip.text).not.toContain("<");
    const after = await inspect({ kind: "text", plain: clip.text });
    expect(after.findings.filter((f) => f.kind === "private")).toEqual([]);
  });
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

test("390 px: the reader's first result is in the page before its script runs", async ({
  browser,
  baseURL,
}) => {
  // Where the section under the reader starts, the page at its top,
  // with the script off (what the first paint has) and on.
  const sectionTop = async (javaScriptEnabled: boolean) => {
    const context = await browser.newContext({
      baseURL,
      javaScriptEnabled,
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    // Loaded: the fonts too (they're preloaded). No page script here, so
    // the box is read from outside the page.
    await page.goto("/?still");
    if (javaScriptEnabled)
      await expect(page.locator("#r-view .an-main .part")).not.toHaveCount(0);
    const top = (await page.locator("#labels").boundingBox())?.y;
    await context.close();
    return top ?? NaN;
  };
  const before = await sectionTop(false);
  const after = await sectionTop(true);
  // 0.1 of an 844 px viewport would be a poor layout shift; this allows
  // a few pixels of rounding.
  expect(Math.abs(after - before)).toBeLessThanOrEqual(4);
});

test("the reader's text and the hidden-characters text have their own names", async ({
  page,
}) => {
  await page.goto("/?still");
  await page.locator('#side-examples [data-ex="text"]').click();
  await expect(page.locator("#r-view .tx")).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withRules(["landmark-unique"])
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test("the file map's targets stay 24 px while the window is tilted", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  // The window has arrived (the intro) and still leans back (no scroll).
  await expect(page.locator("#reader")).toHaveCSS("opacity", "1");
  const hits = page.locator("#r-view .an-main .hit");
  await expect(hits).not.toHaveCount(0);
  for (const box of await Promise.all(
    (await hits.all()).map((h) => h.boundingBox()),
  )) {
    expect(box?.width).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeGreaterThanOrEqual(24);
  }
});

test("the agent panel's command ends its options before the file", async ({
  page,
}) => {
  await page.goto("/?still");
  await page.locator("#tt-agent").click();
  await expect(page.locator("#term-body")).toContainText(
    "npx -y tellall --json -- chatgpt-image.png",
  );
});

test("the footer links the third-party licences, and they're served", async ({
  page,
}) => {
  await page.goto("/?still");
  const link = page.locator('footer a[href="/third-party-licenses.txt"]');
  await expect(link).toBeVisible();
  const res = await page.request.get("/third-party-licenses.txt");
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain("Third-party code in tellall's page");
});

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
  browserName,
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
  await withClipboard(() => paste(page, browserName, box, plain, html));
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
