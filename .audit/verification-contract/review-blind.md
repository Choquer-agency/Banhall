# Fresh blind review

- scripts/loop-verify.sh Chromium preflight checks regular browser while the actual headless runner may use chromium-headless-shell; normal-only and headless-only installations may be misclassified.
- scripts/check-test-discovery.mjs newline-delimited quoted Git paths may differ from Vitest for Unicode, tabs or quotes; use NUL paths.
- Git is a mandatory discovery dependency but absent from preflight.
- VERIFY_COMPONENT values other than 1 silently disable browser checks; consider validating 0/1.
- Nonempty node_modules does not prove ownership/freshness; document or validate prerequisite.
- README local Linux Chromium setup omits system dependencies; CI uses --with-deps.
- No fresh default gate success with empty browser cache is retained.
- Historical screenshot rewrites require contributor-visible guidance.
- Immutable helper compares contents, not modes/object types.
- Immutable helper baseline-only inventory cannot account for unexpected new files.
- Workflow status-check names changed; final integration should verify required-check mapping.

Raw layer result returned to coordinator; this record preserves every distinct candidate claim. No triage or source reaction until all four fresh layers run.
