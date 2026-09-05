# External research digest, round 1

Accessed: 2026-09-04. Scope: external engineering and risk guidance only. No project files inspected. The description of independently populated streams and the 2-writer/2-project rule is question context, not verified project evidence. This digest does not choose product policy.

Method: discovered Exa callable tool metadata, searched three queries, fetched selected primary sources through Exa. Firecrawl has no callable tools in this task and was not used. Five distinct pages appeared in retrieved results; four inform findings. Databricks pages are one publisher, not independent corroboration. NIST is an independent publisher. No external conclusion below relies solely on memory.

## Observed source findings

| ID | Claim observed in retrieved source | Source URL / publisher | Publication date | Accessed | Confidence | Class |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | Databricks provides retain-with-metrics, drop-with-metrics, and fail actions. Fail stops an update when invalid records are unacceptable and atomically rolls back a table update. | https://docs.databricks.com/aws/en/ldp/expectations / Databricks | Updated 2026-07-14 | 2026-09-04 | High for documented API behavior | Primary official engineering documentation |
| F2 | Failure scope differs by execution mode: a failed triggered flow does not fail other parallel flows; a continuous flow failure stops that flow and dependent flows. | https://docs.databricks.com/aws/en/ldp/expectations / Databricks | Updated 2026-07-14 | 2026-09-04 | High | Primary official engineering documentation |
| F3 | Quarantine uses separate processing paths for valid and invalid records. A validation table does not itself gate downstream tables; explicit pipelines and task dependencies are required to prevent downstream work after validation failure. | https://docs.databricks.com/aws/en/ldp/expectation-patterns / Databricks | Updated 2026-07-14 | 2026-09-04 | High | Primary official engineering documentation |
| F4 | NIST suggests context-specific representativeness thresholds, disaggregated evaluation, assessment of source completeness/balance, and documentation of provenance including origins, transformations, dependencies, constraints and metadata. | https://airc.nist.gov/airmf-resources/playbook/measure/ / NIST | Not stated in retrieved page | 2026-09-04 | High for suggested guidance, not mandatory applicability | Primary official AI risk guidance |
| F5 | NIST describes disclosure risk evaluation and formal privacy methods. Correct k-anonymity depends on identifying quasi-identifiers; such methods do not quantify cumulative privacy loss across multiple releases. Attribute inference remains a concern even when a person cannot be matched to a record. | https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-188.pdf / NIST | September 2023; editorial approval 2023-09-07 | 2026-09-04 | High | Primary official privacy guidance |

Minimal source excerpts: F1: “When invalid records are unacceptable”; F3: “A validation table doesn't gate its downstream tables.” F4: “Establish thresholds and alert procedures for dataset representativeness within the context of use.” F5: “k-anonymity and related techniques are not compositional.” All other source treatment is paraphrase; quoted words per source remain below 25.

## Conditional implications, explicitly inference

1. **Scoped omission is an available engineering pattern, not a dictated policy.** F1 and F3 demonstrate that valid data can proceed while invalid data is excluded or quarantined. By analogy, excluding a weak stream could preserve useful qualifying streams if the digest's allowed claims remain valid with that subset. Confidence: medium for transfer to this product. Classification: engineering analogy. Sources: https://docs.databricks.com/aws/en/ldp/expectations and https://docs.databricks.com/aws/en/ldp/expectation-patterns (Databricks, updated 2026-07-14, accessed 2026-09-04).

2. **Whole-candidate stop is coherent when validity belongs to the complete output.** F1 explicitly supports failure when invalid input is unacceptable. F3 distinguishes validation from downstream gating. Applied conditionally, stop may be appropriate if the digest promises complete coverage, the omitted stream is required to validate a cross-stream conclusion, a shared dependency makes contamination inseparable, or a mandatory release check fails. Those example triggers are analyst inferences, not Databricks requirements. Confidence: medium. Classification: engineering analogy. Sources: F1/F3 URLs, publisher/dates above.

3. **Omission must not silently become evidence of absence or representativeness.** F4's context-specific representativeness and provenance guidance suggests retaining a record of which streams were considered, which were excluded and why, and what population the remaining evidence actually covers. A 2x2 count alone does not establish broad representativeness or independent corroboration of each learned claim. Confidence: medium-high. Classification: inference from risk guidance. Source: https://airc.nist.gov/airmf-resources/playbook/measure/ (NIST, publication date unavailable, accessed 2026-09-04).

4. **The 2x2 rule is not established privacy protection by this evidence.** Counting distinct writers and projects does not demonstrate the quasi-identifier treatment, release-risk assessment, or repeated-release analysis discussed by NIST. It cannot be presented as demonstrated k-anonymity or differential privacy. Whether it reduces some particular disclosure risk requires a separate threat model and evidence. Confidence: high for absence of established guarantee; no quantitative privacy benefit assessed. Classification: inference from primary privacy guidance. Source: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-188.pdf (NIST, September 2023, accessed 2026-09-04).

## Open questions and limits

- Is each stream optional, or does the digest promise an exhaustive assessment? External sources cannot decide this product contract.
- Are cross-stream statements permitted, and can their evidence remain valid after a stream is removed?
- Does a qualifying stream contain sufficient evidence for each individual conclusion, rather than merely sufficient distinct entities somewhere in that stream?
- Are writers/projects deduplicated and temporally scoped? Are counts recomputed after any filtering? Not investigated here.
- Are excluded streams systematically different from included streams, and would omission change the meaning of claimed lessons? Not measured here.
- What prose, identifiers, and repeat-release linkages reach the digest, model, and readers? No privacy assurance assessed.
- No retrieved standard validates exactly two writers, exactly two projects, or requires either whole-candidate rejection or selective omission for this use case.

Strongest caveat: Databricks documents processing mechanisms; NIST provides risk-assessment guidance. Neither establishes the semantic completeness contract for this learning digest. The choice remains a product policy decision informed by dependencies and the claims the resulting digest is allowed to make.
