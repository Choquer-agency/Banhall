# Citation semantic review

Reviewed 2026-09-04 in fresh context. Scope: the five primary external URLs in `research.md`, retrieved directly in three web calls. No local code claims or numerical thresholds were externally verified. No research findings or policy were edited.

Judgment: citations support the central external claims, with one minor scope qualification recommended before finalization. Recommendation, local evidence, and external analogy are clearly separated; no source is presented as approving Banhall's chosen policy or proving the sample sizes sufficient.

- [Databricks expectations](https://docs.databricks.com/aws/en/ldp/expectations) supports retain/drop/fail and dropped-record metrics. Both Databricks pages visibly report **July 14, 2026** as their update date.
- [Databricks patterns](https://docs.databricks.com/aws/en/ldp/expectation-patterns) supports quarantine and explicit job dependencies for validation-table gating. The phrase “downstream blocking requires explicit dependencies” is slightly broad: continuous-mode expectation failure already stops the offending flow and dependent flows. Qualify it as validation-table or cross-pipeline orchestration; the page explicitly distinguishes triggered and continuous modes. This does not undermine the architectural analogy or recommendation.
- [AWS Glue](https://docs.aws.amazon.com/glue/latest/dg/tutorial-data-quality.html), steps 3 and 4, directly supports row-level passes alongside dataset failure and configurable continuation/job failure. The Banhall aggregate-gate application is properly introduced as application-specific reasoning.
- [NIST AI RMF](https://airc.nist.gov/airmf-resources/airmf/3-sec-characteristics/), sections 3, 3.1, and 3.4, supports contextual tradeoffs, human-selected thresholds, representative testing, and provenance. It also confirms the 2023 excerpt and revision-in-progress metadata. These are general principles, as the research acknowledges.
- [NIST SP 800-188](https://csrc.nist.gov/pubs/sp/800/188/final), abstract, supports evaluating disclosure risk separately from de-identification and warns that masking alone may be insufficient. Its document history confirms September 14, 2023. The research reasonably infers that writer/project counts do not establish anonymity; it does not claim NIST specifically evaluated those counts.

No unsupported external factual claim affecting the recommendation was found. Minor Databricks wording qualification above remains the only suggested correction.
