// @ts-check
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const PEERS = [
  "RTCPeerConnection",
  "webkitRTCPeerConnection",
  "RTCDataChannel",
];
const PEER = "A tool connects nowhere, and its CSP doesn't stop WebRTC.";
const AWAY = "A tool never sends the page elsewhere; its CSP doesn't stop it.";
// `location` itself, or window's or document's.
const LOCATION =
  ":matches([object.name='location'], [object.property.name='location'])";

export default defineConfig(
  {
    ignores: [
      "**/dist/",
      "**/.wrangler/",
      "shared/fonts/",
      ".shots/",
      "test-results/",
      "playwright-report/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  // Every tool but Mail check is said to be blocked from connecting
  // anywhere. Their CSP (connect-src 'none') blocks fetches, but not a
  // peer connection or sending the page somewhere else, so no tool's code
  // (Mail check's too) does either. location.reload() stays: it loads the
  // same page again (shared/stale.ts).
  {
    files: ["*/src/**", "shared/**"],
    ignores: ["shared/test/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...PEERS.map((name) => ({ name, message: PEER })),
        { name: "open", message: AWAY },
      ],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].flatMap((object) => [
          ...PEERS.map((property) => ({ object, property, message: PEER })),
          { object, property: "open", message: AWAY },
        ]),
      ],
      "no-restricted-syntax": [
        "error",
        ...[
          // location = …, window.location = …, document.location = …
          "AssignmentExpression > Identifier.left[name='location']",
          "AssignmentExpression > MemberExpression.left[property.name='location']",
          // location.href = … (and any other part of the address)
          `AssignmentExpression > MemberExpression.left${LOCATION}`,
          `CallExpression > MemberExpression.callee[property.name=/^(assign|replace)$/]${LOCATION}`,
        ].map((selector) => ({ selector, message: AWAY })),
      ],
    },
  },
);
