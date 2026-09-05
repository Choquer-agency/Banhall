# Native dependency bootstrap evidence

Baseline revision: `c7075572f14e51433b524026db55d5520eddde03`.
Implementation is an uncommitted patch on that baseline; root owns final commit
and independent review. Manifest SHA256:
`883c509231cd17cec4496c306e2568645dc5cd6b83e76e01a4bd7a091f11a87d`.

Run both probes from the integration checkout using the installed runtime:

```sh
/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python .audit/native-dependency-bootstrap/reproduce-copy.py
/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python .audit/native-dependency-bootstrap/verify-native-hook.py
```

- Baseline copier reproduction: `baseline-copy-failure.json`, generated using
  installed `install._copy_traversable` on the real local npm `.bin` directory.
  The copied TypeScript entrypoint becomes a regular file and fails resolving
  its sibling module. This is a copier reproduction, not a live worker journal.
- Native policy parser and project registry: `native-hook-results.json` records
  successful discovery of the actual declarative manifest without Python trust.
  This isolated probe passes a journal to the registry, so its `plugin-loaded`
  event with `mode: "declarative"` is probe evidence only. Installed engine.py
  lines 624–641 build the live registry without a journal; the runtime activation
  event is `plugins-active`, whose plugin list must include `npm-bootstrap`.
- Installation failure acceptance: the unmodified native HookBus runs the actual
  manifest against a temporary package with no lockfile. `npm ci` exits 1;
  `plugin-hook` records rc 1, blocking true; resolved veto is `defer`.
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
- Live pipeline setup before Astra session and local executable containment:
  root owns the runner and will supply actual journal and worker probes. Inspect
  runtime `plugins-active` including `npm-bootstrap`, then successful
  `plugin-hook` at `pre_worktree_setup` with rc 0 before that unit's
  `session-start`; do not expect the probe-only `plugin-loaded` event.
- Future learn-chat deployment: root owns installing the exact manifest into its
  native project and removing only dependency seeds.
- Independent review and final full product/story/browser gates remain owned by
  root. This handoff does not claim that these have passed.

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

`live-pipeline-proof.json` records actual run `20260904-121631-a914`, worker HEAD `0f5bd6b1c9161d2da7f4e828976177fe6f87003a`: `plugins-active` → blocking pre_worktree_setup rc0 → real Astra session-start. Both local executables are symlinks resolving inside that worker; version probes exit0. The manifest matches this integration copy exactly. No synthetic run events or state edits were used. The identical manifest is installed in pipeline, chat-spend and learn-chat project roots; native full story gates remain pending.
