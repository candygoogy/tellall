// The AI label (C2PA manifest store) in an image: who signed it, whether the
// signature still matches the file, what made it and what was done to it.
// c2pa-ts reads JPEG, PNG and HEIC; a WebP's label is only found, not read.
// No Node or DOM APIs: the CLI and the page's worker run this same code.
// Never throws: a label too damaged to read still comes back, with what
// could be read; no label at all is null.

// First, before c2pa-ts loads: @peculiar/x509 (used by c2pa-ts) needs a
// Reflect polyfill as soon as it's imported. Here, not in each caller, so
// Node, Vitest and the worker all get it from importing this file.
import "reflect-metadata";
import { createAsset, type Asset } from "@trustnxt/c2pa-ts/asset";
import { CBORBox, JSONBox, SuperBox } from "@trustnxt/c2pa-ts/jumbf";
import {
  ActionAssertion,
  AssertionLabels,
  IngredientAssertion,
  Manifest,
  ManifestStore,
  ValidationStatusCode,
} from "@trustnxt/c2pa-ts/manifest";
import type { ImageType } from "../image/detect.ts";
import { locate, type Range } from "./locate.ts";

export interface LabelAction {
  action: string;
  when: string | null;
  agent: string | null;
  /** The softwareAgent's name and version on their own (`agent` joins them). */
  agentName: string | null;
  agentVersion: string | null;
  description: string | null;
  sourceType: string | null;
}

export interface Field {
  name: string;
  value: string;
  from: string;
}

export interface Label {
  /** The certificate's subject O, else its CN. */
  signer: string | null;
  /** Null when not checked (WebP, or a label too damaged to check). */
  signatureMatches: boolean | null;
  /** claim_generator_info name and version. */
  generator: string | null;
  /** Earliest first: the manifests it was made from, then its own. */
  actions: LabelAction[];
  /** The first sourceType found. */
  digitalSourceType: string | null;
  /** An action starting "c2pa.watermarked", or a description naming one. */
  watermarkStated: boolean;
  ingredients: number;
  /** True when the label is there but couldn't be read (always for WebP). */
  detailsUnavailable: boolean;
  /** For "Show everything". */
  fields: Field[];
  /** What the label's metadata assertions (stds.exif, c2pa.metadata, a
   * CreativeWork) say, each value by its name without a prefix, the first
   * of a name winning. A clean copy that keeps the label keeps these. */
  metadata: Record<string, unknown>;
  /** Where the label sits, for the anatomy map. */
  range: Range | null;
}

// c2pa-ts doesn't check the certificate chain, so these say nothing about
// whether the signature matches the file. Every other failure counts.
const TRUST_CODES: ReadonlySet<string> = new Set([
  ValidationStatusCode.SigningCredentialUntrusted,
  ValidationStatusCode.TimeStampUntrusted,
]);

export async function readLabel(
  bytes: Uint8Array,
  type: ImageType,
): Promise<Label | null> {
  const range = locate(bytes, type);
  const unread = () => (range ? unreadable(range) : null);
  if (type === "webp") return unread();

  let asset: Asset;
  let store: ManifestStore;
  let active: Manifest | undefined;
  try {
    asset = await createAsset(bytes);
    const jumbf = await asset.getManifestJUMBF();
    if (!jumbf) return unread();
    store = ManifestStore.read(SuperBox.fromBuffer(jumbf));
    active = store.getActiveManifest();
  } catch {
    return unread();
  }
  if (!active) return unread();

  const fields: Field[] = [];
  const signer = attempt(() => signerOf(active, fields), null);
  const signatureMatches = await attemptAsync(
    () => checkSignature(store, asset, fields),
    null,
  );
  const generator = attempt(() => generatorOf(active, fields), null);
  const history = attempt(() => historyActions(active), []);
  const actions = history.map((h) => h.action);
  for (const { action: a, from } of history) {
    const rows: [string, string | null][] = [
      ["action", a.action],
      ["when", a.when],
      ["softwareAgent", a.agent],
      ["digitalSourceType", a.sourceType],
      ["description", a.description],
    ];
    for (const [name, value] of rows)
      if (value) fields.push({ name, value, from });
  }
  const ingredients = attempt(() => ingredientsOf(active, fields), 0);
  const metadata = attempt(() => metadataOf(store), {});

  return {
    signer,
    signatureMatches,
    generator,
    actions,
    digitalSourceType: actions.find((a) => a.sourceType)?.sourceType ?? null,
    watermarkStated: actions.some(
      (a) =>
        a.action.startsWith("c2pa.watermarked") ||
        /watermark/i.test(a.description ?? ""),
    ),
    ingredients,
    detailsUnavailable: false,
    fields,
    metadata,
    range,
  };
}

/** A label that's there but can't be read: a WebP's, or a damaged one. */
function unreadable(range: Range): Label {
  return {
    signer: null,
    signatureMatches: null,
    generator: null,
    actions: [],
    digitalSourceType: null,
    watermarkStated: false,
    ingredients: 0,
    detailsUnavailable: true,
    fields: [
      { name: "Size", value: `${range.length} bytes`, from: "C2PA label" },
    ],
    metadata: {},
    range,
  };
}

function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

async function attemptAsync<T>(
  read: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** Undoes RFC 4514 escaping in a distinguished name's display text: a
 * backslash before `,` `+` `"` `\` `<` `>` `;` `=` `#` or a space, and
 * `\XX` hex pairs (a run of them is UTF-8 bytes). */
export function unescapeDn(dn: string): string {
  return dn.replace(
    /((?:\\[0-9A-Fa-f]{2})+)|\\([ "#+,;<=>\\])/g,
    (_m, hex: string | undefined, ch: string | undefined) => {
      if (ch !== undefined) return ch;
      const bytes = Uint8Array.from(
        (hex as string).slice(1).split("\\"),
        (h) => parseInt(h, 16),
      );
      return new TextDecoder().decode(bytes);
    },
  );
}

function signerOf(manifest: Manifest, fields: Field[]): string | null {
  const cert = manifest.signature?.signatureData.certificate;
  if (!cert) return null;
  const from = "C2PA signature";
  const signer =
    cert.subjectName.getField("O")[0] ??
    cert.subjectName.getField("CN")[0] ??
    null;
  if (signer) fields.push({ name: "Signer", value: signer, from });
  fields.push({ name: "Certificate subject", value: unescapeDn(cert.subject), from });
  fields.push({ name: "Certificate issuer", value: unescapeDn(cert.issuer), from });
  return signer;
}

async function checkSignature(
  store: ManifestStore,
  asset: Asset,
  fields: Field[],
): Promise<boolean> {
  const result = await store.validate(asset);
  const failed = result.statusEntries.filter(
    (e) => e.success === false && !TRUST_CODES.has(e.code),
  );
  for (const e of failed) {
    fields.push({
      name: "Check failed",
      value: e.code,
      from: "C2PA signature check",
    });
  }
  return failed.length === 0;
}

function generatorOf(manifest: Manifest, fields: Field[]): string | null {
  const claim = manifest.claim;
  const from = "C2PA claim";
  const generator =
    [claim?.claimGeneratorName, claim?.claimGeneratorVersion]
      .filter(Boolean)
      .join(" ") || null;
  if (generator)
    fields.push({ name: "claim_generator_info", value: generator, from });
  if (claim?.title) fields.push({ name: "dc:title", value: claim.title, from });
  if (claim?.instanceID) {
    fields.push({ name: "instanceID", value: claim.instanceID, from });
  }
  return generator;
}

function ingredientsOf(manifest: Manifest, fields: Field[]): number {
  let count = 0;
  for (const a of manifest.assertions?.assertions ?? []) {
    if (!(a instanceof IngredientAssertion)) continue;
    count++;
    const from = `C2PA ${a.label}`;
    const rows: [string, string | undefined][] = [
      ["dc:title", a.title],
      ["dc:format", a.format],
      ["relationship", a.relationship],
    ];
    for (const [name, value] of rows)
      if (value) fields.push({ name, value, from });
  }
  return count;
}

/** Assertions that hold a photo's metadata as JSON-LD (or CBOR). */
const METADATA_LABELS: ReadonlySet<string> = new Set([
  ...AssertionLabels.metadataAssertions,
  AssertionLabels.creativeWork,
]);
/** The most values read from them, all together. */
const MOST_VALUES = 1000;

/** A JSON-LD value without its own keywords (@type, @id, @context), each
 * name without its prefix. */
function plain(value: unknown, depth = 0): unknown {
  if (depth > 16) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, MOST_VALUES).map((v) => plain(v, depth + 1));
  }
  if (typeof value !== "object" || value === null) return value;
  if (ArrayBuffer.isView(value) || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value).slice(0, MOST_VALUES)) {
    if (key === "@value" || key === "@list") return plain(v, depth + 1);
    if (key.startsWith("@")) continue;
    out[key.split(":").at(-1) ?? key] = plain(v, depth + 1);
  }
  return out;
}

/** Every metadata assertion's values, in every manifest of the store. */
function metadataOf(store: ManifestStore): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const manifest of store.manifests) {
    for (const assertion of manifest.assertions?.assertions ?? []) {
      if (!assertion.label || !METADATA_LABELS.has(assertion.label)) continue;
      const box = assertion.sourceBox?.contentBoxes.find(
        (b) => b instanceof JSONBox || b instanceof CBORBox,
      ) as JSONBox | CBORBox | undefined;
      const content = plain(box?.content);
      if (typeof content !== "object" || content === null) continue;
      for (const [key, value] of Object.entries(content)) {
        if (++count > MOST_VALUES) return out;
        if (!(key in out) && value !== undefined) out[key] = value;
      }
    }
  }
  return out;
}

interface Step {
  action: LabelAction;
  from: string;
}

// Actions of the manifest and, before them, of the manifests it was made
// from (Gemini puts "created" and the SynthID step in the parent manifest).
function historyActions(
  manifest: Manifest,
  depth = 0,
  seen = new Set<Manifest>(),
): Step[] {
  if (seen.has(manifest)) return [];
  seen.add(manifest);
  const earlier: Step[] = [];
  const own: Step[] = [];
  for (const assertion of manifest.assertions?.assertions ?? []) {
    if (assertion instanceof IngredientAssertion) {
      const parent = attempt(
        () => manifest.getComponentByURL(assertion.activeManifest?.uri),
        undefined,
      );
      if (parent instanceof Manifest) {
        earlier.push(...historyActions(parent, depth + 1, seen));
      }
    } else if (assertion instanceof ActionAssertion) {
      const where = `C2PA ${depth > 0 ? "ingredient " : ""}${assertion.label}`;
      const actions = attempt(() => mapActions(assertion), []);
      actions.forEach((action, i) =>
        own.push({ action, from: `${where}, action ${i + 1}` }),
      );
    }
  }
  return [...earlier, ...own];
}

function mapActions(assertion: ActionAssertion): LabelAction[] {
  // c2pa-ts's typed Action has no `when` and, for actions v2, drops the
  // action's own `description`; both are in the decoded CBOR of the box.
  const cbor = assertion.sourceBox?.contentBoxes.find(
    (b) => b instanceof CBORBox,
  );
  const raw = (
    cbor?.content as { actions?: Record<string, unknown>[] } | undefined
  )?.actions;
  const dateTexts =
    cbor instanceof CBORBox && cbor.rawContent
      ? tagZeroTexts(cbor.rawContent)
      : [];
  return assertion.actions.map((a, i) => {
    const r = Array.isArray(raw) ? raw[i] : undefined;
    const when = r?.["when"];
    const description = a.description ?? r?.["description"];
    const agent = a.softwareAgent
      ? [a.softwareAgent.name, a.softwareAgent.version]
          .filter(Boolean)
          .join(" ")
      : "";
    return {
      action: String(a.action),
      when:
        when instanceof Date
          ? exactTime(when, dateTexts)
          : typeof when === "string"
            ? when
            : null,
      agent: agent || null,
      agentName: a.softwareAgent?.name || null,
      agentVersion: a.softwareAgent?.version || null,
      description: typeof description === "string" ? description : null,
      sourceType: a.digitalSourceType ?? null,
    };
  });
}

// cbor-x turns tag-0 date strings into Dates, which keep milliseconds only.
// The original text (ChatGPT writes nanoseconds) is still in the raw CBOR:
// tag 0 (0xC0) followed by a text string (major type 3).
function tagZeroTexts(bytes: Uint8Array): string[] {
  const texts: string[] = [];
  const utf8 = new TextDecoder();
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] !== 0xc0) continue;
    const head = bytes[i + 1] ?? 0;
    let len: number, start: number;
    if (head >= 0x60 && head <= 0x77) [len, start] = [head - 0x60, i + 2];
    else if (head === 0x78 && i + 2 < bytes.length) {
      [len, start] = [bytes[i + 2] ?? 0, i + 3];
    } else continue;
    if (start + len <= bytes.length) {
      texts.push(utf8.decode(bytes.subarray(start, start + len)));
    }
  }
  return texts;
}

/** The time as the file wrote it; null for a date that isn't one. */
function exactTime(when: Date, texts: string[]): string | null {
  const ms = when.getTime();
  if (Number.isNaN(ms)) return null;
  const match = texts.find(
    (t) => new Date(t.replace(/(\.\d{3})\d+/, "$1")).getTime() === ms,
  );
  return match ?? when.toISOString();
}
