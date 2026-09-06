# B7 retained-package advisory audit

Read-only `npm audit --json` completed with actual exit **1**, using the current locked installation. Full stdout, stderr, exit and command receipt are peer-audit.json, peer-audit.stderr.log, peer-audit.exit and peer-audit-command.json. No fixes, installs, configuration changes or tests were run.

Registry response reports **11 affected package entries: 1 low, 7 moderate, 3 high, 0 critical**. This counts package entries, not distinct advisories. Every affected installed version and its entire lock record is unchanged from B7 before-package-lock.json. These are retained baseline exposures, not newly introduced package versions or missing dependencies from pruning. This does not establish whether all other historical advisory results were identical; no baseline network audit was run.

|Package|Installed version|Severity|Lock path|Unchanged complete baseline record|
|---|---|---|---|---|
|@anthropic-ai/sdk|0.82.0|moderate|node_modules/@anthropic-ai/sdk|True|
|@sveltejs/kit|2.70.1|moderate|node_modules/@sveltejs/kit|True|
|@tiptap/core|3.28.0|moderate|node_modules/@tiptap/core|True|
|@xmldom/xmldom|0.8.13|moderate|node_modules/@xmldom/xmldom|True|
|brace-expansion|5.0.7|high|node_modules/glob/node_modules/brace-expansion|True|
|cookie|0.6.0|low|node_modules/cookie|True|
|dompurify|3.4.12|moderate|node_modules/dompurify|True|
|mermaid|11.16.0|moderate|node_modules/mermaid|True|
|nanoid|3.3.16|high|node_modules/postcss/node_modules/nanoid|True|
|postcss|8.5.20|moderate|node_modules/postcss|True|
|tar|7.5.20|high|node_modules/tar|True|

## Exact registry advisory evidence

- **@anthropic-ai/sdk**: [Claude SDK for TypeScript has Insecure Default File Permissions in Local Filesystem Memory Tool](https://github.com/advisories/GHSA-p7fg-763f-g4gf) (>=0.79.0 <0.91.1).
- **@sveltejs/kit**: [SvelteKit: ReDoS (O(n^2)) in content negotiation — unauthenticated DoS via the Accept header](https://github.com/advisories/GHSA-29g2-3rmr-qm68) (<=2.70.1); inherited via cookie.
- **@tiptap/core**: [Tiptap: mergeAttributes() turns an own __proto__ key into inherited executable DOM attributes](https://github.com/advisories/GHSA-cp6q-959q-f8rh) (>=2.0.0-alpha.0 <3.30.4).
- **@xmldom/xmldom**: [xmldom: XML fragment injection via invalid EntityReference.nodeName during requireWellFormed serialization](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6) (>=0.7.0 <=0.8.14).
- **brace-expansion**: [brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash](https://github.com/advisories/GHSA-mh99-v99m-4gvg) (>=4.0.0 <5.0.8); [brace-expansion: DoS via unbounded intermediate arrays, bypassing the CVE-2026-14257 mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) (>=4.0.0 <5.0.9).
- **cookie**: [cookie accepts cookie name, path, and domain with out of bounds characters](https://github.com/advisories/GHSA-pxg6-pf52-xh8x) (<0.7.0).
- **dompurify**: [DOMPurify: IN_PLACE hook removal leaves a detached subtree executable, causing XSS](https://github.com/advisories/GHSA-55q2-fjhq-7xh7) (<=3.4.12).
- **mermaid**: [Mermaid configuration APIs allow prototype pollution](https://github.com/advisories/GHSA-c4c3-pg64-4m4v) (>=11.0.0-alpha.1 <11.16.1); [Mermaid allows CSS injection applying to sibling elements of the diagram](https://github.com/advisories/GHSA-6x64-9x62-f2gx) (>=11.0.0-alpha.1 <11.16.1); [Mermaid Architecture diagrams are vulnerable to prototype pollution](https://github.com/advisories/GHSA-3rrr-jr9j-h3q3) (>=11.5.0 <11.16.1); [Mermaid XY Charts are vulnerable to an infinite loop DoS](https://github.com/advisories/GHSA-2v8p-3f2j-5mp7) (>=11.0.0-alpha.1 <11.16.1); [Mermaid radar diagrams are vulnerable to DoS](https://github.com/advisories/GHSA-rhh3-jpg6-66xh) (>=11.6.0 <11.16.1).
- **nanoid**: [nanoid: custom generators can loop indefinitely when size is zero](https://github.com/advisories/GHSA-2v37-7h3g-55p8) (<3.3.18).
- **postcss**: [PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) (<=8.5.22).
- **tar**: [node-tar: Uncontrolled recursion in mapHas/filesFilter allows uncatchable stack-overflow DoS via crafted long-path tar with member selection](https://github.com/advisories/GHSA-r292-9mhp-454m) (<=7.5.20).

## BMAD triage boundary

Retain a separate dependency-security follow-up with the above package/version/advisory evidence. Severity alone does not prove an exploitable application path. Before selecting upgrades, assess actual vulnerable API use, attacker-controlled inputs, deployment exposure and upgrade compatibility; no such runtime exploitability review was performed here. Do not label the graph/audit healthy. The required React peer remains a separate dependency-contract issue, now correctly qualified in final B7 evidence; it is not one of these registry advisory entries.

## Evidence binding

- `.audit/branch-consolidation/B7/peer-audit.json` SHA-256 `889643571712390ab11cd12ccb45f3c4f07bbaac8ca26e4b823b00b83ef4b429`
- `.audit/branch-consolidation/B7/peer-audit.stderr.log` SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- `.audit/branch-consolidation/B7/peer-audit.exit` SHA-256 `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865`
- `.audit/branch-consolidation/B7/before-package-lock.json` SHA-256 `d4213ef7b50aa850ea095dbe6c65b35306ae7589a90073c0e377147421a33dac`
- `package-lock.json` SHA-256 `d31482119f86dae5aae70a05ffcb19b1ed9cab43bb460b738f1aa0686906cda3`
