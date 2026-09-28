/**
 * 2026-09-28 (second, edited terms): the words a writer changed or added in a
 * Seed Selection, kept word for word through drafting, compression and the
 * repair (CAP-13: a writer's edited term appears in the drafted Section).
 *
 * Release suite run 4 ("Carried old selections"): the writer added "The team
 * calls the graded structure the cascade-fired lattice." to a Company /
 * Context Seed. The first draft used the term, the Self-check called it
 * invented, and the repair removed it.
 *
 * An edited term is a distinctive phrase inside the writer's changes. The
 * signed wording is compared word by word with the model's original Seed
 * (longest common subsequence, case-insensitive); the changed or added words
 * form runs that end at an unchanged word, a function word or punctuation
 * that ends a clause. A run of at most `MAX_TERM_WORDS` words is a term when
 * one of its words is hyphenated between letters, holds a digit, or starts
 * with a capital letter away from the start of a sentence. A phrase the
 * writer put in quotation marks that the Seed did not have is a term whole.
 * Plain words ("team calls", "graded structure") stay ordinary plan wording:
 * the coverage Self-check judges their point.
 */

export const MAX_TERM_WORDS = 5;
/** At most this many edited terms per Line, in plan order. */
export const MAX_EDITED_TERMS_PER_LINE = 8;

const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "of", "to", "in", "on", "at", "by",
  "for", "with", "from", "into", "onto", "over", "under", "as", "is", "are", "was",
  "were", "be", "been", "being", "am", "has", "have", "had", "do", "does", "did",
  "it", "its", "this", "that", "these", "those", "which", "who", "whom", "whose",
  "what", "when", "where", "why", "how", "than", "then", "so", "such", "not", "no",
  "also", "very", "we", "our", "they", "their", "them", "he", "she", "his", "her",
  "i", "you", "your", "can", "could", "will", "would", "shall", "should", "may",
  "might", "must", "per", "via", "about", "after", "before", "between", "during",
  "through", "without", "within", "while", "because", "if", "each", "all", "any",
  "some", "more", "most", "other", "same", "only", "just", "both", "either",
  "neither", "there", "here",
]);

type Token = {
  /** The word as written, surrounding punctuation removed. */
  word: string;
  norm: string;
  sentenceStart: boolean;
  /** An opening bracket or quotation mark comes before the word. */
  breakBefore: boolean;
  /** Clause-ending punctuation follows the word. */
  breakAfter: boolean;
};

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let sentenceStart = true;
  for (const raw of text.replace(/[\u2018\u2019]/g, "'").split(/\s+/)) {
    const word = raw.replace(/^[^A-Za-z0-9]+/, "").replace(/[^A-Za-z0-9]+$/, "");
    const trailing = raw.slice(raw.lastIndexOf(word) + word.length);
    if (!word) {
      if (/[.!?:;]/.test(raw)) sentenceStart = true;
      continue;
    }
    tokens.push({
      word,
      norm: word.toLowerCase(),
      sentenceStart,
      breakBefore: /^[(\["\u201c]/.test(raw),
      breakAfter: /[.,;:!?)\]"\u201d]/.test(trailing),
    });
    sentenceStart = /[.!?:]/.test(trailing);
  }
  return tokens;
}

/** For each token of `edited`, whether the original Seed had it in sequence. */
function keptFlags(original: readonly Token[], edited: readonly Token[]): boolean[] {
  const rows = original.length + 1;
  const cols = edited.length + 1;
  const table = new Array<number>(rows * cols).fill(0);
  for (let i = original.length - 1; i >= 0; i -= 1) {
    for (let j = edited.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] =
        original[i].norm === edited[j].norm
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const kept = new Array<boolean>(edited.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < original.length && j < edited.length) {
    if (original[i].norm === edited[j].norm) {
      kept[j] = true;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return kept;
}

function distinctive(token: Token): boolean {
  return (
    /\d/.test(token.word) ||
    /[A-Za-z]-[A-Za-z]/.test(token.word) ||
    (/^[A-Z]/.test(token.word) && !token.sentenceStart)
  );
}

function normalizeTerm(text: string): string {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The edited terms of one Seed Selection: distinctive phrases the writer
 * changed or added in `edited` compared with the model's `original` Seed.
 */
export function editedTermsOf(original: readonly string[], edited: readonly string[]): string[] {
  const originalText = original.join("\n");
  const editedText = edited.join("\n");
  const terms: string[] = [];
  const add = (term: string) => {
    const trimmed = term.replace(/\s+/g, " ").trim();
    if (trimmed && !terms.some((known) => normalizeTerm(known) === normalizeTerm(trimmed))) {
      terms.push(trimmed);
    }
  };
  const originalNorm = normalizeTerm(originalText);
  for (const match of editedText.matchAll(/["\u201c]([^"\u201c\u201d\n]{2,80})["\u201d]/g)) {
    if (!originalNorm.includes(normalizeTerm(match[1]))) add(match[1]);
  }
  const editedTokens = tokenize(editedText);
  const kept = keptFlags(tokenize(originalText), editedTokens);
  let run: Token[] = [];
  const close = () => {
    if (run.length > 0 && run.length <= MAX_TERM_WORDS && run.some(distinctive)) {
      add(run.map((token) => token.word).join(" "));
    }
    run = [];
  };
  editedTokens.forEach((token, index) => {
    if (token.breakBefore) close();
    if (kept[index] || FUNCTION_WORDS.has(token.norm)) {
      close();
      return;
    }
    run.push(token);
    if (token.breakAfter) close();
  });
  close();
  return terms;
}

function termPattern(term: string): RegExp {
  const words = normalizeTerm(term)
    .split(" ")
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![a-z0-9-])${words.join("\\s+")}(?![a-z0-9-])`);
}

/**
 * Whether `text` holds `term` word for word: case aside, any run of spaces or
 * line breaks between its words, and not inside a longer word.
 */
export function containsTerm(text: string, term: string): boolean {
  return termPattern(term).test(text.replace(/[\u2018\u2019]/g, "'").toLowerCase());
}
