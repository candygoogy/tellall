// Before first paint (inlined into index.html by csp.ts, allowed by its
// hash). The page is dark only, so there is no theme to set. What it does:
// when the opening will move (no reduced motion, no ?still), the parts it
// brings in wait hidden until main.ts has set them up, so the headline
// never shows and then vanishes. hero.css shows them after 3 s if main.ts
// never runs.
(() => {
  if (/[?&]still\b/.test(location.search)) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.documentElement.classList.add("intro");
})();
