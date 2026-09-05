# Installed browser provider options, read-only

- `node_modules/@vitest/browser-playwright/dist/index.d.ts:14` exposes `launchOptions?: Omit<LaunchOptions, "tracesDir">`; lines27-28 expose contextOptions.
- Provider `dist/index.js:881-884` forwards launchOptions and canonical headless; line941 calls `playwright[this.browserName].launch(launchOptions)`.
- Installed Playwright `types/types.d.ts:24951-24959` documents channel `chromium` as opting into new headless mode. `lib/coreBundle.js:43099-43106` selects full `chromium` for the alias; omitted channel plus headless selects `chromium-headless-shell`.
- `coreBundle.js:37407-37408` only sends touch emulation when hasTouch is true. hasTouch:false does not set a fine pointer and cannot replace an embedder-default assumption.

Supported candidate syntax: `playwright({ launchOptions: { channel: "chromium" } })`. This is only a candidate until root's real Linux probe establishes input-state behavior. If selected, optional gate preflight must launch the same channel with headless:true and existing timeout/cleanup, not validate the obsolete shell distribution. Existing headless-shell-only acceptance controls would be explicitly superseded; verify full-Chromium-only and shell-only states against the new chosen contract. Current install chromium command installs both distributions; no new dependency is implied. No source edits made during this inspection.
