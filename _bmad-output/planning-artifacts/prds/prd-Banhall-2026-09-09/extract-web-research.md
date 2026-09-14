# Extract: comparable tools and evidence (web research, 2026-09-09)

Source: web-research subagent. Facts only; vendor claims marked as such.

## SR&ED / R&D-credit AI tools
- Boast.ai: evidence-linked claims from Git/Jira/Slack; audit/recovery stats are vendor marketing (boast.ai).
- GrantOps / Chrono Innovation: market "capture vs generation" — generation-only tools produce generic undated prose; capture tools trace sentences to commits/dates for CRA Pre-Claim Approval (chronoinnovation.com/resources/ai-sred-audit-defense). CRA-policy claims not verified against a primary CRA source.
- Grant Sparrow: guided intake -> narrative; no mechanism published. Fondo (US IRS four-part test): drafts from metadata, humans finalize.
- UK Claimer: "bulletproof" narratives; practitioner critique (mscrnd.com) says minimal input yields complete-looking narratives with no real review; ex-HMRC inspector: AI "might sanitise a narrative by hiding weaknesses".
- No SR&ED tool found with section-by-section or option-selection UX. Ryz Labs / Fibr: no matching product.

## Outline-first / option-selection drafting products
- Sudowrite: persistent Story Bible governs generation; Brainstorm gives multiple candidates per prompt with thumbs up/down (docs.sudowrite.com).
- Jasper: Brand Voice extracted from uploaded docs, applied at generation time (help.jasper.ai).
- Microsoft Copilot in Word: Keep/Discard/Regenerate (one alternative at a time); Rewrite offers a few variants per passage (support.microsoft.com).
- Notion AI: persistent custom-instructions page loaded each session (notion.com/help/instructions-for-notion-agent).
- ChatGPT canvas: per-suggestion accept/apply; no bulk apply of a list of edits (openai.com/index/introducing-canvas). Practitioner guidance: work section by section, not many edits at once (zapier.com/blog/chatgpt-canvas).
- No researched product exposes N-candidate-per-section selection for a long document.

## ChatGPT Projects
- File caps per plan reported as 5 / 25 / 40 (Free / Plus-Go / Pro-Team-Business-Enterprise) — community-sourced, help.openai.com returned 403; matches Larry's "40".
- Project instructions override account custom instructions within the project (help.openai.com/en/articles/8096356).

## Convergence / critique-revise evidence
- Self-Refine (arxiv 2303.17651): generate -> self-critique -> revise, ~20% avg gain. Reflexion (arxiv 2303.11366): stored verbal reflections across retries.
- Failure modes: partial completion of long edit lists (unite.ai); multi-turn instruction adherence drops ~39% vs single-turn, e.g. 88% -> 71% by turn 3 (microsoft.com/research "LLMs get lost in multi-turn conversation"); LLM self-scoring inflates grades and rewards length (practitioner source).

## CAD/DWG
- No mainstream LLM accepts DWG. DXF (text) is tractable; DWG (binary) is not.
- Conversion: ODA File Converter (free CLI, DWG <-> DXF/PDF/PNG); ezdxf (Python) reads DXF and wraps ODA via `odafc`; no reliable pure-Python DWG parser (ezdxf docs).
