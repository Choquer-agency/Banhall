/**
 * Deterministic QA checks that run BEFORE the AI QA agent.
 * These handle structural/pattern checks that the LLM struggles with,
 * producing pre-computed facts that get injected into the QA prompt.
 */

// ─── Check 1: CRA opener detection for 246 P2-P4 ────────────────────────────

const CRA_OPENER_PATTERNS = [
  /^through\s+(systematic\s+|this\s+)?(investigation|experimental\s+work)/i,
  /^it\s+was\s+(determined|established)\s+that/i,
  /^the\s+(experimental|investigative)\s+work\s+(determined|established|revealed|demonstrated)\s+that/i,
  /^the\s+investigation\s+(established|determined|revealed|demonstrated)\s+that/i,
];

function getFirstSentence(paragraph: string): string {
  const match = paragraph.match(/^[^.]+\./);
  return match ? match[0].trim() : paragraph.trim();
}

export interface CRAOpenerResult {
  count: number;
  total: number;
  results: Array<{
    paragraph: number;
    passes: boolean;
    firstSentence: string;
  }>;
}

export function checkCRAOpeners(section246Text: string): CRAOpenerResult {
  const paragraphs = section246Text.split(/\n\n+/).filter((p) => p.trim());
  // P2, P3, P4 are indexes 1, 2, 3 (P1 is the overall summary at index 0)
  const advancementParagraphs = paragraphs.slice(1, 4);

  const results = advancementParagraphs.map((p, i) => {
    const firstSentence = getFirstSentence(p);
    const passes = CRA_OPENER_PATTERNS.some((pattern) =>
      pattern.test(firstSentence)
    );
    return {
      paragraph: i + 2, // P2, P3, P4
      passes,
      firstSentence: firstSentence.slice(0, 120) + (firstSentence.length > 120 ? "..." : ""),
    };
  });

  return {
    count: results.filter((r) => r.passes).length,
    total: results.length,
    results,
  };
}

// ─── Check 2: BECAUSE clause detection for 242 P5 ──────────────────────────

export interface BecauseClauseResult {
  uncertaintyCount: number;
  withBecause: number;
  details: Array<{
    excerpt: string;
    hasBecause: boolean;
  }>;
}

export function checkBecauseClauses(section242Text: string): BecauseClauseResult {
  const paragraphs = section242Text.split(/\n\n+/).filter((p) => p.trim());
  // P5 is the last paragraph (index 4)
  const p5 = paragraphs[4] ?? "";

  // Split on uncertainty markers
  const uncertaintyMarkers = [
    /it\s+was\s+uncertain\s+whether/gi,
    /it\s+remained\s+uncertain/gi,
    /uncertainty\s+existed\s+(regarding|as\s+to|about)/gi,
  ];

  // Find all uncertainty statements by splitting on sentences
  const sentences = p5.split(/(?<=\.)\s+/);
  const uncertaintySentences: Array<{ excerpt: string; hasBecause: boolean }> = [];

  for (const sentence of sentences) {
    const isUncertainty = uncertaintyMarkers.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(sentence);
    });
    if (isUncertainty) {
      uncertaintySentences.push({
        excerpt: sentence.slice(0, 100) + (sentence.length > 100 ? "..." : ""),
        hasBecause: /because/i.test(sentence),
      });
    }
  }

  return {
    uncertaintyCount: uncertaintySentences.length,
    withBecause: uncertaintySentences.filter((s) => s.hasBecause).length,
    details: uncertaintySentences,
  };
}

// ─── Check 3: Banned word scan ──────────────────────────────────────────────

const BANNED_WORDS = [
  "substantially",
  "significantly",
  "unique",
  "innovative",
  "groundbreaking",
  "cutting-edge",
  "state-of-the-art",
  "robust",
  "comprehensive",
  "holistic",
  "synergy",
  "leverage",
  "leveraging",
  "harness",
  "harnessing",
  "revolutionize",
  "revolutionizing",
  "transform",
  "game-changing",
  "fundamentally",
  "paradigm",
  "ecosystem",
  "pivotal",
  "seamless",
  "novel",
  "pioneering",
  "revolutionary",
  "spearheading",
  "delving",
  "furthermore",
  "moreover",
  "additionally",
];

export interface BannedWordResult {
  found: Array<{
    word: string;
    section: string;
    context: string;
  }>;
}

export function checkBannedWords(
  section242: string,
  section244: string,
  section246: string
): BannedWordResult {
  const found: BannedWordResult["found"] = [];

  function scanSection(text: string, sectionName: string) {
    const lower = text.toLowerCase();
    for (const word of BANNED_WORDS) {
      const regex = new RegExp(`\\b${word.replace(/-/g, "\\-")}\\b`, "gi");
      let match;
      while ((match = regex.exec(lower)) !== null) {
        // Get surrounding context
        const start = Math.max(0, match.index - 30);
        const end = Math.min(lower.length, match.index + word.length + 30);
        const context = "..." + text.slice(start, end).replace(/\n/g, " ") + "...";
        found.push({ word, section: sectionName, context });
      }
    }
  }

  scanSection(section242, "242");
  scanSection(section244, "244");
  scanSection(section246, "246");

  return { found };
}

// ─── Check 4: Repetition count ──────────────────────────────────────────────

export interface RepetitionResult {
  systematicInvestigation: number;
  technologicalUncertainty: number;
}

export function checkRepetition(
  section242: string,
  section244: string,
  section246: string
): RepetitionResult {
  const fullReport = `${section242}\n\n${section244}\n\n${section246}`.toLowerCase();

  const siCount = (fullReport.match(/systematic\s+investigation/g) ?? []).length +
    (fullReport.match(/systematic\s+experimentation/g) ?? []).length;
  const tuCount = (fullReport.match(/technological\s+uncertaint/g) ?? []).length;

  return {
    systematicInvestigation: siCount,
    technologicalUncertainty: tuCount,
  };
}

// ─── Combine all checks into a single summary for injection ─────────────────

export function runDeterministicChecks(
  section242: string,
  section244: string,
  section246: string
): string {
  const openers = checkCRAOpeners(section246);
  const because = checkBecauseClauses(section242);
  const banned = checkBannedWords(section242, section244, section246);
  const repetition = checkRepetition(section242, section244, section246);

  let summary = `## Pre-Computed Structural Checks (VERIFIED PROGRAMMATICALLY — use these as given, do not re-evaluate)\n\n`;

  // CRA openers
  summary += `### CRA Opener Detection (246 P2-P4)\n`;
  summary += `Qualifying openers found: ${openers.count}/${openers.total}\n`;
  for (const r of openers.results) {
    summary += `- P${r.paragraph}: ${r.passes ? "PASS" : "FAIL"} — "${r.firstSentence}"\n`;
  }
  summary += `\n`;

  // BECAUSE clauses
  summary += `### BECAUSE Clause Detection (242 P5)\n`;
  summary += `Uncertainties with BECAUSE clauses: ${because.withBecause}/${because.uncertaintyCount}\n`;
  for (const d of because.details) {
    summary += `- ${d.hasBecause ? "PASS" : "FAIL"} — "${d.excerpt}"\n`;
  }
  summary += `\n`;

  // Banned words
  summary += `### Banned Word Scan\n`;
  if (banned.found.length === 0) {
    summary += `No banned words found.\n`;
  } else {
    summary += `Found ${banned.found.length} violation(s):\n`;
    for (const f of banned.found) {
      summary += `- "${f.word}" in Section ${f.section}: ${f.context}\n`;
    }
  }
  summary += `\n`;

  // Repetition
  summary += `### Repetition Count\n`;
  summary += `- "systematic investigation/experimentation": ${repetition.systematicInvestigation} occurrences ${repetition.systematicInvestigation > 3 ? "(OVER LIMIT of 3)" : "(within limit)"}\n`;
  summary += `- "technological uncertainty": ${repetition.technologicalUncertainty} occurrences ${repetition.technologicalUncertainty > 4 ? "(OVER LIMIT of 4)" : "(within limit)"}\n`;

  return summary;
}
