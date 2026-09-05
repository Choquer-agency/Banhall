# Native bootstrap review triage

All three independent Astra medium reviewers were launched before triage. Full findings are retained in reviewer files. Frozen intent unchanged; fixes remain dependency ownership/readiness and proof.

| Finding | Severity | Route | Decision |
| --- | --- | --- | --- |
| Missing local package permits npm ancestor selection | high | patch | Require local package and lockfile before npm; prove parent untouched. |
| Copier reproduction omits full TypeScript package | medium | patch | Reproduce complete relevant package layout and passing symlink-preserving control. |
| Lifecycle can change root directory ownership | medium | patch | Recheck ownership after install and sync. |
| Local executable symlink may resolve outside worker | medium | patch | Enforce containment before readiness commands. |
| Nested generated config may resolve outside worker | medium | patch | Verify actual generated tsconfig containment. |
| Sync and later version failures lack direct probes (blind + gap same claim) | medium | patch | Actual successful npm install fixtures then failing sync/tsc/vitest; assert veto and later stages skipped. |
| Native engine negative end-to-end case absent | low | reject | Existing real HookBus veto plus inspected enforcing engine path establishes boundary without deliberately deferring another product story. Evidence must distinguish this from full negative engine execution. |
| Timeout fixture does not cover descendant cleanup | low | reject | Production limitation and concrete recovery inspection already explicit. No automatic descendant cleanup is introduced or claimed. |
| Test registry can include unrelated local plugins | medium | patch | Isolate fixture project with only production manifest. |
| Live event provenance lacks source path/digest/context | medium | patch | Root records journal digest/path, surrounding events and reproducible extraction script. |
| Deployment claims lack per-project snapshot | medium | patch | Root records matching manifests and relevant preserved policy in each configured project. |
| Physical ownership claim lacks concrete filesystem data | medium | patch | Record root/config lstat and realpaths, alongside runtime checks. |
| Evidence contains obsolete future-tense handoff | low | patch | Reconcile completed and pending proof statements. |

No intent_gap, bad_spec or deferred product item arose. Root owns reinstallation at safe native boundaries and final live proof after the manifest patch; old pipeline proof remains labeled with its original digest.
