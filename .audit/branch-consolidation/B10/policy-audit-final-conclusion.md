# B10 final policy-only comparison

**PASS with two verified reference substitutions.** Frozen `docs/product-domain.md` SHA256: `3436ac6a20a3f5732e102cc6b711277fa4b375f19a71512355c825ee0e47a209`.

The strict historical-byte comparison correctly exited **1**, retained in `policy-audit-final-raw.exit`; its full JSON and unified amendment diff are preserved in `policy-audit-final-raw.json`. This result has not been normalized or relabeled as a strict pass. It reports one inserted amendment at line 1721, one Amendment process heading, intact receipts, and **all_existing_policy_bytes_preserved: true**, with empty existing_policy_diff. Removing only the insertion reproduces baseline `8511662cb8fd9748d02f413c633bf21b5cdec9ee` byte-for-byte, preserving all earlier human-apply and ownership rules and later reviewer, absolute QA, privacy/publication and diversity/provenance policies.

Individual substitution assessment:

1. Historical `(:763-766)` reference (written with inline code around the line range) becomes the named “Canonical workspace URLs and always-visible canonical board columns” section. That exact heading exists at line 751; its canonical-URLs paragraph contains the quoted old master-switch/per-user gate clause. This identifies the same superseded clause without changing the decision or any retained URL/parameter/compatibility requirement.
2. Historical `:226`, `:247` references become “Cross-cutting engineering rules” and “Migration sequence”. Exact headings exist at lines 225 and 237. The former contains widen/backfill/consumer-migration/later-narrow; the latter ends with narrowing/removal only after measured verification and a dedicated decision (line 248). They preserve the same schema-removal boundary. No authorization, rollout-storage or migration requirement changed.

A separate exact comparison confirmed that applying only those two literal replacements to the historical amendment yields the inserted bytes. No other insertion differences exist. Inserted-section SHA256: `3201cba8da7e885c578ae591433918e30350037c6cc8a43043c73a2af963c06f`.

Scope: policy-only source comparison, no runtime or wider implementation judgment. Only policy-audit receipt/conclusion files were written. No product/spec edits, staging, tests or gates.
