# Native dependency bootstrap evidence

Baseline revision: `c7075572f14e51433b524026db55d5520eddde03`.
Implementation is an uncommitted patch on that baseline; root owns final commit
and review closeout. Current post-review manifest SHA256:
`20fb58d4717b0377b3cc47ee3fc7f5074b48e3f6943472dd39c7d521972c687a`.

Run both probes from the integration checkout using the installed runtime:

```sh
/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python .audit/native-dependency-bootstrap/reproduce-copy.py
/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python .audit/native-dependency-bootstrap/verify-native-hook.py
```

- Baseline copier reproduction: `baseline-copy-failure.json`, generated using
  installed `install._copy_traversable` on a complete relevant layout: the full
  real TypeScript package and its `.bin/tsc` symlink. Native copy fails with
  MODULE_NOT_FOUND despite the package being present. A symlink-preserving copy
  of the same complete layout succeeds. No full node_modules copy is needed.
  This is a copier reproduction, not a live worker journal.
- Native policy parser and project registry: `native-hook-results.json` records
  successful discovery of the actual declarative manifest without Python trust.
  The registry project contains only a copy of that manifest; dispatch retains
  only that loaded plugin, excluding unrelated project plugins and builtins.
  This isolated probe passes a journal to the registry, so its `plugin-loaded`
  event with `mode: "declarative"` is probe evidence only. Installed engine.py
  lines 624–641 build the live registry without a journal; the runtime activation
  event is `plugins-active`, whose plugin list must include `npm-bootstrap`.
- Missing local input acceptance: guards veto missing package and lockfile
  fixtures before npm can search ancestors. An installed parent's dependency
  sentinel has identical hashes before and after the missing-child-package
  probe; the parent's lifecycle trace is absent.
- Installation failure acceptance: the unmodified native HookBus runs the actual
  manifest against a temporary package with an invalid local lockfile. Actual
  `npm ci` fails; the native blocking hook resolves a `defer` veto.
- Post-install readiness acceptance: real npm ci succeeds using an isolated
  package lifecycle that creates explicitly labeled fixture executables. Three
  cases then separately fail local Svelte sync, TypeScript, or Vitest with rc 7;
  each native veto defers, and exact traces prove later stages did not execute.
  The sync case suppresses its prepare-time failure and proves the explicit
  post-install sync still fails closed. A fourth fixture passes every stage.
  These scripts prove control flow, not production Svelte/TypeScript behavior.
- Ownership recheck acceptance: real lifecycle fixtures replace the dependency
  or generated directory root with a symlink, escape an executable target, or
  generate an external tsconfig symlink. All four defer through the actual hook.
- Fail-closed transport acceptance: the same bus uses an absent working directory;
  real subprocess launch fails, journal records `plugin-hook-error`, and veto is
  `defer`. These cases use the real subprocess transport, no injected runner.
- Symlink refusal acceptance: the actual manifest is run separately against
  symlinked `node_modules` and `.svelte-kit` fixtures; both exit 1 before npm and
  produce a native defer veto with the ownership error.
- Timeout acceptance: an isolated manifest fixture retains the production
  blocking/fail_closed flags and changes only command to `exec sleep 5` and
  timeout to one second. The actual native transport times out, emits
  `plugin-hook-error`, and resolves a defer veto. Its journal is separately
  labeled `timeout_fixture`; no production run journal/state is touched.
- Enforcing engine path: installed `engine.py:1848` emits this stage and returns
  false when `_vetoed` applies, before further readiness/session work.
- Live pipeline setup and local executable containment were demonstrated for
  the pre-review manifest in `live-pipeline-proof.json`, described below.
- All three independent reviews completed and yielded this patch. Root owns
  final review closeout, distribution of the post-review manifest, per-project
  policy/digest evidence and remaining native full story/product/browser gates.
  This handoff does not claim that these remaining checks have passed.

`git diff --check` passed. Ignore checks retain policy/runs exclusion while
allowing the one manifest. No product code or dependency versions changed.

## Native timeout limitation

Installed 0.11.1's hook transport uses `subprocess.run(shell=True, timeout=...)`.
Timeout produces a fail-closed defer veto and prevents coding, but subprocess
termination does not guarantee all descendant npm/lifecycle processes stopped.
Before recovery after a timeout, inspect processes and ensure the old installer
has ended before installing again or reusing/removing that worker. No engine
patch, custom controller, fabricated hook, or done marker was added. The actual
transport-failure and real harmless timeout paths were exercised. The production
1200-second install timeout was not exhausted. The readiness budget is bounded
at 20 minutes because root observed a successful worker npm install taking about
10 minutes under measured host load 97–150; 600 seconds was too tight. This
measurement was supplied by root, not remeasured by this implementation agent.

## Real native lifecycle proof

`live-pipeline-proof.json` records actual run `20260904-121631-a914`, worker
HEAD `0f5bd6b1c9161d2da7f4e828976177fe6f87003a`: `plugins-active` → blocking
pre_worktree_setup rc 0 → real Astra session-start. Both local executable probes
succeeded and resolved inside the worker's physical dependency tree.

That immutable live proof applies to pre-review manifest SHA256
`883c509231cd17cec4496c306e2568645dc5cd6b83e76e01a4bd7a091f11a87d`, not the
post-review manifest above. Its recorded digest and events remain unchanged.
Root previously installed that version into pipeline, chat-spend and learn-chat;
distribution and verification of this revised manifest remain root-owned.
Root will add original journal path/digest and extraction provenance, plus final
per-project policy/digest evidence after distribution. No synthetic native run
events or state edits were used. Native full story gates remain pending.

## Review preservation

`pre-review/` retains the original probe scripts, output JSON and evidence text.
The current results supersede the incomplete original copier reproduction.
Current fixture journals are isolated from production journals and do not assert
business-story completion. No engine-level fake events or real business-story
failure runs were needed; the enforcing native source path is documented above.
