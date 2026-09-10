# Glossary

Downstream reads these terms exactly; introducing a synonym is a contract violation. Lifted from the PRD (§2) verbatim in substance.

- **PD** — Project description: the technical narrative of an SR&ED claim, structured as Section 242, Section 244 and Section 246, answering The Five Questions.
- **The Five Questions** — the CRA eligibility test a PD answers: technological uncertainty, hypotheses, systematic investigation, technological advancement, records kept. The Storyline is defined against them; the Confidence Map classifies the facts that answer them.
- **Section 242 / 244 / 246** — the three CRA-defined parts of a PD (uncertainties; work performed; advancements). Existence, order and line/word limits are Locked Rules.
- **Transcript** — an interview transcript attached to a project; one or more, ordered.
- **Dump** — the inputs a writer would paste into ChatGPT: Transcripts, title, context, attachments, Writer Profile. The maximum the tool may require.
- **Writer Profile** — a writer's saved customized settings: paragraph rules, Build Order, Self-checks, terminology preferences. Set once; applies to every generation.
- **Writer's Notes** — free-text per-project direction supplied at generation time; highest-trust input after the Writer Profile.
- **Supporting Documents** — attachments other than Transcripts.
- **House Rules** — Banhall's default style rules (banned words, density, sentence construction, repetition caps, opening clauses, report skeleton); each category has an Org Mode.
- **Org Mode** — per House Rule category: `writer_choice` (a Writer Profile may waive it), `enforced` (applies regardless), `off`. Precedence: Locked Rules > enforced Org Mode > Writer Profile > House Rules.
- **Locked Rules** — CRA-derived, never overridable: the 242/244/246 skeleton, line and word caps, no fabrication.
- **Generation Brief (Brief)** — the structure assembled before drafting: Storyline, Claim Exclusions, Confidence Map, Glossary Terms. Shown; editable; never required.
- **Storyline** — the controlling narrative every section follows; the most defensible account against The Five Questions. Writer-supplied, or derived when none is supplied. Each claim shows the Confidence Map entries it rests on.
- **Claim Exclusions** — statements from the Dump outside the eligible work (business risk, routine engineering, outside the claim period, not technological) that must not be claimed however prominent; each carries its eligibility reason.
- **Confidence Map** — the Dump's facts classified established | partially established | unresolved | unreliable, each tied to its source.
- **Glossary Terms** — the technical phrases the PD uses exclusively; one concept, one name.
- **Build Order** — the order sections and paragraphs are generated, per the Writer Profile; may differ from presentation order.
- **Self-check** — a check attached to a paragraph by the Writer Profile or the system, run before the paragraph is shown.
- **Compliance Note** — per section: profile instructions applied, and every instruction not applied with its reason (Locked Rule, org-enforced, conflict, missing fact).
- **Deviation** — a place where the draft departs from the Writer Profile, or a content issue the writer flags.
- **Deviation Inventory** — every paragraph, its Writer Profile rule, each Deviation; the writer may add content Deviations.
- **Coordinated Revision** — one Proposal addressing every item in a list at once.
- **Completion Report** — per item: resolved | blocked (missing fact) | conflicting (rule and alternative).
- **Proposal** — edits the assistant proposes and a human applies (chatProposals / applyProposal). No prose change without one.
- **Reference PD** — a writer's own finished PD for a project; the standard a draft is compared against.
- **Sol** — "GPT-5.6 Sol" via OpenRouter (`openai/gpt-5.6-sol`); not necessarily identical to Sol inside the ChatGPT product.
- **Paired Comparison** — the same Dump into ChatGPT and into Banhall; both drafts stripped to identical plain text by a third person; rated blind by the writer; Deviations and Corrections-to-acceptable counted by the same manual method for both.
- **Corrections-to-acceptable** — the number of Coordinated Revisions (or manual edit rounds) before the writer calls a draft acceptable.
