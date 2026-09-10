# Extract: how SR&ED / R&D-credit tools actually generate narratives (2026-09-09)

Source: second web-research pass (mechanism-level). Facts only; confidence marked.

| Tool | Inputs | Staged or one-shot | Human review | CRA structure | Defensibility | Notes |
|---|---|---|---|---|---|---|
| Boast.ai (CA) | GitHub/Jira/Slack, payroll, accounting integrations | Hybrid: AI classifies activities; Boast's in-house team writes the narrative outline (stages undisclosed) | Boast staff, not self-serve editing | No public five-questions scaffold | "AuditShield": audit binders, representation; claim-to-source mechanics undisclosed | boast.ai/platform |
| Grant Sparrow (CA) | Guided intake questionnaire (inferred) | Largely one-shot from intake ("minutes, not days"); low confidence, JS SPA | Unknown | Claims T661 uncertainty/experimentation language | Unknown | No reviews found anywhere |
| Claimer (UK) | Client data, uploads, integrations; trained on 800+ claims | Explicitly staged: eligibility -> info gathering -> drafting -> validation (prior-art scan) | In-platform editable draft, one-click submit; practitioner critique: review often shallow | UK test (uncertainty/baseline/advance), not CRA's five | "anti-hallucination", baseline validation; no source-level traceability confirmed | Ex-HMRC inspector: AI may "sanitise a narrative by hiding weaknesses" (mscrnd.com) |
| SRED AI (sred-ai.com) | Read-only GitHub App | Staged: extract uncertainty/experiments -> draft -> human finalizes | Human finalizes | Uncertainty/experiment inventory | Timeline, evidence index, experiment inventory linking claims to commits (unverified) | Closest to real citation mechanism |
| Neo.Tax (US) | Jira/Linear/GitHub/Gusto; no interviews | Staged bottom-up: ML weights tickets, drafts from ticket+commit data | Unknown | US four-part test | Own blog: generic LLMs alone are unreliable for this | neo.tax/blog |
| Traditional firms (SR&ED Unlimited, Venbridge, G6, Mentor Works, RDP, TaxTaker, Strike, Clarus, Source Advisors, Easly) | Consultant interviews around CRA's five questions | Human technical writers draft | Human | Five questions by interview design | None published | G6 names dedicated technical writers |

## Key structural fact
- Every AI tool that "dumps and generates" (Boast, Neo.Tax, SRED AI, Grant Sparrow) does so from **structured, timestamped engineering data** (commits, tickets, payroll) — not from interview transcripts. The only transcript/consultant-style input model is the traditional human-writer firms. No tool found generates a narrative from an interview transcript plus writer inputs, which is Banhall's model.
- The one tool that takes unstructured uploads (Claimer) is explicitly staged, and is the one criticised for complete-looking-but-shallow narratives.

## CRA
- SR&ED Pre-Claim Approval effective 2026-04-01 (CCPCs under $25M revenue, 8-week determination, up to 3-year validity). The CRA page has no mention of AI. Vendor claims that "CRA uses AI to screen T661 narratives" are not traceable to any CRA source.

## Summary
- Dump-and-generate (from integrated structured data, human review at the end): Boast.ai, Grant Sparrow, Neo.Tax, SRED AI.
- Staged intake -> outline -> draft -> review: Claimer. Fully human: the traditional firms.
