// The built page, end to end (plan Task 10, spec §8), under its real CSP
// (playwright.config.ts serves dist/ with dist/_headers' headers). What
// the page should say is asked of the engine here, never typed in.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { inspect } from "@tellall/engine";
import { watermarkCheckers } from "@tellall/engine/checkers";
import { unzipSync } from "fflate";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { textName } from "../src/view/reader-html.ts";

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
    // Under the watermark sentence, where to check for it: Google's
    // SynthID Detector when the label names SynthID (Gemini's does),
    // OpenAI's own checker when OpenAI signed it (its label names no
    // watermark). Plain links in a new tab; nothing is sent.
    const sentence = expected.findings.find((f) =>
      f.sentence.includes("invisible watermark"),
    )?.sentence;
    expect(sentence).toBeDefined();
    const item = page
      .locator("#r-view .rv-findings li")
      .filter({ hasText: sentence ?? "" });
    const href = path.includes("gemini")
      ? "https://synthid.com/"
      : "https://openai.com/verify";
    expect(watermarkCheckers(sentence ?? "").map((c) => c.url)).toEqual([href]);
    const link = item.locator("a.f-check");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", href);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener");
    await expect(link).toContainText(
      path.includes("gemini") ? "SynthID Detector" : "OpenAI",
    );
    // Only that sentence has one.
    await expect(page.locator("#r-view a.f-check")).toHaveCount(1);
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
  // The page says it's saved, as it does for an example's copy.
  await expect(page.locator("#r-view .js-dl-status")).toHaveText(
    /^Saved gps\.clean\.jpg: [\d,]+ bytes, [\d,]+ bytes of personal data removed\.$/,
  );
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
    // Named by its first words.
    await readerShows(page, textName(plain).name);
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

test("the AI label card: each question beside its rows and what tellall says; pointing at one lights its rows", async ({
  page,
}) => {
  const expected = await fileReport("ai/chatgpt-image.png");
  const sentences = expected.findings
    .filter((f) => f.group === "ai-label")
    .slice(0, 3)
    .map((f) => f.sentence);
  expect(sentences).toHaveLength(3);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?still");
  const groups = page.locator("#label-card .lc-group");
  await expect(groups).toHaveCount(3);
  for (const [i, sentence] of sentences.entries()) {
    const said = groups.nth(i).locator(".lc-said");
    await expect(said).toBeVisible();
    await expect(said).toHaveText(sentence);
  }
  // Nothing is lit until a group is pointed at; then only its rows are.
  await expect(page.locator("#label-card .lc-fields .is-hot")).toHaveCount(0);
  await groups.nth(1).locator(".lc-note-title").hover();
  const rows = groups.nth(1).locator(".lc-fields dt, .lc-fields dd");
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) await expect(row).toHaveClass(/is-hot/);
  await expect(page.locator("#lc-time")).toHaveClass(/is-hot/);
  await expect(groups.nth(0).locator(".lc-fields .is-hot")).toHaveCount(0);
  await expect(groups.nth(2).locator(".lc-fields .is-hot")).toHaveCount(0);
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
  // Each batch is listed in the order it was chosen, so the bottom of the
  // list goes first: the first batch's last files.
  await expect(rows.filter({ hasText: "gps-200.jpg" })).toHaveCount(0);
  await expect(rows.filter({ hasText: "gps-001.jpg" })).toHaveCount(1);
  const gap = await page.evaluate(
    () => (window as unknown as { __gap: number }).__gap,
  );
  expect(gap).toBeLessThan(500);
});

test("a long list: the legend stays in view with the buttons, wherever the list is scrolled", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?still");
  await drop(page, [
    { ...fixtureDrop("photo/gps.jpg", "image/jpeg"), copies: 30 },
  ]);
  await expect(page.locator("#side-live-list .file-item")).toHaveCount(30);
  const side = page.locator(".side");
  expect(
    await side.evaluate((s) => s.scrollHeight > s.clientHeight + 100),
  ).toBe(true);
  for (const at of ["top", "middle", "bottom"] as const) {
    await side.evaluate((s, at) => {
      const end = s.scrollHeight - s.clientHeight;
      s.scrollTop = at === "top" ? 0 : at === "middle" ? end / 2 : end;
    }, at);
    // Each of its marks is the thing under its own middle, inside the
    // sidebar: nothing covers it and it isn't scrolled away.
    const seen = await page.evaluate(() => {
      const box = (
        document.querySelector(".side") as Element
      ).getBoundingClientRect();
      return Array.from(document.querySelectorAll(".side-legend span")).map(
        (el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2;
          const y = r.top + r.height / 2;
          const inside =
            r.top >= box.top && r.bottom <= box.bottom && r.height > 0;
          const hit = document.elementFromPoint(x, y);
          return inside && !!hit && el.contains(hit);
        },
      );
    });
    expect(seen, `legend seen with the list at its ${at}`).toEqual([
      true,
      true,
      true,
      true,
    ]);
  }
  // Above the buttons.
  const legend = await page.locator(".side-legend").boundingBox();
  const add = await page.locator(".side-add").boundingBox();
  expect(legend && add && legend.y + legend.height <= add.y).toBe(true);
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
  await expect(page.locator("#dl-all-note")).toHaveText(
    "Saved tellall-clean.zip: 2 clean copies.",
  );
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

/* ------------------------------------------------- the visitor's own texts */

test("text: a paste, New text and a second paste make two rows, each named by its words", async ({
  page,
  browserName,
}) => {
  const first = "The first text, pasted in the reader.​";
  const second = "A second text⁠ after New text.";
  await page.goto("/?still");
  await page.locator(".hero .hero-actions .js-paste").click();
  // A new text is in no list yet: its name alone in the window's title.
  await expect(page.locator(".crumbs")).toHaveClass(/is-solo/);
  await expect(page.locator("#paste-area")).toBeFocused();
  await withClipboard(async () => {
    await paste(page, browserName, page.locator("#paste-area"), first, "");
    await readerShows(page, textName(first).name);
    await page.locator("#r-view .js-new-text").click();
    await expect(page.locator("#r-name")).toHaveText("New text");
    await expect(page.locator("#paste-area")).toBeFocused();
    await expect(page.locator("#paste-area")).toHaveValue("");
    await paste(page, browserName, page.locator("#paste-area"), second, "");
    await readerShows(page, textName(second).name);
  });
  await expect(page.locator("#side-live-list .fi-name")).toHaveText([
    textName(second).name,
    textName(first).name,
  ]);
});

test("text: an edit is read again, and the name follows the words", async ({
  page,
}) => {
  const hidden = "Send it today.​";
  const plain = "Nothing hidden here at all.";
  const before = await inspect({ kind: "text", plain: hidden });
  const after = await inspect({ kind: "text", plain });
  await page.goto("/?still");
  await page.locator(".hero .hero-actions .js-paste").click();
  const box = page.locator("#paste-area");
  await box.fill(hidden);
  await expect(page.locator("#r-view .rv-headline")).toHaveText(
    before.headline,
  );
  await expect(page.locator("#r-view .tx .chip")).toHaveCount(1);
  await box.fill(plain);
  await expect(page.locator("#r-view .rv-headline")).toHaveText(after.headline);
  await expect(page.locator("#r-view .tx .chip")).toHaveCount(0);
  // The same text, its row renamed.
  await expect(page.locator("#side-live-list .fi-name")).toHaveText([
    textName(plain).name,
  ]);
  await expect(box).toBeFocused();
});

test("text: what was typed survives switching to another item and back", async ({
  page,
}) => {
  await page.goto("/?still");
  await page.locator(".hero .hero-actions .js-paste").click();
  await page.locator("#paste-area").fill("Typed, then straight to an example");
  // At once, before the box's own reading is due.
  await page.locator('#side-examples [data-ex="gps"]').click();
  await expect(page.locator("#r-name")).toHaveText("gps.jpg");
  await page.locator("#side-live-list .file-item").first().click();
  await expect(page.locator("#paste-area")).toHaveValue(
    "Typed, then straight to an example",
  );
});

test("text: Ctrl+Enter (⌘+Enter) reads at once; an empty box says what to do", async ({
  page,
}) => {
  // The page's clock stands still: the box's 220 ms never pass by
  // themselves.
  await page.clock.install();
  await page.goto("/?still");
  await page.locator(".hero .hero-actions .js-paste").click();
  const box = page.locator("#paste-area");
  await box.click();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator("#r-view .js-copy-status")).toHaveText(
    "Paste or type some text first.",
  );
  await box.fill("Read me now.​");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator("#r-view .rv-headline")).toHaveText(
    (await inspect({ kind: "text", plain: "Read me now.​" })).headline,
  );
  await expect(page.locator("#r-view .js-copy-status")).toHaveText("");
});

test("text: one left empty leaves the list once another item is chosen", async ({
  page,
}) => {
  const first = "The first text, kept.";
  const second = "The second text, soon emptied.";
  const rows = page.locator("#side-live-list .fi-name");
  await page.goto("/?still");
  await page.locator(".hero .hero-actions .js-paste").click();
  const box = page.locator("#paste-area");
  await box.fill(first);
  await expect(rows).toHaveText([textName(first).name]);
  await page.locator("#r-view .js-new-text").click();
  await box.fill(second);
  await expect(rows).toHaveText([textName(second).name, textName(first).name]);
  // Emptied while on it: the row stays, as the words may come back.
  await box.fill("");
  await expect(rows).toHaveText(["New text", textName(first).name]);
  await expect(box).toBeFocused();
  // Another row chosen: the empty text goes.
  await page
    .locator("#side-live-list .file-item", { hasText: textName(first).name })
    .click();
  await expect(box).toHaveValue(first);
  await expect(rows).toHaveText([textName(first).name]);
  // Spaces alone are empty too; an example chosen at once, before the box's
  // own reading is due, takes it out as well.
  await box.fill("   ");
  await page.locator('#side-examples [data-ex="gps"]').click();
  await expect(page.locator("#r-name")).toHaveText("gps.jpg");
  await expect(rows).toHaveCount(0);
  await expect(page.locator("#side-live")).toBeHidden();
});

/* -------------------------------------------------- the visitor's own files */

test("a file tellall can't read: the Couldn't read dot, and no file to scale", async ({
  page,
}) => {
  await page.goto("/?still");
  await drop(page, [
    {
      name: "anim.gif",
      b64: Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;").toString(
        "base64",
      ),
      type: "image/gif",
    },
  ]);
  await readerShows(page, "anim.gif");
  const dot = page.locator("#side-live-list .fi-dot");
  await expect(dot).toHaveClass(/dot-error/);
  await expect(dot).toHaveAttribute("aria-label", "Couldn't read");
  await expect(page.locator("#r-status-text .st-long")).toHaveText(
    "Can't read this kind of file",
  );
  await expect(page.locator("#r-view")).toContainText(
    "tellall reads JPEG, PNG, WebP and HEIC images, and text you paste.",
  );
  await expect(page.locator("#r-view .an-main")).toHaveCount(0);
  await expect(page.locator("#r-view .rv-plate")).toHaveCount(0);
  await expect(page.locator("#r-view .js-choose")).toHaveText(
    "Choose another image",
  );
});

test("your files: × takes one row out, and the one on screen hands over to the next", async ({
  page,
}) => {
  await page.goto("/?still");
  await drop(page, [
    fixtureDrop("photo/gps.jpg", "image/jpeg"),
    fixtureDrop("photo/meta.png", "image/png"),
  ]);
  await readerShows(page, "gps.jpg");
  await expect(page.locator("#side-live-list .dot-reading")).toHaveCount(0, {
    timeout: 30_000,
  });
  // By keyboard (Safari doesn't focus a clicked button), so the focus
  // has somewhere to go.
  await page.getByRole("button", { name: "Remove gps.jpg from list" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#side-live-list .fi-name")).toHaveText([
    "meta.png",
  ]);
  await readerShows(page, "meta.png");
  await expect(page.locator("#r-live")).toHaveText("Removed gps.jpg.");
  // The focus stays on the list, on the next row's ×.
  await expect(
    page.getByRole("button", { name: "Remove meta.png from list" }),
  ).toBeFocused();
});

test("your files: Clear empties the list, and Undo brings it back with the file on screen", async ({
  page,
}) => {
  await page.goto("/?still");
  await drop(page, [
    fixtureDrop("photo/gps.jpg", "image/jpeg"),
    fixtureDrop("photo/meta.png", "image/png"),
  ]);
  await expect(page.locator("#side-live-list .dot-reading")).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.locator("#side-live-list .file-item").nth(1).click();
  await readerShows(page, "meta.png");
  await page.getByRole("button", { name: "Clear your files" }).click();
  await expect(page.locator("#side-live-list .file-item")).toHaveCount(0);
  await expect(page.locator("#side-undo")).toContainText("Cleared 2 files.");
  await expect(page.locator("#r-group")).toHaveText("Examples");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("#side-live-list .fi-name")).toHaveText([
    "gps.jpg",
    "meta.png",
  ]);
  await readerShows(page, "meta.png");
  await expect(page.locator("#side-undo")).toBeHidden();
  await expect(page.locator("#r-live")).toHaveText("Restored 2 files.");
  await expect(page.locator("#dl-all")).toBeVisible();
});

test("a drop from far down the page: the jump to the reader offers the way back", async ({
  page,
}) => {
  await page.goto("/?still");
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  const before = await page.evaluate(() => scrollY);
  await drop(page, [fixtureDrop("photo/gps.jpg", "image/jpeg")]);
  await readerShows(page, "gps.jpg");
  const back = page.getByRole("button", { name: "Back to where you were" });
  await expect(back).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBeLessThan(before / 2);
  await back.click();
  await expect(back).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(before - 4);
});

test("a dropped .txt is read as text; one whose bytes are a picture, as the picture", async ({
  page,
}) => {
  await page.goto("/?still");
  const words = "Shopping list​\nmilk and eggs";
  await drop(page, [
    {
      name: "notes.txt",
      b64: Buffer.from(words).toString("base64"),
      type: "text/plain",
    },
    { ...fixtureDrop("photo/gps.jpg", "image/jpeg"), name: "photo.txt" },
  ]);
  await expect(page.locator("#side-live-list .fi-name")).toHaveText([
    "photo.txt",
    "Shopping list",
  ]);
  // The picture is read as one: its personal data found.
  await expect(
    page.locator("#side-live-list .file-item").first().locator(".fi-dot"),
  ).toHaveClass(/dot-private/, { timeout: 30_000 });
  await page.locator("#side-live-list .file-item").nth(1).click();
  await expect(page.locator("#paste-area")).toHaveValue(words);
  await expect(page.locator("#r-view .rv-headline")).toHaveText(
    "This text has 1 hidden character.",
  );
  await page.locator("#side-live-list .file-item").first().click();
  await readerShows(page, "photo.txt");
  await expect(page.locator("#r-view .an-main")).toBeVisible();
});

test("a text file over 2 MB gets a row that says so; a UTF-16 one is read", async ({
  page,
}) => {
  await page.goto("/?still");
  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("Hello​ there", "utf16le"),
  ]);
  await drop(page, [
    {
      name: "big.txt",
      b64: Buffer.alloc(3 * 1024 * 1024, "a").toString("base64"),
      type: "text/plain",
    },
    { name: "wide.txt", b64: utf16.toString("base64"), type: "text/plain" },
  ]);
  await expect(page.locator("#side-live-list .fi-name")).toHaveText([
    "big.txt",
    "Hello there",
  ]);
  await expect(page.locator("#r-view")).toContainText(
    "This text file is larger than 2 MB",
  );
  await expect(
    page.locator("#side-live-list .file-item").first().locator(".fi-dot"),
  ).toHaveClass(/dot-error/);
  await page.locator("#side-live-list .file-item").nth(1).click();
  await expect(page.locator("#r-view .rv-headline")).toHaveText(
    "This text has 1 hidden character.",
  );
});

test("a batch is listed in the order it was chosen, its first file shown", async ({
  page,
}) => {
  await page.goto("/?still");
  await drop(page, [
    fixtureDrop("photo/gps.jpg", "image/jpeg"),
    fixtureDrop("photo/meta.png", "image/png"),
  ]);
  await expect(page.locator("#side-live-list .fi-name")).toHaveText([
    "gps.jpg",
    "meta.png",
  ]);
  await readerShows(page, "gps.jpg");
});

test("a batch: an empty file gets a Couldn't read row, Download all clean leads the list, and one line sums it up", async ({
  page,
}) => {
  await page.goto("/?still");
  await drop(page, [
    fixtureDrop("photo/gps.jpg", "image/jpeg"),
    fixtureDrop("photo/meta.png", "image/png"),
    fixtureDrop("ai/chatgpt-image.png", "image/png"),
    { name: "empty.png", b64: "", type: "image/png" },
  ]);
  const rows = page.locator("#side-live-list .file-item");
  await expect(rows).toHaveCount(4);
  await expect(page.locator("#side-live-list .dot-reading")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.locator("#r-live")).toHaveText(
    "Read 4 files: 1 with an AI label, 2 with personal data, 1 couldn't be read.",
  );
  const empty = rows.filter({ hasText: "empty.png" });
  await expect(empty.locator(".fi-dot")).toHaveAttribute(
    "aria-label",
    "Couldn't read",
  );
  // Before the rows: in reach however long the list, and first for the keyboard.
  const all = await page.locator("#dl-all").boundingBox();
  const row = await rows.first().boundingBox();
  expect(all && row && all.y + all.height <= row.y).toBe(true);
  await empty.click();
  await expect(page.locator("#r-view .rv-headline")).toHaveText(
    "tellall couldn't read this file.",
  );
  await expect(page.locator("#r-view .rv-note")).toHaveText(
    "The file is empty: it has no bytes to read.",
  );
});

test("past 200 files at once: the first 200 are read, and the sidebar says how many were left out", async ({
  page,
}) => {
  await page.goto("/?still");
  await drop(page, [
    { name: "empty.png", b64: "", type: "image/png" },
    { ...fixtureDrop("photo/gps.jpg", "image/jpeg"), copies: 201 },
  ]);
  await expect(page.locator("#side-live-list .file-item")).toHaveCount(200);
  await expect(page.locator("#side-live-note")).toHaveText(
    "Read the first 200 files; 2 left out.",
  );
  await expect(page.locator("#side-live-note")).toBeVisible();
});

test("760 to 1440 px: the picture's caption stays clear of the action bar, and the example names fit", async ({
  page,
}) => {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [760, 800, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/?still");
      const examples = page.locator("#side-examples .file-item");
      for (const ex of ["chatgpt", "gemini", "gps", "damaged"]) {
        await page.locator(`#side-examples [data-ex="${ex}"]`).click();
        await expect(page.locator("#r-view .rv-cap")).toBeVisible();
        const gap = await page.evaluate(() => {
          const box = (s: string) =>
            (document.querySelector(s) as Element).getBoundingClientRect();
          return box("#r-view .rv-actions").top - box("#r-view .rv-cap").bottom;
        });
        expect(
          gap,
          `${ex} at ${width} px, ${reducedMotion}`,
        ).toBeGreaterThanOrEqual(0);
      }
      const cut = await examples.evaluateAll((bs) =>
        bs
          .map((b) => b.querySelector(".fi-name") as HTMLElement)
          .filter((n) => n.scrollWidth > n.clientWidth)
          .map((n) => n.textContent),
      );
      expect(cut, `names cut at ${width} px`).toEqual([]);
    }
  }
});

test("the result's headline takes the focus after a reading the visitor started", async ({
  page,
}) => {
  await page.goto("/?still");
  await drop(page, [fixtureDrop("photo/gps.jpg", "image/jpeg")]);
  await readerShows(page, "gps.jpg");
  await expect(page.locator("#r-view .rv-headline")).toBeFocused();
  // Picking a row doesn't pull the focus into the result.
  await page.locator('#side-examples [data-ex="chatgpt"]').click();
  await expect(page.locator("#r-name")).toHaveText("chatgpt-image.png");
  await expect(page.locator("#r-view .rv-headline")).not.toBeFocused();
});

/* ----------------------------------------------------------- page details */

test("copy: a button's label goes back to its own after a double click and a tab switch", async ({
  page,
  context,
  browserName,
}) => {
  if (browserName === "chromium")
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?still");
  const copy = page.locator("#term-copy");
  const label = copy.locator("span");
  await withClipboard(async () => {
    await copy.dblclick();
    await expect(label).not.toHaveText("Copy command");
    await expect(label).toHaveText("Copy command", { timeout: 4000 });
    // The second click's timer didn't keep "Copied" as the label.
    await page.waitForTimeout(2000);
    await expect(label).toHaveText("Copy command");
    // Copied on one tab, then the other: that tab's own label at once.
    await page.locator("#tt-agent").click();
    await expect(label).toHaveText("Copy install command");
    await copy.click();
    await page.locator("#tt-cli").click();
    await expect(label).toHaveText("Copy command");
    await page.waitForTimeout(2000);
    await expect(label).toHaveText("Copy command");
  });
});

test("reduced motion: no replay buttons, as there's nothing to replay", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#r-replay")).toBeHidden();
  await expect(page.locator("#net-replay")).toBeHidden();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator("#r-replay")).toBeVisible();
  await page.locator("#privacy").scrollIntoViewIfNeeded();
  await expect(page.locator("#net-replay")).toBeVisible();
});

test("390 px: the menu leads with Choose images and Paste text, and closes when one is used", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?still");
  const menu = page.locator(".nav-menu");
  const sheet = page.locator("#nav-sheet");
  const choose = sheet.getByRole("button", { name: "Choose images" });
  const text = sheet.getByRole("button", { name: "Paste text" });
  await menu.click();
  for (const b of [choose, text]) {
    await expect(b).toBeVisible();
    expect((await b.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  // Above the sections.
  const top = (await choose.boundingBox())?.y ?? Infinity;
  expect(top).toBeLessThan(
    (await sheet.locator("a").first().boundingBox())?.y ?? 0,
  );
  const picker = page.waitForEvent("filechooser");
  await choose.click();
  await picker;
  await expect(sheet).toBeHidden();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await text.click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#paste-area")).toBeVisible();
});

test("your file's name: the privacy diagram shows it, and Copy command copies its command", async ({
  page,
  context,
  browserName,
}) => {
  if (browserName === "chromium")
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?still");
  const node = page.locator("#node-file .node-v");
  const copy = page.locator("#term-copy");
  await expect(node).toHaveText("photo.jpg");
  await drop(page, [fixtureDrop("photo/gps.jpg", "image/jpeg")]);
  await readerShows(page, "gps.jpg");
  await expect(node).toHaveText("gps.jpg");
  await expect(node).toHaveAttribute("title", "gps.jpg");
  await expect(copy).toHaveAttribute("title", "npx tellall gps.jpg");
  // The window still types the example's command, whose output it prints.
  await expect(page.locator("#term-body .t-cmd")).toHaveText(
    "npx tellall chatgpt-image.png",
  );
  await withClipboard(async () => {
    await copy.click();
    await expect(copy.locator("span")).toHaveText("Copied");
    if (windowsWebKit(browserName)) return;
    expect((await pasteBack(page)).text).toBe("npx tellall gps.jpg");
  });
  // Out of the list: back to photo.jpg.
  await page.getByRole("button", { name: "Remove gps.jpg from list" }).click();
  await expect(node).toHaveText("photo.jpg");
  await expect(copy).toHaveAttribute("title", "npx tellall photo.jpg");
});
