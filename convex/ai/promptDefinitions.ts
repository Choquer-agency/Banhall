/**
 * Pure prompt scaffolds shared by runtime assembly and the prompt-program
 * manifest. Keep this module free of Convex actions so promptProgram.ts can
 * import the real definitions without creating action-module cycles.
 */

export const LENGTH_BUDGET_SCAFFOLD = {
  prefix:
    "\n\n# LENGTH BUDGET (CRA form constraint — hard requirement)\nThe CRA form field for this section holds at most ",
  linesToChars: " lines of ",
  charsToWords:
    " characters, and EVERY blank line between paragraphs also costs one full line. Write AT MOST ",
  suffix:
    " words total. Prefer fewer, denser paragraphs (each blank line spent on a paragraph break is a line of content lost). Do NOT pad. If the material exceeds the budget, keep the most technically load-bearing content and cut the rest.",
  runtimeSentinels: [
    "{{runtime.lineLimit}}",
    "{{runtime.charsPerLine}}",
    "{{runtime.wordBudget}}",
  ],
} as const;

export const COMPRESSION_REQUEST = {
  system:
    "You compress SR&ED report sections to fit CRA form limits. Preserve every distinct technical claim, uncertainty, iteration, and result; cut repetition, filler, and scene-setting. Never invent content. [GAP: …] markers must be preserved verbatim — never remove or reword them. Keep the same paragraph conventions (blank line between paragraphs). Never join clauses with an em dash or a dash stand-in (double hyphen, spaced hyphen); use a colon, semicolon, comma, or period. Return ONLY the compressed section text.",
  userScaffold: {
    prefix: "This section is ",
    linesToWords: " lines / ",
    wordsToLimit: " words, but the CRA field allows only ",
    limitToChars: " lines of ",
    charsToTarget:
      " characters (blank lines between paragraphs each cost one line). Rewrite it to AT MOST ",
    targetToText:
      " words while preserving all technical substance. Merge paragraphs where natural — fewer paragraph breaks save lines.\n\n",
    runtimeSentinels: [
      "{{runtime.currentLines}}",
      "{{runtime.currentWords}}",
      "{{runtime.lineLimit}}",
      "{{runtime.charsPerLine}}",
      "{{runtime.targetWords}}",
      "{{runtime.sectionText}}",
    ],
  },
  roleOrder: ["system", "user"],
  maxTokens: 4096,
  modelSelector: { kind: "candidate" },
  thinking: { kind: "omitted" },
  squeezes: [1, 0.85],
} as const;

export const STYLE_GUIDANCE_SCAFFOLDS = {
  learned: {
    prefix:
      "\n\n## Style guidance learned from writer feedback on past drafts\nApply where it does not conflict with the required structure, CRA phrasing, or banned-word rules",
    waivedClause:
      ", or with the writer's personal preferences in their waived house-style areas below",
    contentPrefix: ":\n",
  },
  writerSkeletonWaived: {
    prefix:
      "\n\n## Writer's personal style preferences (AUTHORITATIVE)\nThe requesting writer recorded these preferences and their profile waives the built-in report skeleton. They are the authority for section architecture (paragraph count, roles, order, openers, framing) and for these waived house-style areas: ",
    contentPrefix:
      ". Apply them fully. The only limits they cannot override are the length budget and the evidence rules (use only the provided material; [GAP] placeholders instead of invention); the learned style guidance above yields to them wherever the two conflict.\n\n",
  },
  writerWithWaivers: {
    prefix:
      "\n\n## Writer's personal style preferences\nThe requesting writer recorded these preferences. For the following waived house-style areas they are AUTHORITATIVE and replace the default house rules: ",
    contentPrefix:
      ".\nOutside those areas, apply them ONLY where they do not conflict with: (1) the required CRA section structure and required-content mandates, (2) the remaining house-style and CRA phrasing rules, (3) the length budget, (4) the learned style guidance above. When in conflict outside the waived areas, ignore the preference silently.\n\n",
  },
  writerDefault: {
    prefix:
      "\n\n## Writer's personal style preferences (lowest priority)\nThe requesting writer recorded these personal preferences. Apply them ONLY where\nthey do not conflict with: (1) the required CRA section structure and required-content\nmandates, (2) CRA phrasing and banned-word rules, (3) the length budget,\n(4) the learned style guidance above. When in conflict, ignore the preference\nsilently.\n\n",
  },
  runtimeSentinels: [
    "{{runtime.draftStyleDigest}}",
    "{{runtime.writerInstructions}}",
    "{{runtime.waivedCategoryLabels}}",
  ],
} as const;

export const ITERATIVE_SECTION_TITLES = {
  s242: "Line 242 — Uncertainty",
  s244: "Line 244 — Work performed",
  s246: "Line 246 — Advancement",
} as const;

export const ITERATIVE_PROMPT_SCAFFOLDS = {
  approvedPriorSections: {
    prefix:
      "\n\n## Approved prior sections (canonical — the writer has reviewed and edited these; align terminology, chronology, and claims with them; do not contradict them)\n",
    itemTitlePrefix: "### ",
    itemTitleSuffix: " (APPROVED)\n",
    separator: "\n\n",
  },
  regenerationGuidance: {
    prefix: "\n\n## Writer guidance for this regeneration (high priority)\n",
  },
  runtimeSentinels: [
    "{{runtime.approvedPriorSections}}",
    "{{runtime.regenerationGuidance}}",
  ],
} as const;

// ─── Story 2 (CAP-5/9/10): ordered, ungated generation ──────────────────────

/** Ordered chain (single/compare) section titles, by T661 line. */
export const ORDERED_SECTION_TITLES = {
  "242": "Line 242 — Uncertainty",
  "244": "Line 244 — Work performed",
  "246": "Line 246 — Advancement",
} as const;

export const ORDERED_PROMPT_SCAFFOLDS = {
  // Drafted, not approved: nobody has reviewed these yet (ungated), so they
  // are context for consistency, never canonical like iterative's approved
  // sections.
  draftedPriorSections: {
    prefix:
      "\n\n## Previously drafted sections (context: drafted earlier in this generation and not yet reviewed by the writer; keep terminology, chronology, figures and claims consistent with them, and do not repeat their content)\n",
    itemTitlePrefix: "### ",
    itemTitleSuffix: " (DRAFTED)\n",
    separator: "\n\n",
  },
  repairGuidance: {
    prefix:
      "\n\n## Self-check repair (high priority)\nThe draft below failed its Self-check. Rewrite it to fix every issue listed and change nothing else: keep every supported technical claim, the paragraph structure, the length budget and the evidence rules. Hedge any fact the Confidence Map marks unresolved or unreliable; never state it flatly. Return ONLY the revised section text.\n\nIssues:\n",
    issuePrefix: "- ",
    issueSeparator: "\n",
    draftPrefix: "\n\nDraft to revise:\n",
  },
  runtimeSentinels: [
    "{{runtime.draftedPriorSections}}",
    "{{runtime.selfCheckIssues}}",
    "{{runtime.sectionDraft}}",
  ],
} as const;

export const SELF_CHECK_REQUEST = {
  roleOrder: ["system", "user"],
  toolName: "submit_self_check",
  toolDescription:
    "Submit the Self-check verdicts for one drafted SR&ED section.",
  maxTokens: 4096,
  maxVerdicts: 30,
  userScaffold: {
    prefix:
      "Run the Self-check on the drafted section below. Paragraphs are numbered [P1], [P2], ...; name the paragraph each verdict concerns (0 for the whole section).\n\n",
    blockSeparator: "\n\n",
    runtimeSentinels: [
      "{{runtime.sectionDraft}}",
      "{{runtime.storyline}}",
      "{{runtime.confidenceMap}}",
      "{{runtime.glossaryCandidates}}",
      "{{runtime.writerInstructions}}",
    ],
  },
  modelSelector: "candidate-model-or-default",
} as const;

const verdictOutcome = { type: "string", enum: ["applied", "not_applied"] } as const;

export const SELF_CHECK_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      maxItems: SELF_CHECK_REQUEST.maxVerdicts,
      items: {
        type: "object",
        properties: {
          paragraph: {
            type: "integer",
            description: "1-based paragraph ([P1] = 1); 0 when the verdict concerns the whole section.",
          },
          check: {
            type: "string",
            enum: ["storyline", "confidence", "glossary", "instruction"],
          },
          instruction: {
            type: "string",
            description:
              "What was checked. For check=instruction, quote the writer instruction verbatim. For check=glossary, the Glossary Term.",
          },
          outcome: verdictOutcome,
          reason: { type: "string" },
          repairGuidance: {
            type: "string",
            description: "For not_applied only: one concrete fix a writer could follow.",
          },
        },
        required: ["paragraph", "check", "instruction", "outcome", "reason"],
      },
    },
    storylineQuestion: {
      type: "object",
      description:
        "Only when the section contradicts the Storyline AND the section's evidence is stronger than the Storyline's basis. Never used as a repair reason.",
      properties: {
        question: { type: "string" },
        sectionClaim: { type: "string", description: "What the section says, backed by the stronger evidence." },
        confidenceEntry: {
          type: "integer",
          description: "The [C#] number of the Confidence Map entry the section's evidence rests on.",
        },
        storylineAlternative: { type: "string", description: "The Storyline wording the evidence supports instead." },
      },
      required: ["question", "sectionClaim", "confidenceEntry", "storylineAlternative"],
    },
  },
  required: ["verdicts"],
} as const;

export const CONSISTENCY_REQUEST = {
  roleOrder: ["system", "user"],
  toolName: "submit_consistency_findings",
  toolDescription:
    "Submit the consistency findings for the assembled SR&ED draft.",
  maxTokens: 4096,
  maxFindings: 20,
  userScaffold: {
    prefix:
      "Run the consistency pass over the assembled draft below. Paragraphs are numbered per section [P1], [P2], ...\n\n",
    blockSeparator: "\n\n",
    runtimeSentinels: [
      "{{runtime.assembledDraft}}",
      "{{runtime.claimExclusions}}",
      "{{runtime.glossaryTerms}}",
    ],
  },
  modelSelector: "candidate-model-or-default",
} as const;

const sectionEnum = { type: "string", enum: ["242", "244", "246"] } as const;

export const CONSISTENCY_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      maxItems: CONSISTENCY_REQUEST.maxFindings,
      items: {
        type: "object",
        properties: {
          section: { ...sectionEnum, description: "The section where the problem appears." },
          paragraph: { type: "integer", description: "1-based paragraph in that section." },
          sections: {
            type: "array",
            items: sectionEnum,
            description: "Every section involved (the one that contradicts and the one contradicted).",
          },
          kind: {
            type: "string",
            enum: ["contradiction", "excluded_claim", "terminology"],
          },
          issue: { type: "string" },
        },
        required: ["section", "paragraph", "sections", "kind", "issue"],
      },
    },
  },
  required: ["findings"],
} as const;
