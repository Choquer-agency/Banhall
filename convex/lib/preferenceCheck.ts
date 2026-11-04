/**
 * 2026-10-27 (Phase E, E1a; part 5 of the first 2026-10-26 entry): "A
 * preference holds only how the writer likes to write, never facts about a
 * company or project. The server refuses a suggestion that contains a name,
 * placeholder or figure from the project it came from."
 *
 * `checkPreferenceText` is the server's check on every saved preference text:
 * a suggestion, a writer's edit of one, its approval, a written preference
 * and an edit of an approved one. It is pure; the caller gathers the names
 * and, for a suggestion, the masked texts of its whole request. A text that
 * passes still gets the model's style-only check (convex/ai/writerMemory.ts).
 *
 * Two layers (seventh re-check). This check is the first: it refuses names,
 * placeholders, contact details, codes, capitalized terms and, by templates
 * that match a whole clause, any number outside a way of writing. The model's style
 * check (`styleOnlyTexts`) is the second, for what this one cannot read.
 * This first layer does not guarantee:
 * - a clause with no number holding a fact ("Uses six bullets; the plant is
 *   closed": the second clause is the model check's);
 * - order words, which it does not read as numbers ("The first reactor
 *   leaked", "the last shipment");
 * - number forms outside its lists (other languages than English and
 *   French, unusual spellings or slang for amounts).
 */
import * as houseRules from "../../shared/houseRules";
import * as humanProse from "../../shared/humanProse";
import * as promptDefinitions from "../ai/promptDefinitions";

/** At most this many characters in one preference. */
export const MAX_PREFERENCE_CHARS = 160;

export type PreferenceRefusal =
  | "empty"
  | "too_long"
  | "placeholder"
  | "contact"
  | "number"
  | "code"
  | "capitalized"
  | "quote"
  | "name"
  | "request_capitalized"
  | "request_word"
  | "script";

/** What a refusal says to the writer, in plain words. */
export const PREFERENCE_REFUSAL_WORDS: Record<PreferenceRefusal, string> = {
  empty: "Write the preference first.",
  too_long: `Keep a preference to ${MAX_PREFERENCE_CHARS} characters.`,
  placeholder: "A preference cannot hold a hidden name such as [CLIENT_1].",
  contact: "A preference cannot hold an email, web address or phone number.",
  number: "A preference can hold a number only in a whole instruction about writing, such as \"Keeps sentences under 25 words\" or \"Spells out numbers under ten\", or as a Line number.",
  code: "A preference cannot hold a code or model name.",
  capitalized: "A preference cannot hold a name or a capitalized term. Describe how you like to write instead.",
  quote: "Quote at most three plain words, with no names or numbers.",
  name: "A preference cannot hold the name of a company, project or person.",
  request_capitalized: "This holds a name from the work it came from.",
  request_word: "This holds a term from the work it came from, not a way of writing.",
  script: "Write the preference in English or French.",
};

export type PreferenceCheckContext = {
  /** Names to refuse: companies (current and former), the firm's names, people and companies of the projects involved. */
  names: readonly string[];
  /** For a suggestion: the masked texts of its whole request, each with the company it came from. */
  request?: ReadonlyArray<{ text: string; company: string }>;
};

/** Words a style preference may capitalize after its first word. */
const STYLE_WORDS = new Set([
  "I", "Line", "Lines", "CRA", "SR&ED", "T661", "Seed", "Seeds", "Brief", "Storyline", "Summary",
  "English", "French", "Canadian", "British", "American", "Oxford", "Markdown", "US", "UK", "AI", "ALL", "CAPS",
  // Re-check of 29d88d40: "Uses SI units.", "Writes headings in Title Case."
  "SI", "Title", "Case",
]);
const STYLE_WORDS_LOWER = new Set([...STYLE_WORDS].map((word) => word.toLowerCase()));
/**
 * The number rule (fifth re-check, 2026-10-27): whole-clause templates.
 * Each sentence, and each clause after ";" or ":" (or after "and" or a
 * comma before a new instruction: "Spells out numbers under ten and uses
 * digits for 10 or more"), that holds a number must match one complete template from its
 * first word to its last, with an explicit object of writing; any other
 * clause holding a number is refused. No fragment of a sentence is enough.
 *
 * Numbers are read broadly: digits; number words from zero up ("one" too,
 * except in "no one" and "one another"); fractions ("half", "three
 * quarters"); every ordinal from "second" up ("eleventh", "twentieth"),
 * but not "first" or "last", which plain prose uses for order; "twice";
 * multipliers ("doubled", "halved", "fivefold"), never allowed; "double"
 * and "triple", allowed only in "double quotes" and "double spacing". A
 * Line number (242, 244 or 246 after "Line") and "the three Lines" name
 * the form, not a figure.
 *
 * In a clause each number is a placeholder: N a count (up to 3 digits, a
 * short range such as "2-3", or number words such as "twenty-five" or
 * "one hundred"), D a short decimal ("1.5"), BIG any other figure, ORD an
 * ordinal, MULT a multiplier, DOUBLE "double" or "triple", LN a Line
 * number. Words are lowercased, except "Line" and "Lines".
 */
const CARDINAL_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty",
  "seventy", "eighty", "ninety", "hundred", "hundreds", "thousand", "thousands", "million", "millions", "billion", "billions",
  "dozen", "dozens", "half", "halves", "quarter", "quarters", "thirds",
  // Seventh re-check: larger and nothing amounts.
  "trillion", "trillions", "quadrillion", "quadrillions", "nought", "naught", "nil",
  // French, since the firm works in Canada (preferences may be in French).
  "deux", "trois", "quatre", "cinq", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
  "vingt", "vingts", "trente", "quarante", "cinquante", "soixante", "cent", "cents", "mille", "milliard", "milliards",
]);
const ORDINAL = /^(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|[a-z]+teenth|[a-z]+tieth|hundredth|thousandth|millionth|billionth)$/;
/** "doubled", "halved", "quadruple", "quintupled", "decuple": every multiplicative ("-tuple", "-uple"). */
const MULTIPLIER =
  /^(?:doubled|doubles|doubling|tripled|triples|tripling|halved|halving|(?:quadr|oct|non|dec|cent)upl(?:e|ed|es|ing)|[a-z]+tupl(?:e|ed|es|ing))$/;
/** Any number word before "fold": "fivefold", "sixteenfold", "sixtyfold", "hundredfold"; never "manifold". */
const FOLD = new RegExp(`^(?:${[...CARDINAL_WORDS].join("|")})+fold$`);
/**
 * "one" is not a count in "no one" and "one another" used as pronouns. "no
 * one" is a pronoun only before the end of the clause, an auxiliary, a
 * function word or a verb this list knows ("so no one guesses"); before
 * anything else it is a count ("No one employee attended", "No one failed
 * component was replaced", "Keeps no one damaged machine"). "one another"
 * is not a pronoun after "the" or "a".
 */
const PRONOUN_NEXT = new Set([
  "", ".", ",", "!", "?", ";", ":", "is", "was", "will", "would", "can", "could", "should", "shall", "may", "might", "must",
  "has", "had", "have", "does", "did", "else", "at", "in", "on", "to", "who", "that", "but", "and", "or", "ever", "really",
  "else's", "needs", "knows", "wants", "reads", "sees", "likes", "expects", "guesses", "understands", "cares", "notices",
  "misses", "follows", "gets", "says", "thinks", "writes", "remembers", "doubts", "asks", "believes", "feels", "hears",
  "uses", "minds", "agrees", "knew", "saw", "said", "thought", "wrote", "read", "asked", "expected", "noticed",
]);
const DETERMINERS = new Set(["the", "a", "an", "this", "that", "each", "every", "any", "no", "one"]);
const PLACEHOLDER = /\b(?:N|D|BIG|ORD|MULT|DOUBLE)\b/;
const LINE_NUMBERS = new Set(["242", "244", "246"]);
/** Verbs that start an instruction; "and" before one of them starts a new clause. */
const CLAUSE_VERBS = new Set([
  "keeps", "keep", "limits", "limit", "caps", "cap", "uses", "use", "writes", "write", "spells", "spell", "puts", "put",
  "prefers", "prefer", "rounds", "round", "sets", "set", "starts", "start", "leaves", "leave", "avoids", "avoid", "indents",
  "indent", "aims", "aim", "expresses", "express", "gives", "give",
]);

const ADVERB_WORDS = new Set(["always", "never", "usually", "generally", "ideally", "please", "only", "also", "i", "we"]);

// Template parts. A clause is matched whole, so every part is closed.
// "I prefer ...", "We use ...": the writer speaking for themselves.
const ADVERBS = "(?:(?:always|never|usually|generally|ideally|please|only|also|try to|aim to|i|we) )*";
const CONTEXT = "(?:(?:in|for|within) (?:each |every |the |all |a )?(?:Line(?: LN)?|Lines(?: LN(?: (?:and|or) LN)*)?|summary|summaries|introduction|conclusion|report|paragraphs?|sections?|bullets?|lists?) )?";
const AMOUNT = "(?:between N and N|N(?: (?:to|or|and) N)?|an? N|N an?|N of an?|an? ORD of an?)";
const DESCRIBING =
  "(?: (?:short|shorter|long|longer|full|plain|simple|separate|single|clear|brief|briefer|concise|compact|tight|complete|distinct|main|key|nested|numbered|bulleted|blank|empty|new|whole|plain language|technical))*";
/** Units of writing that may be counted on their own: "Uses two short paragraphs." */
// Sixth re-check: "quotes" may be price quotes and "spaces" rooms, so neither
// is counted on its own; spaces count only after or before punctuation and
// parts, or as an indent.
const CORE_UNITS =
  "(?:words?|sentences?|paragraphs?|bullets?|bullet points?|characters?|headings?|subheadings?|Lines?|lists?|list items?|list entries|list entry|examples?|semicolons?|commas?|colons?|dashes|exclamation marks?|pairs? of parentheses|parentheses|direct quotes?|quotations?|acronyms?|abbreviations?)";
/**
 * Units counted only with a unit of writing beside them: "six entries in a
 * list", "one term for each idea", "two levels of bullets", a table's
 * columns. Never a bare count ("Uses three sections of the warehouse").
 */
const CONTEXT_UNITS = "(?:entries|entry|items?|terms?|ideas?|clauses?|lines?|pages?|sections?|claims?|topics?|levels?|pairs?|pair)";
/** Units a length limit may set on a part: never sections, claims, topics or clauses of something else. */
const LIMIT_UNITS = `(?:${CORE_UNITS}|entries|entry|items?|terms?|ideas?|lines?|pages?|levels?|pairs?|pair)`;
const PART = "(?:sentence|paragraph|bullet|bullet point|heading|subheading|caption|title|Line|Line LN|section|list|list item|table|summary|introduction|conclusion|opening|closing|abstract|idea|answer|quote|quotation|page|report)";
const PART_EDGE = "(?:(?:opening|closing|first|last|final|introductory|concluding) )?";
/** Where a count applies: "per sentence", "in each paragraph", "in the closing paragraph", "for each bullet". */
const TARGET = `(?:(?:per|in each|in every|in a|in an|in the|in any|in one|in N|for each|for every|for a|for the|within each|within a|within the) ${PART_EDGE}${PART}s?|(?:for|in) Lines? LN(?: (?:and|or) LN)*|joined by (?:and|or|but|a comma|a semicolon|a conjunction))`;
const AFTER_UNIT = "(?: (?:or (?:fewer|less|more)|at most|at the most|maximum|or so|at a time|not more|no more))?";
/** "to around 80 words". */
const ABOUT = "(?:(?:about|around|roughly|approximately) )?";
const QUALIFIER =
  "(?:(?:a maximum of|a minimum of|at most|at least|no more than|no fewer than|not more than|up to|about|around|roughly|only|exactly|fewer than|less than|more than|under|over) )?";
/** The writing part a limit is set on: "each Line", "the opening", "bullet points", "Line 246", "nesting". */
const SUBJECT =
  "(?:(?:each|every|a|an|the|any|all|my|our) )?(?:(?:opening|closing|first|last|final|introductory|concluding|technical) )?(?:sentences?|paragraphs?|bullets?|bullet points?|headings?|subheadings?|captions?|titles?|Line LN(?: (?:and|or) LN)*|Lines LN(?: (?:and|or) LN)*|Lines?|summary|summaries|introduction|conclusion|opening|closing|abstract|report|lists?|list items?|quotes?|quotations?|tables?|sections?|answers?|parentheses|semicolons|commas|acronyms|abbreviations|nesting|indentation|bullet nesting|heading levels|jargon|technical terms)";
const BOUND =
  "(?:to|under|below|at|within|at most|at no more than|no more than|to at most|to no more than|to a maximum of|to fewer than|to less than|to under|fewer than|less than|between|to between|at or below|at or under)";
const ANY_UNIT = `(?:${CORE_UNITS}|${CONTEXT_UNITS})`;
const LENGTH = `${AMOUNT}${DESCRIBING} ${LIMIT_UNITS}(?: (?:and|or) ${AMOUNT}${DESCRIBING} ${LIMIT_UNITS})?`;
/** What a part opens or closes with: a part of writing, never a thing ("with a valve"). */
const WRITING_OBJECT =
  "(?:(?:the|a|an|its|one) )?(?:(?:main|key|short|brief|clear|plain|central|overall|direct) )?(?:summary|result|results|finding|findings|question|questions|quote|quotation|sentence|claim|objective|aim|uncertainty|uncertainties|method|methods|conclusion|overview|definition|example|answer|point|hypothesis|context|background|recommendation|statement|transition|topic sentence|takeaway|outcome|outcomes|problem|goal|purpose)";
const SPACED_PLACES =
  "(?:full stops?|periods?|sentences?|colons?|commas?|semicolons?|punctuation|headings?|subheadings?|paragraphs?|bullets?|lists?|Lines?|sections?|parenthesis|parentheses|brackets?|dashes?|quotation marks?)";
const NUMBER_NOUNS = "(?:numbers|numerals|figures|quantities|integers|values|digits|amounts|counts)";
const RANGE =
  "(?:(?:under|below|over|above|up to|less than|fewer than|greater than|more than|lower than|higher than|smaller than|larger than|beyond) N" +
  "|(?:from |between )?N (?:to|through|and) N" +
  "|(?:from |of |for )?N (?:(?:and|or) (?:above|over|up|upward|upwards|more|higher|greater|larger|below|under|less|fewer|lower|smaller)|upwards?|onwards?|and beyond))";
const AS_FORM = "(?:in words|as words|in digits|as digits|as numerals|in numerals|as figures|in figures|in full)";
const MEASURE_NOUNS = "(?:all )?(?:numbers|numerals|figures|quantities|values|amounts|percentages|measurements|results|costs|totals|decimals)";
const MEASURES = `(?:${MEASURE_NOUNS} )`;

/** The complete instructions a clause holding a number may be. */
const NUMBER_TEMPLATES: readonly RegExp[] = [
  // Length limits on a writing part: "Keeps each Line to half a page", "Cap the opening at 35 words".
  `(?:keeps?|limits?|caps?|holds?|restricts?|trims?|shortens?|cuts?|brings?) ${SUBJECT} (?:(?:short|brief|tight|concise) )?${BOUND} ${ABOUT}${LENGTH}${AFTER_UNIT}(?: ${TARGET})?`,
  // Without a verb: "Line 244 under 700 words".
  `${SUBJECT} ${BOUND} ${ABOUT}${LENGTH}${AFTER_UNIT}`,
  // "Prefer paragraphs of 65 words or fewer."
  `(?:prefers?|uses?|writes?|keeps?) ${SUBJECT} (?:of|with|under|below|between|of at most|of no more than|of under|no longer than|shorter than) ${ABOUT}${LENGTH}${AFTER_UNIT}`,
  // A part sized by its count: "Opens with a two-sentence summary", "Uses a five-paragraph structure".
  `(?:opens?|starts?|begins?|ends?|closes?)(?: (?:each|every|the) (?:Line|section|report|summary|answer))? with (?:a|an) N (?:sentence|paragraph|line|word) (?:summary|introduction|opening|overview|answer|statement|conclusion)`,
  `(?:uses?|writes?|prefers?|gives?|adds?|includes?) (?:a|an) N (?:sentence|paragraph|line|word) (?:summary|introduction|opening|overview|answer|statement|conclusion|abstract|closing)`,
  // "parts" and "sections" may be physical ("a two-part structure"), so only sentences and paragraphs.
  `(?:uses?|prefers?|follows?) (?:a|an) N (?:paragraph|sentence) (?:structure|format|layout|outline)`,
  // Spacing: "Use one space after each colon", "Leave two blank lines after each heading".
  `(?:uses?|puts?|leaves?|adds?|prefers?|inserts?) ${QUALIFIER}(?:an? |N )(?:(?:single|blank|empty) )?(?:spaces?|lines?) (?:after|before|between) (?:(?:a|an|each|every|the|all) )?${SPACED_PLACES}`,
  // A table's columns: "Keep each table to six columns" (never another part's).
  `(?:keeps?|limits?|caps?) (?:(?:each|every|the|a|all) )?tables? (?:to|under|at|within|at most|to at most|to no more than) N columns?`,
  // "Write the conclusion in three sentences."
  `(?:writes?|keeps?|puts?|gives?|states?) ${SUBJECT} in ${ABOUT}${AMOUNT}${DESCRIBING} ${CORE_UNITS}`,
  // "Keep the first two paragraphs brief."
  `(?:keeps?|makes?) the (?:first|last|opening|closing|final) N (?:sentences|paragraphs|bullets|lines) (?:brief|short|shorter|plain|simple|concise)`,
  // Counts of units of writing: "Uses two or three bullets at most", "Write no more than 120 words in the closing paragraph".
  `(?:uses?|writes?|puts?|prefers?|includes?|gives?|aims? for|targets?|adds?|allows?|sticks? to|keeps? to|keeps?|places?) ${QUALIFIER}${AMOUNT}${DESCRIBING} ${CORE_UNITS}${AFTER_UNIT}(?: ${TARGET})?`,
  // A unit counted only beside a unit of writing: "Put a maximum of six entries in a list", "Uses one term for each idea".
  `(?:uses?|writes?|puts?|prefers?|includes?|gives?|aims? for|targets?|allows?|keeps?|places?) ${QUALIFIER}${AMOUNT}${DESCRIBING} ${CONTEXT_UNITS}${AFTER_UNIT} ${TARGET}`,
  // Without a verb: "At most 25 words per sentence", "Three sentences per paragraph at most".
  `${QUALIFIER}${AMOUNT}${DESCRIBING} ${ANY_UNIT} ${TARGET}(?: at most| at the most| maximum| max)?`,
  // Saying a thing at a length: "Summarizes each Line in two sentences", "Puts the key result in the first two sentences".
  `(?:summari[sz]es?|sums? up|explains?|states?|describes?|introduces?|answers?|covers?) (?:${SUBJECT}|(?:each |every |the |a |an |its |their )?[a-z]+(?: [a-z]+)?) in ${ABOUT}${AMOUNT}${DESCRIBING} ${CORE_UNITS}`,
  `(?:puts?|places?|states?|gives?) (?:the |a |an |its )?[a-z]+(?: [a-z]+)? (?:in|within) the (?:first|last|opening|closing) ${AMOUNT}${DESCRIBING} ${CORE_UNITS}`,
  // "Uses Oxford commas in lists of three or more."
  `uses? (?:the )?(?:oxford|serial) commas? in lists of N(?: or more)?(?: items)?`,
  // Indents: "Indent quotations by four spaces."
  `indents? (?:${SUBJECT}|the first line(?: of each paragraph)?) by N (?:spaces|characters|tabs?)`,
  // Levels: "Use two nested levels of bullets", "Uses three heading levels".
  `(?:uses?|allows?|prefers?|keeps? to) ${QUALIFIER}N${DESCRIBING} (?:levels?|tiers?) of (?:bullets|headings|subheadings|nesting|indentation|lists)`,
  `(?:uses?|allows?|prefers?|keeps? to) ${QUALIFIER}N (?:heading|bullet|list|nesting) levels`,
  // Repetition: "Never uses the same word twice in a sentence", "Do not repeat a technical term more than three times per paragraph".
  `(?:(?:do not|don't|does not|avoids?|avoid) )?(?:repeats?|repeating|uses?|using) (?:the same|a|an|any|each|N)(?: (?:technical|key|long|opening))? (?:word|term|phrase|opening|transition|connector)s?(?: (?:more than|over) N times| N times)? (?:in|per|within) (?:(?:a|an|N|the same|each|any|every) )?(?:sentence|paragraph|bullet|Line|section|heading)`,
  // "Avoids one-word sentences."
  `(?:avoids?|avoid|never writes?|never uses?|no) N word (?:sentences|paragraphs|bullets|headings|answers|replies)`,
  // "Use a colon before lists of four items."
  `(?:uses?|puts?|adds?) a colon before (?:a list|lists)(?: of (?:(?:more than|over|at least) )?N (?:items|entries|points|bullets))?`,
  // How numbers are written: "Spells out numbers one through nine", "Spell out integers from zero to twelve".
  `(?:spells?|spell) out (?:all )?(?:${NUMBER_NOUNS} )?${RANGE}(?: ${AS_FORM})?`,
  // "Writes numbers below 10 in words", "Write numbers above ninety-nine as numerals".
  `(?:writes?|express(?:es)?|renders?|gives?|puts?|keeps?|sets?|shows?) (?:all )?${NUMBER_NOUNS} ${RANGE} ${AS_FORM}`,
  // "Uses digits for 10 and above", "Use numerals for values over nine", "Uses digits from 10 upward".
  `(?:uses?|prefers?) (?:digits|numerals|figures|words) (?:for|from) (?:all )?(?:${NUMBER_NOUNS} )?${RANGE}`,
  // "Write one hundred as digits."
  `(?:writes?|spells?|gives?) (?:the number )?N (?:as|in) (?:digits|numerals|figures|words|a numeral)`,
  // Without a verb: "Numbers under ten in words."
  `${NUMBER_NOUNS} ${RANGE} (?:are )?(?:(?:spelled|spelt|written) out|${AS_FORM})`,
  // "Use a comma in numbers over 999."
  `(?:uses?|puts?|adds?|inserts?|includes?) (?:a )?commas? in (?:all )?${NUMBER_NOUNS} (?:over|above|greater than|larger than|from|of) N(?: (?:digits|and (?:above|over|up)|or more))?`,
  // Decimal places, significant figures and rounding.
  `(?:uses?|keeps?|gives?|writes?|express(?:es)?|shows?|reports?|states?|formats?|rounds?) ${MEASURES}?(?:to|with|at|in) N decimal places?`,
  `(?:uses?|keeps?) N decimal places?(?: (?:for|in) ${MEASURE_NOUNS})?`,
  `(?:uses?|keeps?|gives?|reports?|writes?|states?|rounds? to) N significant (?:figures|digits)(?: (?:for|in) ${MEASURE_NOUNS})?`,
  `rounds? ${MEASURES}?to (?:N significant (?:figures|digits)|the nearest (?:N|ORD|whole number|percent|dollar))`,
  // Dates: "Writes dates with a four digit year", "Write dates with two digits for the month".
  `(?:writes?|uses?|formats?|gives?|shows?) (?:all )?(?:dates|years|the year|months|the month) (?:with|using|in|as) (?:a |an )?N digits?(?: (?:for|in) (?:the )?(?:year|month|day)s?)?`,
  `(?:writes?|uses?|formats?|gives?|shows?) (?:all )?(?:dates|years) (?:with|using|in|as) (?:a |an )?N digit (?:years?|months?|days?)`,
  // Numbered lists: "Uses numbered lists starting at 1", "Number each list from one".
  `(?:uses?|writes?|starts?|begins?) numbered (?:lists?|steps?|items?|points?|bullets?) (?:that )?(?:starting|beginning|starts?|begins?) (?:at|from|with) N`,
  // Only parts of writing are numbered ("Number each pallet from one" and "each item" are refused).
  `numbers? (?:each |every |all )?(?:lists?|list items?|steps?|points?|bullets?|questions?|paragraphs?|sections?(?: of the report)?) (?:from|starting at|starting from|beginning at|at) N`,
  // Typography: line spacing, type size, double quotes, columns.
  `(?:uses?|sets?|keeps?|prefers?|writes? (?:in|with)) (?:N|D|DOUBLE|single) (?:line )?(?:spacing|spaced)`,
  `(?:sets?|keeps?|uses?) (?:the )?line spacing (?:to|at|of) (?:N|D)`,
  `(?:uses?|sets?|prefers?|writes? in) (?:a |an )?N (?:point|pt) (?:font|fonts|type|text|body text|typeface|font size|size)`,
  `(?:sets?|keeps?) (?:the )?(?:body text|text|type|font|font size|headings?|captions?) (?:to|at|in) N (?:point|pt|points)(?: type| font)?`,
  `(?:uses?|prefers?) DOUBLE (?:quotes|quotation marks)(?: (?:for|around) (?:quotes|quotations|direct speech|titles))?`,
  // "a three-column design" may be a product's design, so only layouts and formats.
  `(?:uses?|prefers?) (?:a |an )?N column (?:layout|format)`,
  // Person: "Writes in the third person", "Use third-person wording throughout".
  `(?:writes?|stays?) (?:in|to) (?:the )?ORD person(?: (?:plural|singular))?(?: (?:when addressing the reader|throughout))?`,
  `(?:uses?|prefers?|keeps? to) (?:the )?ORD person(?: (?:plural|singular))?(?: (?:wording|voice|pronouns|forms?))?(?: throughout)?`,
  // Order of parts: "Start the fourth paragraph with the result", "Keep the tenth sentence brief".
  `(?:starts?|begins?|opens?|ends?|closes?) the ORD (?:sentence|paragraph|bullet|heading|subheading|Line|section)(?: of (?:each|every|the) (?:Line|section|paragraph|summary))? with ${WRITING_OBJECT}`,
  `(?:keeps?|makes?) the ORD (?:sentence|paragraph|bullet|heading|subheading)(?: of (?:each|every|the) (?:Line|section|paragraph))? (?:brief|short|shorter|plain|simple|concise)`,
].map((template) => new RegExp(`^${CONTEXT}${ADVERBS}${template}$`));

/** A preference's clauses as the number rule reads them, placeholders in. */
function numberClauses(text: string): string[] {
  const prepared = text.replace(/\b(?:the|all) three Lines\b/g, "the form Lines");
  const raw = [...prepared.matchAll(/\d+(?:[.,/\u2044]\d+)*(?:\s*-\s*\d+(?:[.,]\d+)*)?|[\p{L}]+(?:['’][\p{L}]+)*|[.!?;:,]|-/gu)].map(
    (match) => match[0]
  );
  const clauses: string[][] = [[]];
  let lineNumberChain = false;
  const skipped = new Set<number>();
  raw.forEach((token, index) => {
    if (skipped.has(index)) return;
    const current = clauses[clauses.length - 1]!;
    if (/^[.!?;:]$/.test(token)) {
      clauses.push([]);
      lineNumberChain = false;
      return;
    }
    if (token === "-") return;
    const previous = (raw[index - 1] === "-" ? raw[index - 2] : raw[index - 1]) ?? "";
    const next = (raw[index + 1] ?? "").toLowerCase();
    if (/^\d/.test(token)) {
      if (LINE_NUMBERS.has(token) && (/^Lines?$/i.test(previous) || (lineNumberChain && /^(?:and|or|,)$/i.test(previous)))) {
        current.push("LN");
        lineNumberChain = true;
        return;
      }
      lineNumberChain = false;
      const placeholder = /^\d{1,3}(?:\s*-\s*\d{1,3})?$/.test(token) ? "N" : /^\d{1,2}\.\d{1,2}$/.test(token) ? "D" : "BIG";
      if (placeholder === "N" && current[current.length - 1] === "N") return;
      current.push(placeholder);
      return;
    }
    if (token === ",") {
      current.push(",");
      return;
    }
    if (!/^(?:and|or)$/i.test(token)) lineNumberChain = false;
    const word = token.toLowerCase();
    let placeholder: string | null = null;
    const pronoun =
      (previous.toLowerCase() === "no" && PRONOUN_NEXT.has(next)) ||
      (next === "another" && !DETERMINERS.has(previous.toLowerCase()));
    if (word === "one") placeholder = pronoun ? null : "N";
    else if (word === "cent" && previous.toLowerCase() === "per") placeholder = null;
    else if ((word === "couple" || word === "score" || word === "scores") && next === "of") {
      // "a couple of", "a score of", "scores of": an amount, read as one count.
      if (current[current.length - 1] === "a") current.pop();
      skipped.add(index + 1);
      placeholder = "N";
    } else if (CARDINAL_WORDS.has(word)) placeholder = "N";
    else if (ORDINAL.test(word)) placeholder = "ORD";
    else if (word === "twice") {
      current.push("N", "times");
      return;
    } else if (MULTIPLIER.test(word) || FOLD.test(word)) placeholder = "MULT";
    else if (word === "double" || word === "triple") placeholder = "DOUBLE";
    // "twenty-five", "one hundred", "three quarters", "2 million": one number.
    if (placeholder === "N" && current[current.length - 1] === "N") return;
    current.push(placeholder ?? (token === "Line" || token === "Lines" ? token : word));
  });
  return clauses.flatMap((tokens) => {
    // "and" or a comma before a verb of instruction starts a new clause.
    const parts: string[][] = [[]];
    const startsInstruction = (from: number) => {
      let at = from;
      while (ADVERB_WORDS.has(tokens[at] ?? "")) at += 1;
      return CLAUSE_VERBS.has(tokens[at] ?? "");
    };
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === "," && tokens[index + 1] === "and" && startsInstruction(index + 2)) {
        parts.push([]);
        index += 1;
        continue;
      }
      if ((token === "and" || token === ",") && startsInstruction(index + 1)) {
        parts.push([]);
        continue;
      }
      if (token !== ",") parts[parts.length - 1]!.push(token);
    }
    return parts.map((part) => part.join(" ")).filter(Boolean);
  });
}

/** Whether every clause that holds a number is one complete instruction about writing. */
function numbersAreStyle(text: string): boolean {
  return numberClauses(text).every(
    (clause) => !PLACEHOLDER.test(clause) || NUMBER_TEMPLATES.some((template) => template.test(clause))
  );
}

/** Letters of scripts with no capitals, which the name rules cannot read. */
const UNCASED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u;
/** Common words a preference uses that the app's own text may not. */
const PLAIN_WORDS = [
  "prefers", "prefer", "rather", "instead", "always", "never", "writes", "write", "keeps", "keep", "starts", "start",
  "begins", "begin", "opens", "open", "closes", "close", "short", "shorter", "long", "longer", "plain", "simple",
  "active", "passive", "voice", "tense", "present", "past", "first", "person", "third", "company", "team", "client",
  "sentence", "sentences", "paragraph", "paragraphs", "bullet", "bullets", "heading", "headings", "words", "uses",
  "avoid", "avoids", "spell", "spelling", "comma", "commas", "colon", "colons", "dashes", "hyphen", "numbers",
  "figures", "metric", "metrics", "result", "results", "method", "methods", "lead", "leads", "names", "naming",
];

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}][\p{L}'-]*/gu) ?? [];
}

function stringsOf(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringsOf(item, into);
}

let vocabulary: Set<string> | null = null;
/** The app's own words: its House Rules, plain-language rules and prompt text, and common style words. */
export function appVocabulary(): ReadonlySet<string> {
  if (vocabulary) return vocabulary;
  const texts: string[] = [];
  stringsOf(houseRules, texts);
  stringsOf(humanProse, texts);
  stringsOf(promptDefinitions, texts);
  vocabulary = new Set([...texts.flatMap(tokens), ...PLAIN_WORDS]);
  return vocabulary;
}

/** Where each sentence starts: the text's start and after . ! ? : or a line break. */
function sentenceStarts(text: string): Set<number> {
  const starts = new Set<number>([0]);
  for (const match of text.matchAll(/(?:[.!?:]\s+|\n\s*|^[-*]\s+|["'“‘]\s*)/gmu)) starts.add(match.index + match[0].length);
  return starts;
}

/** Words a text capitalizes in the middle of a sentence, and words it writes in lowercase. */
function capitalization(text: string): { midCapital: Set<string>; lower: Set<string> } {
  const starts = sentenceStarts(text);
  const midCapital = new Set<string>();
  const lower = new Set<string>();
  for (const match of text.matchAll(/[\p{L}][\p{L}'&-]*/gu)) {
    const word = match[0];
    if (word === word.toLowerCase()) lower.add(word);
    else if (!starts.has(match.index)) midCapital.add(word.toLowerCase());
  }
  return { midCapital, lower };
}

function containsWhole(haystack: string, needle: string): boolean {
  const escaped = needle.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escaped.length < 3) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(haystack);
}

/**
 * Refuses a preference text that is not only about how to write. The first
 * reason found is returned; `ok` means every rule passed.
 */
export function checkPreferenceText(
  input: string,
  context: PreferenceCheckContext
): { ok: true } | { ok: false; reason: PreferenceRefusal } {
  // Sixth re-check: full-width digits, superscripts and fractions ("４０",
  // "²", "½") read as the digits they are.
  const text = input.normalize("NFKC").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_PREFERENCE_CHARS) return { ok: false, reason: "too_long" };
  // Seventh re-check: Roman numeral characters ("Ⅻ", "ⅲ") are numbers, read
  // before NFKC turns them into letters.
  if (/[\u2160-\u2188]/u.test(input)) return { ok: false, reason: "number" };
  if (/\[[A-Z][A-Z_]*_\d+\]|\b[A-Z][A-Z]+_\d+\b/.test(text)) return { ok: false, reason: "placeholder" };
  if (/\S+@\S+\.\S+|https?:\/\/|\bwww\./i.test(text) || /\+?\d[\d\s().-]{6,}\d/.test(text)) {
    return { ok: false, reason: "contact" };
  }
  // Any other numeric character (a digit of another script) is a figure.
  if (/[^\P{N}0-9]/u.test(text)) return { ok: false, reason: "number" };
  if (UNCASED_SCRIPT.test(text)) return { ok: false, reason: "script" };
  // The form's own name is a style word, never a figure or a code.
  // "11-point type", "a two-column layout": a size, not a code.
  const plain = text
    .replace(/\bT661\b/g, "form")
    .replace(/\b(\d{1,3})-(?=(?:point|pt|words?|sentences?|lines?|columns?|digits?|pages?|characters?|spaces?|levels?)\b)/gi, "$1 ");
  // A letter-and-number code ("XR-200", "OS1").
  if (/(?<![\p{L}\p{N}])(?=[\p{L}\p{N}-]*\p{L})(?=[\p{L}\p{N}-]*\p{N})[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/u.test(plain)) {
    return { ok: false, reason: "code" };
  }
  // A number only as part of how to write ("under 25 words", "spells out
  // numbers under ten", "two decimal places") or a Line number.
  if (!numbersAreStyle(plain)) return { ok: false, reason: "number" };
  const vocabulary = appVocabulary();
  for (const quote of text.matchAll(/["\u201c]([^"\u201d]*)["\u201d]|(?<![\p{L}])['\u2018]([^'\u2019]*)['\u2019](?![\p{L}])/gu)) {
    const inner = (quote[1] ?? quote[2] ?? "").trim();
    const words = inner.split(/\s+/).filter(Boolean);
    if (words.length > 3 || /\p{N}/u.test(inner)) return { ok: false, reason: "quote" };
    // A capital only in a style word ("I", "CRA"), or a quoted word of the
    // app's own vocabulary ("'The'").
    const capitalsOk = words.every(
      (word) =>
        word === word.toLowerCase() ||
        STYLE_WORDS.has(word) ||
        (vocabulary.has(word.toLowerCase()) && word.slice(1) === word.slice(1).toLowerCase())
    );
    if (!capitalsOk) return { ok: false, reason: "quote" };
  }
  const starts = sentenceStarts(plain);
  for (const match of plain.matchAll(/[\p{L}][\p{L}'&-]*/gu)) {
    const word = match[0].replace(/['\u2019]s$/u, "");
    if (word !== word.toLowerCase() && !starts.has(match.index) && !STYLE_WORDS.has(word)) {
      return { ok: false, reason: "capitalized" };
    }
  }
  for (const name of context.names) if (containsWhole(text, name)) return { ok: false, reason: "name" };
  if (context.request && context.request.length > 0) {
    const words = new Set(tokens(text));
    const seen = context.request.map((entry) => ({ ...capitalization(entry.text), company: entry.company, words: new Set(tokens(entry.text)) }));
    const midCapital = new Set(seen.flatMap((entry) => [...entry.midCapital]));
    const lower = new Set(seen.flatMap((entry) => [...entry.lower]));
    for (const word of words) {
      if (STYLE_WORDS_LOWER.has(word)) continue;
      if (midCapital.has(word) && !lower.has(word)) return { ok: false, reason: "request_capitalized" };
    }
    for (const word of words) {
      if (word.length < 5 || vocabulary.has(word)) continue;
      const companies = new Set(seen.filter((entry) => entry.words.has(word)).map((entry) => entry.company));
      if (companies.size > 0 && companies.size < 3) return { ok: false, reason: "request_word" };
    }
  }
  return { ok: true };
}

/** A text's key: folded, so the same preference written twice matches. */
export function preferenceTextKey(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
