// From Photo check (candygoogy/experiments, shared/stale.ts), MIT, same author.

// A part of the page's code that couldn't be fetched (the error Chrome and
// Firefox give, then Safari's): most likely a newer version of the page,
// deployed since this one opened, took its place. reloadIfGone() reloads
// the page, for the current files, as candygoogy.dev's loader does (its
// src/scripts/loader.ts): never offline, where a reload would lose the
// page, and once until settle() says the code has since loaded, so a tab
// left open across two deploys reloads for each, but a reload that didn't
// help is never repeated and it can never loop. Only for a tool whose input
// survives a reload (photo's files are still on the disk); one with pasted
// text (compose) says so with missingModule() instead.
const MISSING = /dynamically imported module|Importing a module script failed/;

export const missingModule = (error: unknown): boolean =>
  MISSING.test(String(error));

/** Reloads the page for a missing module file; true when it does. */
export const reloadIfGone = (error: unknown): boolean =>
  missingModule(error) && reloadOnce();

/** Reloads the page for its current files, if it hasn't since the last
 * settle() and isn't offline; true when it does. For a file known to be
 * gone that gives no error to read (a worker's script). */
export function reloadOnce(): boolean {
  try {
    if (navigator.onLine && !sessionStorage.getItem("stale-reload")) {
      sessionStorage.setItem("stale-reload", "1");
      location.reload();
      return true;
    }
  } catch {
    // No sessionStorage (blocked): the page says something went wrong.
  }
  return false;
}

/** The code reloadIfGone() and reloadOnce() guard has loaded: the next
 * missing file, from a later deploy, may reload the page again. Only ever
 * called on success, so a reload that didn't help is never repeated. */
export function settle(): void {
  try {
    sessionStorage.removeItem("stale-reload");
  } catch {
    // No sessionStorage (blocked): reloadOnce() never reloads anyway.
  }
}
