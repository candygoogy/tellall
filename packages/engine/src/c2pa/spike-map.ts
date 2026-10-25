// Spike (plan Tasks 1-2): can c2pa-ts read the AI labels in our fixtures?
// readActiveBytes() maps c2pa-ts's manifest store to the few fields tellall
// needs. No Node or DOM APIs: the Node test and the browser worker both use it.
// Callers load "reflect-metadata" first (@peculiar/x509, used by c2pa-ts,
// needs a Reflect polyfill).
import { createAsset } from "@trustnxt/c2pa-ts/asset";
import { CBORBox, SuperBox } from "@trustnxt/c2pa-ts/jumbf";
import {
  ActionAssertion,
  IngredientAssertion,
  Manifest,
  ManifestStore,
  ValidationStatusCode,
} from "@trustnxt/c2pa-ts/manifest";

export interface SpikeAction {
  action: string;
  when?: string;
  agent?: string;
  sourceType?: string;
  description?: string;
}

export interface SpikeLabel {
  signerOrg: string | undefined;
  signatureMatches: boolean;
  actions: SpikeAction[];
}

// c2pa-ts doesn't check the certificate chain, so these say nothing about
// whether the signature matches the file. Every other failure counts.
const TRUST_CODES: ReadonlySet<string> = new Set([
  ValidationStatusCode.SigningCredentialUntrusted,
  ValidationStatusCode.TimeStampUntrusted,
]);

export async function readActiveBytes(bytes: Uint8Array): Promise<SpikeLabel | null> {
  const asset = await createAsset(bytes);
  const jumbf = await asset.getManifestJUMBF();
  if (!jumbf) return null;
  const store = ManifestStore.read(SuperBox.fromBuffer(jumbf));
  const active = store.getActiveManifest();
  if (!active) return null;
  const result = await store.validate(asset);

  const cert = active.signature?.signatureData.certificate;
  const signerOrg = cert?.subjectName.getField("O")[0] ?? cert?.subjectName.getField("CN")[0];
  const signatureMatches = result.statusEntries.every(
    (e) => e.success !== false || TRUST_CODES.has(e.code),
  );
  return { signerOrg, signatureMatches, actions: historyActions(active) };
}

// Actions of the manifest and, before them, of the manifests it was made
// from (Gemini puts "created" and the SynthID step in the parent manifest).
function historyActions(manifest: Manifest, seen = new Set<Manifest>()): SpikeAction[] {
  if (seen.has(manifest)) return [];
  seen.add(manifest);
  const earlier: SpikeAction[] = [];
  const own: SpikeAction[] = [];
  for (const assertion of manifest.assertions?.assertions ?? []) {
    if (assertion instanceof IngredientAssertion) {
      const parent = manifest.getComponentByURL(assertion.activeManifest?.uri);
      if (parent instanceof Manifest) earlier.push(...historyActions(parent, seen));
    } else if (assertion instanceof ActionAssertion) {
      own.push(...mapActions(assertion));
    }
  }
  return [...earlier, ...own];
}

function mapActions(assertion: ActionAssertion): SpikeAction[] {
  // c2pa-ts's typed Action has no `when` and, for actions v2, drops the
  // action's own `description`; both are in the decoded CBOR of the box.
  const cbor = assertion.sourceBox?.contentBoxes.find((b) => b instanceof CBORBox);
  const raw = (cbor?.content as { actions?: Record<string, unknown>[] } | undefined)?.actions;
  const dateTexts = cbor instanceof CBORBox && cbor.rawContent ? tagZeroTexts(cbor.rawContent) : [];
  return assertion.actions.map((a, i) => {
    const r = raw?.[i];
    const out: SpikeAction = { action: a.action };
    const when = r?.["when"];
    if (when instanceof Date) out.when = exactTime(when, dateTexts);
    else if (typeof when === "string") out.when = when;
    if (a.softwareAgent) {
      out.agent = [a.softwareAgent.name, a.softwareAgent.version].filter(Boolean).join(" ");
    }
    if (a.digitalSourceType) out.sourceType = a.digitalSourceType;
    const description = a.description ?? r?.["description"];
    if (typeof description === "string") out.description = description;
    return out;
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
    const head = bytes[i + 1]!;
    let len: number, start: number;
    if (head >= 0x60 && head <= 0x77) [len, start] = [head - 0x60, i + 2];
    else if (head === 0x78 && i + 2 < bytes.length) [len, start] = [bytes[i + 2]!, i + 3];
    else continue;
    if (start + len <= bytes.length) texts.push(utf8.decode(bytes.subarray(start, start + len)));
  }
  return texts;
}

function exactTime(when: Date, texts: string[]): string {
  const ms = when.getTime();
  const match = texts.find((t) => new Date(t.replace(/(\.\d{3})\d+/, "$1")).getTime() === ms);
  return match ?? when.toISOString();
}
