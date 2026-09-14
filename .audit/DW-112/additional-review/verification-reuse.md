# DW-112 verification evidence reuse

## Result

Reuse is proven for the existing post-repair verification receipts against the current runtime, test, package, lock, gate, and configuration bytes.

- Source commit: `0b34a249bac1a7c7e618308ee0416c4826214ccd`
- Current HEAD: `612a948c803525f025f44eb05bad205d5d83c8aa`
- Current HEAD parent: `0b34a249bac1a7c7e618308ee0416c4826214ccd`
- The only commit after the source commit changes `.audit/DW-112/decisions.tsv` and adds `.audit/DW-112/local-completion/evidence.md`.
- The only current tracked working changes are `.audit/DW-112/decisions.tsv` and `_bmad-output/implementation-artifacts/spec-dw-112-brief-derivation-concurrency.md`.
- No runtime, test, package, lock, gate, or configuration path differs from the source commit in either `HEAD` or the current working tree.
- All four recorded DW-112 source SHA-256 values match both the current files and the files in the source commit.
- All six focused, Convex typecheck, and canonical receipt files match their committed blobs in the source commit.
- The canonical receipt records `ACTUAL_EXIT_CODE=0`, nine expected step headings, nine `ok` markers, 187 passing test files, 2,677 passing tests, 0 Svelte errors, 0 Svelte warnings, 93 passing PowerShell harness checks, and 47 passing Bash harness checks.
- The focused receipt records `ACTUAL_EXIT_CODE=0`, one passing test file, and 39 passing tests.
- The Convex typecheck receipt records `ACTUAL_EXIT_CODE=0`. Its command produced no compiler diagnostics after the receipt header.

No test, typecheck, build, install, or workflow was rerun. The supervisor required reuse of passing proof while the verified bytes remain unchanged.

## Read-only checks and exact outputs

### Commit and change scope

Command:

```sh
source_commit=0b34a249bac1a7c7e618308ee0416c4826214ccd
printf 'HEAD=%s\n' "$(git rev-parse HEAD)"
printf 'SOURCE_COMMIT=%s\n' "$(git rev-parse "$source_commit^{commit}")"
printf 'HEAD_PARENT=%s\n' "$(git rev-parse HEAD^)"
printf '%s\n' 'committed changes after source commit:'
git diff --name-status "$source_commit..HEAD"
printf '%s\n' 'working-tree tracked changes:'
git status --short
printf '%s\n' 'runtime/test/package/gate/config changes after source commit:'
git diff --name-status "$source_commit..HEAD" -- convex src tests scripts package.json package-lock.json .nvmrc tsconfig.json svelte.config.ts vite.config.ts vitest.config.ts vitest.component.config.ts
printf '%s\n' 'runtime/test/package/gate/config working changes:'
git diff --name-status -- convex src tests scripts package.json package-lock.json .nvmrc tsconfig.json svelte.config.ts vite.config.ts vitest.config.ts vitest.component.config.ts
```

Output, exit 0:

```text
HEAD=612a948c803525f025f44eb05bad205d5d83c8aa
SOURCE_COMMIT=0b34a249bac1a7c7e618308ee0416c4826214ccd
HEAD_PARENT=0b34a249bac1a7c7e618308ee0416c4826214ccd
committed changes after source commit:
M	.audit/DW-112/decisions.tsv
A	.audit/DW-112/local-completion/evidence.md
working-tree tracked changes:
 M .audit/DW-112/decisions.tsv
 M _bmad-output/implementation-artifacts/spec-dw-112-brief-derivation-concurrency.md
runtime/test/package/gate/config changes after source commit:
runtime/test/package/gate/config working changes:
```

### DW-112 source SHA-256 binding

Command:

```sh
source_commit=0b34a249bac1a7c7e618308ee0416c4826214ccd
for file in convex/ai/brief.test.ts convex/ai/brief.ts convex/lib/briefRender.ts convex/generations.ts; do
  current_sha=$(shasum -a 256 "$file" | awk '{print $1}')
  commit_sha=$(git show "$source_commit:$file" | shasum -a 256 | awk '{print $1}')
  printf '%s current=%s source_commit=%s match=%s\n' "$file" "$current_sha" "$commit_sha" "$([ "$current_sha" = "$commit_sha" ] && printf yes || printf no)"
done
```

Output, exit 0:

```text
convex/ai/brief.test.ts current=71f8aafa934541d8a70add72829382a5c9a0aa74402df133a360137b2e0ca008 source_commit=71f8aafa934541d8a70add72829382a5c9a0aa74402df133a360137b2e0ca008 match=yes
convex/ai/brief.ts current=505727fdb8a83b8f177f22c44e7acc845aa6254fdf7cca9b69f0f9f9b6117e00 source_commit=505727fdb8a83b8f177f22c44e7acc845aa6254fdf7cca9b69f0f9f9b6117e00 match=yes
convex/lib/briefRender.ts current=88389d3f5426cae240f41dc8bc8682740ae2855e91e9b53a347a0b5a35fb2428 source_commit=88389d3f5426cae240f41dc8bc8682740ae2855e91e9b53a347a0b5a35fb2428 match=yes
convex/generations.ts current=63d00ebe932128988c573880fddab59ffac6df14be5a70e5b26fdc862355a5ab source_commit=63d00ebe932128988c573880fddab59ffac6df14be5a70e5b26fdc862355a5ab match=yes
```

### Package, lock, gate, and configuration blob binding

Command:

```sh
source_commit=0b34a249bac1a7c7e618308ee0416c4826214ccd
for file in package.json package-lock.json .nvmrc scripts/loop-verify.sh scripts/check-test-discovery.mjs tsconfig.json convex/tsconfig.json vite.config.ts vitest.config.ts vitest.component.config.ts; do
  current_blob=$(git hash-object "$file")
  source_blob=$(git rev-parse "$source_commit:$file")
  if [ "$current_blob" = "$source_blob" ]; then match=yes; else match=no; fi
  printf '%s current_blob=%s source_commit_blob=%s match=%s\n' "$file" "$current_blob" "$source_blob" "$match"
done
```

Output, exit 0:

```text
package.json current_blob=77c8ce339490eef454c4c559b09e7af2e00b07d9 source_commit_blob=77c8ce339490eef454c4c559b09e7af2e00b07d9 match=yes
package-lock.json current_blob=aafce46345d6f631cb4b86e345c2c786b91a6181 source_commit_blob=aafce46345d6f631cb4b86e345c2c786b91a6181 match=yes
.nvmrc current_blob=a45fd52cc5891570d6299fab38643103c3955474 source_commit_blob=a45fd52cc5891570d6299fab38643103c3955474 match=yes
scripts/loop-verify.sh current_blob=3c2c195609f22dc0c03603f6dc16683a60bfa029 source_commit_blob=3c2c195609f22dc0c03603f6dc16683a60bfa029 match=yes
scripts/check-test-discovery.mjs current_blob=013ec7207d9ac780855857fe483d772c16058b6d source_commit_blob=013ec7207d9ac780855857fe483d772c16058b6d match=yes
tsconfig.json current_blob=413356d4f5d52e03eac6d070e1cf2a4cf1e18779 source_commit_blob=413356d4f5d52e03eac6d070e1cf2a4cf1e18779 match=yes
convex/tsconfig.json current_blob=9fb088ba980fce46bd79e9362df14f45edad57e0 source_commit_blob=9fb088ba980fce46bd79e9362df14f45edad57e0 match=yes
vite.config.ts current_blob=3b79b23bfce83c126068e61a870a11e184202308 source_commit_blob=3b79b23bfce83c126068e61a870a11e184202308 match=yes
vitest.config.ts current_blob=2d005185b2d972d0674f2005380f10db1f3a0314 source_commit_blob=2d005185b2d972d0674f2005380f10db1f3a0314 match=yes
vitest.component.config.ts current_blob=dcea9b06debd13a48d3f8da2c8e2ec0dc631480d source_commit_blob=dcea9b06debd13a48d3f8da2c8e2ec0dc631480d match=yes
```

### Receipt integrity and provenance

Command:

```sh
sha256sum .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.log .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.meta .audit/DW-112/local-completion/patch-focused-20260914T1130Z.log .audit/DW-112/local-completion/patch-focused-20260914T1130Z.meta .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.log .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.meta
for file in .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.log .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.meta .audit/DW-112/local-completion/patch-focused-20260914T1130Z.log .audit/DW-112/local-completion/patch-focused-20260914T1130Z.meta .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.log .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.meta; do
  current_blob=$(git hash-object "$file")
  source_blob=$(git rev-parse "0b34a249bac1a7c7e618308ee0416c4826214ccd:$file")
  if [ "$current_blob" = "$source_blob" ]; then match=yes; else match=no; fi
  printf '%s current_blob=%s source_commit_blob=%s match=%s\n' "$file" "$current_blob" "$source_blob" "$match"
done
```

Output, exit 0:

```text
ef1e3740719e4814a972f6c3f853dc280fba086b02636131a787506ff82e8dc5  .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.log
f6093eb46bf8de8b16e49ed5f9b3ec2c39e9d2b0f109b44eb875e02dcf89b378  .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.meta
1eb511b26336d303222c2863ee98099ecc2c617e4660e02a13340ba038c76573  .audit/DW-112/local-completion/patch-focused-20260914T1130Z.log
f6093eb46bf8de8b16e49ed5f9b3ec2c39e9d2b0f109b44eb875e02dcf89b378  .audit/DW-112/local-completion/patch-focused-20260914T1130Z.meta
bab026230af07c7495a73cb48f2c0ff2cf0d762f36cc62daf463fb6379bc3c54  .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.log
f6093eb46bf8de8b16e49ed5f9b3ec2c39e9d2b0f109b44eb875e02dcf89b378  .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.meta
.audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.log current_blob=783bb0bb46c7db88f816fc5dd99e3e76cbf9ce55 source_commit_blob=783bb0bb46c7db88f816fc5dd99e3e76cbf9ce55 match=yes
.audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.meta current_blob=cfb5a1962fa2d6c097f0e20d61459053d4a3984d source_commit_blob=cfb5a1962fa2d6c097f0e20d61459053d4a3984d match=yes
.audit/DW-112/local-completion/patch-focused-20260914T1130Z.log current_blob=331cea33231344818bc39db51cb900ee0da34f56 source_commit_blob=331cea33231344818bc39db51cb900ee0da34f56 match=yes
.audit/DW-112/local-completion/patch-focused-20260914T1130Z.meta current_blob=cfb5a1962fa2d6c097f0e20d61459053d4a3984d source_commit_blob=cfb5a1962fa2d6c097f0e20d61459053d4a3984d match=yes
.audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.log current_blob=b32d28a0be3caff15d4460374417451ac90a20cb source_commit_blob=b32d28a0be3caff15d4460374417451ac90a20cb match=yes
.audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.meta current_blob=cfb5a1962fa2d6c097f0e20d61459053d4a3984d source_commit_blob=cfb5a1962fa2d6c097f0e20d61459053d4a3984d match=yes
```

### Canonical gate metadata and captured outcomes

Command:

```sh
printf '%s\n' 'canonical metadata:'
sed -n '1,20p' .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.meta
printf '%s\n' 'canonical step/result lines:'
rg -n '^\[[1-9]/9\]|^ok [0-9]+s$|^\s*(Test Files|Tests)\s|^\s*svelte-check found|^discovered [0-9]+ executable test files|^\s*[0-9]+ passed, [0-9]+ failed$' .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.log
printf '%s\n' 'canonical failure marker check:'
if rg -n '^loop-verify: .* failed, exit ' .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.log; then printf '%s\n' 'unexpected failure marker present'; else printf '%s\n' 'no loop-verify failure marker'; fi
printf 'step_headings=%s ok_markers=%s\n' "$(rg -c '^\[[1-9]/9\]' .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.log)" "$(rg -c '^ok [0-9]+s$' .audit/DW-112/local-completion/patch-loop-verify-20260914T1130Z.log)"
```

Output, exit 0:

```text
canonical metadata:
ACTUAL_EXIT_CODE=0
SOURCE_SHA256_AFTER:
71f8aafa934541d8a70add72829382a5c9a0aa74402df133a360137b2e0ca008  convex/ai/brief.test.ts
505727fdb8a83b8f177f22c44e7acc845aa6254fdf7cca9b69f0f9f9b6117e00  convex/ai/brief.ts
88389d3f5426cae240f41dc8bc8682740ae2855e91e9b53a347a0b5a35fb2428  convex/lib/briefRender.ts
63d00ebe932128988c573880fddab59ffac6df14be5a70e5b26fdc862355a5ab  convex/generations.ts
canonical step/result lines:
8:[1/9] preflight
12:ok 0s
13:[2/9] no skipped tests
14:ok 0s
15:[3/9] convex typecheck
16:ok 12s
17:[4/9] svelte-check
25:svelte-check found 0 errors and 0 warnings
26:ok 19s
27:[5/9] unit tests
36: Test Files  187 passed (187)
37:      Tests  2677 passed (2677)
41:ok 29s
42:[6/9] test discovery guard
46:discovered 268 executable test files; accounted for 3 historical archives
47:ok 2s
48:[7/9] production build
425:ok 29s
426:[8/9] uploader harness (pwsh)
522:93 passed, 0 failed
523:ok 9s
524:[9/9] uploader harness (bash)
573:47 passed, 0 failed
574:ok 6s
canonical failure marker check:
no loop-verify failure marker
step_headings=9 ok_markers=9
```

### Focused and Convex typecheck metadata and outcomes

Command:

```sh
printf '%s\n' 'focused metadata:'
sed -n '1,20p' .audit/DW-112/local-completion/patch-focused-20260914T1130Z.meta
printf '%s\n' 'focused command/result:'
rg -n '^COMMAND=|^\s*(Test Files|Tests|Duration)\s' .audit/DW-112/local-completion/patch-focused-20260914T1130Z.log
printf '%s\n' 'typecheck metadata:'
sed -n '1,20p' .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.meta
printf '%s\n' 'typecheck command and line count:'
rg -n '^COMMAND=' .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.log
wc -l .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.log
```

Output, exit 0:

```text
focused metadata:
ACTUAL_EXIT_CODE=0
SOURCE_SHA256_AFTER:
71f8aafa934541d8a70add72829382a5c9a0aa74402df133a360137b2e0ca008  convex/ai/brief.test.ts
505727fdb8a83b8f177f22c44e7acc845aa6254fdf7cca9b69f0f9f9b6117e00  convex/ai/brief.ts
88389d3f5426cae240f41dc8bc8682740ae2855e91e9b53a347a0b5a35fb2428  convex/lib/briefRender.ts
63d00ebe932128988c573880fddab59ffac6df14be5a70e5b26fdc862355a5ab  convex/generations.ts
focused command/result:
1:COMMAND=npm test -- convex/ai/brief.test.ts
16: Test Files  1 passed (1)
17:      Tests  39 passed (39)
19:   Duration  3.43s (transform 620ms, setup 0ms, import 584ms, tests 2.70s, environment 39ms)
typecheck metadata:
ACTUAL_EXIT_CODE=0
SOURCE_SHA256_AFTER:
71f8aafa934541d8a70add72829382a5c9a0aa74402df133a360137b2e0ca008  convex/ai/brief.test.ts
505727fdb8a83b8f177f22c44e7acc845aa6254fdf7cca9b69f0f9f9b6117e00  convex/ai/brief.ts
88389d3f5426cae240f41dc8bc8682740ae2855e91e9b53a347a0b5a35fb2428  convex/lib/briefRender.ts
63d00ebe932128988c573880fddab59ffac6df14be5a70e5b26fdc862355a5ab  convex/generations.ts
typecheck command and line count:
1:COMMAND=npx tsc --noEmit -p convex/tsconfig.json
       7 .audit/DW-112/local-completion/patch-convex-tsc-20260914T1130Z.log
```

## Limits

This is evidence reuse, not a fresh execution. It proves that the saved successful receipts apply to the unchanged current runtime, test, package, lock, gate, and configuration bytes. It does not revalidate the present machine environment, dependency installation state, or external services.

The canonical receipt is the repository's browser-free nine-step gate. It does not include the optional component suite. DW-112 changes no component source, and component configuration is byte-identical to the source commit.

The current specification and append-only audit decisions log working bytes differ from `HEAD`; they are workflow-owned documentation and audit evidence outside the verified executable path. The native deferred-work ledger is unchanged. This role did not modify or interpret those files.
