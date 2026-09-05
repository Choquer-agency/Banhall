# Independent routing check

Claim: Data-quality tools separate per-record evaluation from the choice to continue or fail a job. AWS Glue exposes record-level results, separately reports dataset-level failures, and makes job-stop behavior configurable.

Source: https://docs.aws.amazon.com/glue/latest/dg/tutorial-data-quality.html sections 3 and 4. Publisher: Amazon Web Services. Publication date: not stated. Accessed: 2026-09-04 through web search and direct page retrieval. Confidence: medium for specific live documentation, high for the common pattern independently corroborated by Databricks. Class: engineering pattern.

This independently confirms that processing granularity and failure policy are separate engineering choices. It does not validate Banhall's thresholds. In particular, passing records do not override a failed dataset-level condition. In Banhall the analogy must therefore be applied to each entire stream's diversity evaluation, then the whole candidate's admitted-row minimum; it must not bypass either aggregate check.

The document's wording for the after-loading failure option is ambiguous about data persistence; this report does not rely on that option's transaction semantics. No quoted passage retained.

Stop: independent corroboration reached. No additional round needed.
