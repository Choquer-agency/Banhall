/**
 * Transcript intake and turn parsing (phase 3, the transcript method).
 *
 * Pure and runtime-free: the browser runs it to detect a file's format and
 * render VTT/SRT to one canonical verbatim text before upload, and Convex
 * runs it again on the stored text, so turns are never taken from the
 * client. Every offset a turn carries indexes into the verbatim `content`
 * string exactly as stored on the `transcripts` row.
 *
 * `speakerOfTranscriptLine` moved here from convex/lib/seedContract.ts
 * (which re-exports it) without a change in behaviour. Parser v4 changed
 * what it reads on a line in the same way as the turns: brackets after a
 * name, "Shah, Priya" names and heading words. The transcript-wide rules
 * (Teams-pane headers, plain labels without a speaker pattern) are turns
 * only; a Seed stamp still reads one line.
 *
 * Bump TRANSCRIPT_PARSER_VERSION whenever a change here can move a turn
 * boundary, a speaker label or a clean text; stored turns built under an
 * older version are rebuilt by the backfill
 * (`transcripts:backfillTranscriptStructure`).
 *
 * v4 (2026-09-25): "Priya Shah (she/her)" and "Priya Shah (Acme)" are
 * "Priya Shah" (the bracket names the speaker only after a role word, as in
 * "Interviewer (Dana)"); "Shah, Priya" is "Priya Shah" in headers, voices
 * and labels; text copied from the Teams transcript pane (name line, time
 * line, speech) keeps its speakers; heading words ("Result:") never name a
 * speaker, and plain "Name:" labels count only with a speaker pattern
 * across the transcript. Turn and speaker rows keep their shape.
 *
 * v5 (2026-09-25, review): "Acme (Priya Shah)", one word then a full name
 * in brackets, is "Priya Shah" of Acme, unless the same bracketed name
 * follows several one-word names ("Dana (Verdant Grid)", "Sam (Verdant
 * Grid)"), which makes it their company. Every name in a label's brackets
 * is hidden as v3 hid it; job titles and departments are not names.
 *
 * v6 (2026-09-25, final review): brackets are a job title only when every
 * word is a title or department word ("VP Engineering", "Head of R&D"). A
 * company or a person whose name holds one of those words ("Northwind
 * Engineering", "Acme (Jonathan Head)") is hidden again, as v3 and v4 hid
 * it. The bump makes the build store names again for rows v5 built.
 *
 * v7 (2026-09-25, fix-g review P3-1): brackets that end in a job noun
 * ("Dana (Plant Manager)", "Priya (Mechanical Engineer)") are a title too,
 * so a first name before them stays the speaker instead of the title, and
 * the title is hidden as nothing rather than as a company or a person. A job
 * noun ends a title only after title words and job modifiers ("Plant",
 * "Field"), so "Acme (Jane Lead)" or "Siemens Field Engineer" stay hidden,
 * and each comma part of a bracket is read on its own, so "Acme (Jane Smith,
 * Engineer)" hides Jane Smith. The bump rebuilds rows v6 built at the next
 * backfill.
 *
 * v8 (2026-09-26, audit wave 2, privacy): a label may be lowercase ("priya
 * shah:"), an email address ("pshah@acme.com:", "<v priya.shah@acme.com>")
 * or written in a script with no case ("李伟:"). These weak labels pass
 * guards (no function words, headings or openers, letters only, short) and,
 * in turns, count only with a speaker pattern (a time on the line, a label
 * that recurs, or an exchange of two speakers; `dropWeakLabels`); an email
 * label always counts. A weak label no turn takes is still hidden, as
 * written (`looseLabels`). Every v7 label reads as before. The bump rebuilds
 * rows v7 built at the next backfill.
 *
 * v9 (2026-09-26, live test): a metadata heading that opens a line
 * ("Project: Low-temperature bonding", "Client: Northwind Test Labs",
 * "Topic: ...") is a heading, not a speaker, unless the same label speaks
 * again in the transcript (`dropMetadataHeadings`). Its line joins the text
 * around it, and its label is neither a speaker nor a name to hide. The bump
 * rebuilds rows v8 built at the next backfill.
 */

export const TRANSCRIPT_PARSER_VERSION = "9";

/**
 * Longest turn, in characters of stored text. A longer run of speech (a
 * plain-text transcript with no blank lines, say) is split into turns of the
 * same speaker at whitespace, so no turn's clean text approaches a
 * document's size limit and every turn fits a fact window.
 */
export const MAX_TURN_CHARS = 16_000;

export const TRANSCRIPT_SOURCE_FORMATS = [
  "teams_docx",
  "vtt",
  "srt",
  "txt",
  "zoom",
  "meet",
  "otter",
  "paste",
  "unknown",
] as const;

export type TranscriptSourceFormat = (typeof TRANSCRIPT_SOURCE_FORMATS)[number];

/** File extensions a transcript can be uploaded as. */
export const TRANSCRIPT_FILE_EXTENSIONS = [".docx", ".vtt", ".srt", ".txt"] as const;

/** The `accept` attribute for a transcript file input. */
export const TRANSCRIPT_ACCEPT = TRANSCRIPT_FILE_EXTENSIONS.join(",");

/** Short label for a detected format, shown next to a transcript row. */
export const TRANSCRIPT_FORMAT_LABELS: Record<TranscriptSourceFormat, string> = {
  teams_docx: "Teams",
  vtt: "WebVTT",
  srt: "SRT",
  txt: "Text",
  zoom: "Zoom",
  meet: "Google Meet",
  otter: "Otter",
  paste: "Pasted",
  unknown: "Unrecognized",
};

export function isTranscriptFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return TRANSCRIPT_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

// ─── Speaker labels (moved from convex/lib/seedContract.ts) ────────────────

const TIMESTAMP = String.raw`[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?[\])]?`;
const LEADING_TIMESTAMP = new RegExp(String.raw`^${TIMESTAMP}\s*(?:[-\u2013\u2014]\s*)?`);
const TRAILING_TIMESTAMP = new RegExp(String.raw`\s+${TIMESTAMP}$`);
const ONLY_TIMESTAMP = new RegExp(String.raw`^${TIMESTAMP}$`);
/** WebVTT voice span: `<v Priya Shah>` or `<v.loud Priya>`. */
const VTT_VOICE = /^<v(?:\.[^\s>]+)*\s+([^>]{1,80})>/;
/** "Priya:", "Interviewer (Dana):", "Priya Shah [00:01:02]:" followed by speech. */
const COLON_LABEL = /^(.{1,100}?)\s*:\s+\S/;
/** A header line holding only a name and its timestamp (Otter, Teams exports). */
const NAME_THEN_TIMESTAMP = new RegExp(String.raw`^(.{1,80}?)\s+${TIMESTAMP}$`);
/**
 * A bracketed time opening a line of speech that names no one: the canonical
 * render of a VTT or SRT cue without a speaker (`[00:00:05] text`).
 */
const BRACKETED_TIME_LEAD = /^\[\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\]\s+(?=\S)/;
/** Zoom's header: `[Priya Shah] 10:02:33`. New with the parser; not a Seed stamp. */
const ZOOM_HEADER = new RegExp(String.raw`^\[([^\]\n]{1,80})\]\s+(${TIMESTAMP})$`);
const NAME_PARTICLES = new Set(["de", "da", "di", "du", "del", "der", "van", "von", "la", "le", "bin", "al"]);
/**
 * Heading words that end in a colon in exported transcripts and notes but
 * name no one ("Result: throughput improved 30%"). A label is refused when
 * it is one of these, or when it ends in one ("Key Findings", "Next Steps").
 */
const NOT_A_SPEAKER = new Set([
  "agenda", "attendees", "date", "duration", "location", "meeting", "note",
  "notes", "participants", "recording", "summary", "time", "title", "transcript",
  // Parser v4 (2026-09-25): common headings in notes pasted as transcripts.
  "action", "actions", "advancement", "advancements", "approach", "background",
  "budget", "challenge", "challenges", "comment", "comments", "conclusion",
  "conclusions", "context", "cost", "costs", "deadline", "decision", "decisions",
  "example", "examples", "experiment", "experiments", "finding", "findings",
  "goal", "goals", "highlights", "hypothesis", "hypotheses", "introduction",
  "issue", "issues", "items", "method", "methods", "methodology", "objective",
  "objectives", "observation", "observations", "outcome", "outcomes", "overview",
  "problem", "problems", "purpose", "reason", "recommendation", "recommendations",
  "reference", "references", "result", "results", "risk", "risks", "scope",
  "solution", "solutions", "source", "sources", "status", "step", "steps",
  "takeaway", "takeaways", "timeline", "total", "uncertainty", "uncertainties",
  "update", "updates",
]);
/**
 * Parser v9: words that open a transcript's metadata lines ("Project: ...",
 * "Client: ...", "Recorded: ..."). Unlike NOT_A_SPEAKER they can stand for a
 * speaker, so a label holding one is a heading only in the lines above the
 * exchange (`dropMetadataHeadings`).
 */
const METADATA_HEADINGS = new Set([
  "claimant", "client", "company", "customer", "interview", "organisation",
  "organization", "project", "re", "recorded", "regarding", "session", "subject",
  "topic", "venue",
]);
/** Of those, the words that also name a speaker's role ("Client: We tried that."). */
const METADATA_ROLES = new Set(["claimant", "client", "customer", "subject"]);
/**
 * Labels that name a role, not a person: in "Interviewer (Dana)" the name in
 * brackets is the speaker; in "Priya Shah (Acme)" it is not.
 */
const ROLE_LABEL = /^(?:interviewer|interviewee|subject|client|host|co-?host|moderator|facilitator|consultant|respondent|participant|guest|presenter|panelist|speaker|person|attendee|customer|expert|q|a)(?:\s+\d+)?$/i;
/**
 * Words that open a sentence before a comma and a name ("Well, Dana: ..."),
 * and short replies that stand on a line of their own. Never a surname, and
 * never a speaker's whole name on a line above a time.
 */
const NOT_A_NAME = new Set([
  "absolutely", "actually", "again", "agreed", "alright", "also", "and",
  "anyway", "basically", "but", "bye", "cool", "correct", "definitely",
  "exactly", "fine", "finally", "first", "good", "great", "hello", "hey", "hi",
  "hmm", "honestly", "indeed", "listen", "look", "no", "nope", "now", "oh",
  "ok", "okay", "perfect", "please", "plus", "right", "second", "see", "so",
  "sorry", "sure", "thanks", "then", "totally", "true", "wait", "well", "wow",
  "yeah", "yep", "yes",
]);

function nameWords(text: string): boolean {
  const words = text.split(/\s+/);
  if (words.length === 0 || words.length > 5) return false;
  return words.every((word, index) => {
    if (!/^[\p{L}\p{M}\d'’.\-]+$/u.test(word)) return false;
    if (/^\p{Lu}/u.test(word)) return true;
    if (index === 0) return false;
    return /^\d+$/.test(word) || NAME_PARTICLES.has(word.toLowerCase());
  });
}

/**
 * Last words that mark a company's name ("Northwind Labs", "Acme Corp",
 * "Northwind Engineering"), never a person's (parser v5). The department
 * words here end a company's name after a name word ("Pacific Research"),
 * and a title only when every word is a title word ("VP Engineering").
 */
const ORG_WORDS = new Set([
  "inc", "incorporated", "ltd", "limited", "llc", "corp", "corporation", "co",
  "company", "plc", "gmbh", "ulc", "lp", "llp", "technologies", "technology",
  "systems", "solutions", "group", "holdings", "labs", "laboratories",
  "industries", "international", "enterprises", "services", "software",
  "energy", "canada", "engineering", "research", "design", "development",
  "science", "sciences", "consulting", "analytics", "robotics",
]);

/**
 * Job titles and departments written in a label's brackets ("Priya Shah
 * (CTO)", "Raj Patel (Engineering)", "Head of R&D"). Brackets are a title,
 * naming no one and no company, when every word is one of these or a
 * connector, or when they end in a job noun (JOB_NOUNS): "Northwind
 * Engineering" and "Jonathan Head" hold a name word, so they stay hidden
 * (parser v5, review 2026-09-25).
 */
const TITLE_WORDS = new Set([
  "ceo", "cto", "cfo", "coo", "cio", "vp", "svp", "evp", "president", "chief",
  "officer", "director", "manager", "lead", "head", "engineer", "engineering",
  "scientist", "science", "research", "researcher", "developer", "development",
  "analyst", "architect", "founder", "cofounder", "co-founder", "owner",
  "partner", "principal", "senior", "junior", "sales", "marketing", "finance",
  "operations", "product", "design", "designer", "hr", "legal", "it", "r&d",
  "qa", "support", "technician", "specialist", "coordinator", "consultant",
  "advisor", "intern", "team", "technology", "technical", "executive",
  "financial", "operating", "information", "vice", "general", "program",
  "project", "business", "data", "software", "hardware", "staff", "assistant",
]);
const TITLE_CONNECTORS = new Set(["of", "and", "&"]);
/**
 * Words for a person's job that end a title ("Plant Manager", "Lab
 * Technician", "Principal Investigator") and are almost never a surname
 * (parser v7, fix-g review P3-1). "Head", "Owner", "Partner", "Chief",
 * "General" and "Foreman" are left out: "Acme (Jonathan Head)" is a person.
 */
const JOB_NOUNS = new Set([
  "manager", "engineer", "technician", "technologist", "investigator",
  "associate", "scientist", "researcher", "developer", "analyst", "architect",
  "director", "officer", "specialist", "coordinator", "consultant", "advisor",
  "adviser", "intern", "assistant", "designer", "founder", "cofounder",
  "co-founder", "president", "supervisor", "administrator", "programmer",
  "chemist", "physicist", "biologist", "operator", "machinist", "estimator",
  "controller", "accountant", "superintendent", "representative",
  "executive", "lead", "strategist", "economist", "statistician",
]);

/** Words that can sit before a job noun in a title ("Plant Manager", "Field Engineer"). */
const JOB_MODIFIERS = new Set([
  "plant", "lab", "laboratory", "mechanical", "electrical", "electronics", "chemical", "civil",
  "process", "quality", "field", "site", "shop", "test", "testing", "manufacturing", "production",
  "controls", "automation", "maintenance", "systems", "materials", "firmware", "embedded", "mechatronics",
]);

function lastWord(text: string): string {
  const words = text.toLowerCase().replace(/[.,]+$/, "").split(/\s+/);
  return words[words.length - 1];
}

/**
 * Whether brackets hold a job title: every word a title or department word
 * or a connector ("VP Engineering", parser v6), or any words ending in a
 * job noun ("Plant Manager", "Senior Mechanical Engineer", parser v7).
 */
function isTitle(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).map((word) => word.replace(/[.,]+$/, ""));
  // A job noun ends a title only when every word before it is a title word,
  // a connector or a job modifier: "Plant Manager" is a title, but "Jane
  // Lead", "Farokh Engineer" or "Siemens Field Engineer" must stay hidden.
  if (
    JOB_NOUNS.has(words[words.length - 1]) &&
    words
      .slice(0, -1)
      .every((word) => TITLE_WORDS.has(word) || TITLE_CONNECTORS.has(word) || JOB_MODIFIERS.has(word))
  ) {
    return true;
  }
  return (
    words.some((word) => TITLE_WORDS.has(word)) &&
    words.every((word) => TITLE_WORDS.has(word) || TITLE_CONNECTORS.has(word))
  );
}

/** A label split at its closing brackets: "Priya Shah (Acme)". */
function bracketParts(rawLabel: string): { outer: string; inner: string } | undefined {
  const label = rawLabel.trim().replace(TRAILING_TIMESTAMP, "");
  const paren = /^(.+?)\s*[(\[]([^()[\]]{1,80})[)\]]$/.exec(label);
  return paren ? { outer: paren[1].trim(), inner: paren[2].trim() } : undefined;
}

/**
 * Whether brackets hold a person's full name after one word that is more
 * likely a company's ("Acme (Priya Shah)"): two to five name words, not a
 * role, pronouns, a time, a title or a company's name. The name in brackets
 * is then the speaker and the word before it the organization (parser v5,
 * review 2026-09-25); `resolveBracketSpeakers` turns this round when the
 * same bracketed name follows several words ("Dana (Verdant Grid)", "Sam
 * (Verdant Grid)").
 */
function companyThenName(parts: { outer: string; inner: string }): boolean {
  const { outer, inner } = parts;
  if (/\s/.test(outer) || !nameWords(outer) || ROLE_LABEL.test(outer) || isHeadingLabel(outer)) return false;
  if (ONLY_TIMESTAMP.test(inner) || inner.includes("/") || ROLE_LABEL.test(inner)) return false;
  const words = inner.split(/\s+/);
  if (words.length < 2 || !nameWords(inner)) return false;
  return !ORG_WORDS.has(lastWord(inner)) && !isTitle(inner);
}

function isHeadingLabel(label: string): boolean {
  const words = label.toLowerCase().split(/\s+/);
  return NOT_A_SPEAKER.has(words.join(" ")) || (words.length <= 3 && NOT_A_SPEAKER.has(words[words.length - 1]));
}

/**
 * "Shah, Priya" as "Priya Shah": the surname, a comma, then the given
 * names, as Teams and directory exports write them. Each side is one to
 * three name words, and the surname is not a word that opens a sentence
 * ("Well, Dana").
 */
function lastFirstName(label: string): string | undefined {
  const match = /^([^,]+),\s*([^,]+)$/.exec(label);
  if (!match) return undefined;
  const surname = match[1].trim();
  const given = match[2].trim();
  const surnameWords = surname.split(/\s+/);
  const givenWords = given.split(/\s+/);
  if (surnameWords.length > 3 || givenWords.length > 3) return undefined;
  if (!nameWords(surname) || !nameWords(given)) return undefined;
  if (NOT_A_NAME.has(surname.toLowerCase()) || NOT_A_NAME.has(given.toLowerCase())) return undefined;
  return `${given} ${surname}`;
}

/**
 * A speaker from a label such as "Priya", "Speaker 2", "Interviewer (Dana)",
 * "Subject (Marcus Lindqvist, CTO)" or "Shah, Priya". The name in brackets
 * wins only after a role word; after a name, brackets hold pronouns, a
 * company or a role ("Priya Shah (she/her)", "Priya Shah (Acme)") and are
 * left off, so two people never share one label (parser v4).
 */
function speakerFromLabel(raw: string): string | undefined {
  let label = raw.trim().replace(TRAILING_TIMESTAMP, "");
  const parts = bracketParts(label);
  let preferred: string | undefined;
  if (parts) {
    label = parts.outer;
    const inner = parts.inner;
    if (!ONLY_TIMESTAMP.test(inner) && ROLE_LABEL.test(label)) {
      const first = inner.split(",")[0].trim();
      if (/^\p{L}/u.test(first) && first.length >= 2) preferred = first;
    } else if (companyThenName(parts)) {
      preferred = inner;
    }
  }
  if (label.length < 2 || label.length > 60) return undefined;
  const name = nameWords(label) ? label : lastFirstName(label);
  if (!name || isHeadingLabel(name)) return undefined;
  return preferred ?? name;
}

// ─── Weak labels (parser v8) ────────────────────────────────────────────────

/**
 * How a label that `speakerFromLabel` refuses may still name a speaker:
 * lowercase words ("priya shah"), an email address ("pshah@acme.com") or
 * words in a script with no case ("李伟", "محمد علي").
 */
export type WeakLabelKind = "lower" | "caseless" | "email";

/** Which weak kinds a caller accepts; none means v7's rule only. */
type WeakKinds = ReadonlySet<WeakLabelKind>;

const ALL_WEAK: WeakKinds = new Set<WeakLabelKind>(["lower", "caseless", "email"]);
const CASELESS_ONLY: WeakKinds = new Set<WeakLabelKind>(["caseless"]);

/** The time the canonical cue render writes after a name (`Name [00:00:01]:`). */
const CANONICAL_LABEL_TIME = /\s+\[(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]$/;

/** An email address as the whole label ("pshah@acme.com", "priya.shah@acme.com"). */
const EMAIL_LABEL = /^[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+$/u;

/**
 * Words a lowercase label never holds: function words, pronouns, verbs of
 * saying, question words and the notes words that open a line of prose with
 * a colon ("note:", "fyi:", "the answer is:"). With NOT_A_NAME and
 * NOT_A_SPEAKER, so "well:", "result:" and "next steps:" name no one.
 */
const LOWERCASE_NOT_A_NAME = new Set([
  "a", "about", "above", "after", "all", "am", "an", "and", "answer", "answers",
  "any", "are", "as", "asked", "at", "be", "because", "been", "before",
  "being", "below", "between", "both", "btw", "but", "by", "can", "caution",
  "cc", "con", "cons", "could", "currently", "did", "do", "does", "doing",
  "done", "each", "edit", "eg", "email", "error", "etc", "every", "few", "for",
  "from", "fw", "fwd", "fyi", "had", "has", "have", "he", "her", "here",
  "hers", "him", "his", "how", "however", "i", "ie", "if", "important", "in",
  "including", "info", "input", "into", "is", "it", "its", "just", "key",
  "last", "like", "link", "log", "main", "may", "me", "might", "mine", "more",
  "most", "must", "my", "name", "namely", "nb", "new", "next", "not", "of",
  "off", "on", "one", "only", "or", "other", "otherwise", "our", "ours",
  "out", "output", "over", "overall", "page", "part", "phone", "point",
  "points", "pro", "pros", "ps", "q", "question", "questions", "quote", "re",
  "reply", "response", "said", "same", "say", "says", "section", "she",
  "should", "since", "some", "such", "than", "that", "the", "their",
  "theirs", "them", "there", "therefore", "these", "they", "thing", "things",
  "this", "those", "three", "thus", "tip", "tldr", "to", "todo", "too", "two",
  "until", "up", "us", "very", "warning", "was", "we", "were", "what", "when",
  "where", "which", "while", "who", "whom", "whose", "why", "will", "with",
  "without", "would", "wrote", "you", "your", "yours",
  // Languages, as bilingual notes and subtitles head their lines ("français:").
  "english", "french", "français", "francais", "anglais", "spanish", "español",
  "espanol", "german", "deutsch", "allemand", "italian", "italiano", "portuguese",
  "português", "chinese", "mandarin", "cantonese", "japanese", "korean", "arabic",
  "hebrew", "hindi", "translation", "traduction", "translated", "original",
  "subtitle", "subtitles", "caption", "captions",
  // Language codes, as subtitle and translation files head their lines ("en:", "fr:").
  "en", "fr", "de", "es", "zh", "ja", "ko", "pt", "ru", "ar", "nl", "sv", "da", "fi",
  "pl", "tr", "hi", "vi", "th", "he", "el", "cs", "hu", "ro", "uk", "id", "ms", "fa",
  "ur", "bn", "ta", "te", "nb", "nn", "ca", "eu", "gl", "hr", "sk", "sl", "sr", "bg", "lt",
  "lv", "et", "tl", "sw", "en-us", "en-gb", "fr-ca", "zh-cn", "zh-tw", "pt-br",
]);

/**
 * Whether a lowercase word is a common word no weak label or name part is
 * made of (function words, notes words, languages). Placeholder maps use it
 * for mailbox names and name parts.
 */
export function isCommonLowercaseWord(word: string): boolean {
  const lower = word.toLowerCase();
  return LOWERCASE_NOT_A_NAME.has(lower) || NOT_A_NAME.has(lower) || NOT_A_SPEAKER.has(lower);
}

/**
 * Words in scripts with no case that head a line of notes rather than name
 * a speaker ("注意:", "问题:", "ملاحظة:"). Kept short: a weak label still
 * needs to recur or carry a time before it opens a turn.
 */
const CASELESS_NOT_A_NAME = new Set([
  "注意", "备注", "问题", "答案", "问", "答", "总结", "结论", "时间", "日期", "议程", "主题", "会议", "记录", "说明",
  "注", "質問", "回答", "議題", "日時", "場所", "参加者", "メモ", "まとめ", "結論",
  "질문", "답변", "참고", "요약", "메모", "주제", "일시", "장소", "참석자", "결론",
  "ملاحظة", "سؤال", "جواب", "ملخص", "الموضوع", "التاريخ",
  "הערה", "שאלה", "תשובה", "סיכום",
  // Languages.
  "中文", "英文", "英语", "汉语", "普通话", "粤语", "日本語", "日语", "英語", "中国語", "翻译", "翻訳", "原文",
  "한국어", "영어", "중국어", "일본어", "번역", "العربية", "الإنجليزية", "الفرنسية", "עברית", "אנגלית",
]);

/**
 * Whether a caseless word heads a line of notes rather than names someone
 * (the weak-label stop list). Placeholder maps use it too.
 */
export function isCommonCaselessWord(word: string): boolean {
  return CASELESS_NOT_A_NAME.has(word);
}

function lowercaseName(label: string): boolean {
  const words = label.split(/\s+/);
  if (words.length === 0 || words.length > 3 || !/^\p{Ll}/u.test(words[0])) return false;
  return words.every((word) => {
    // Lowercase letters only: "createdAt" or "userId" is a key, not a name.
    if (!/^[\p{Ll}\p{M}'’-]+$/u.test(word) || word.length < 2) return false;
    const lower = word.toLowerCase();
    return !LOWERCASE_NOT_A_NAME.has(lower) && !NOT_A_NAME.has(lower) && !NOT_A_SPEAKER.has(lower);
  });
}

function caselessName(label: string): boolean {
  const words = label.split(/\s+/);
  if (words.length === 0 || words.length > 4 || label.length > 30) return false;
  return words.every(
    (word) =>
      /^[\p{Lo}\p{Lm}\p{M}'’·・.-]+$/u.test(word) &&
      /\p{Lo}/u.test(word) &&
      [...word].length <= 12 &&
      !CASELESS_NOT_A_NAME.has(word)
  );
}

/**
 * A label v7 refuses that may still name a speaker (parser v8). The same
 * bracket rule as `speakerFromLabel`: a role word before the brackets gives
 * the name inside ("interviewer (dana)"), anything else after a name is left
 * off. Callers decide which kinds they accept.
 */
function weakSpeakerFromLabel(
  raw: string,
  kinds: WeakKinds
): { speaker: string; weak: WeakLabelKind } | undefined {
  const written = raw.trim();
  const withoutTime = written.replace(TRAILING_TIMESTAMP, "");
  if (kinds.has("email") && withoutTime.length <= 80 && EMAIL_LABEL.test(withoutTime)) {
    return { speaker: withoutTime, weak: "email" };
  }
  // Only the canonical render's bracketed time may follow a weak label; a
  // time or any digit inside one ("around 10:30:", "roughly 2") is prose.
  // Full-width brackets read as brackets ("李伟（研发）", review P3).
  let label = written
    .replace(CANONICAL_LABEL_TIME, "")
    .replace(/[\uFF08\u3010]/g, "(")
    .replace(/[\uFF09\u3011]/g, ")");
  if (/\p{N}/u.test(label)) return undefined;
  const parts = bracketParts(label);
  let preferred: string | undefined;
  if (parts) {
    label = parts.outer;
    if (!ONLY_TIMESTAMP.test(parts.inner) && ROLE_LABEL.test(label)) {
      const first = parts.inner.split(",")[0].trim();
      if (/^\p{L}/u.test(first) && first.length >= 2) preferred = first;
    }
  }
  if (label.length < 2 || label.length > 60 || isHeadingLabel(label)) return undefined;
  if (kinds.has("lower") && (lowercaseName(label) || (/^\p{Ll}/u.test(label) && ROLE_LABEL.test(label)))) {
    return { speaker: preferred ?? label, weak: "lower" };
  }
  if (kinds.has("caseless") && caselessName(label)) return { speaker: preferred ?? label, weak: "caseless" };
  return undefined;
}

/** A VTT voice's name, with "Shah, Priya" read as "Priya Shah". */
function voiceSpeaker(raw: string): string | undefined {
  const voice = raw.trim();
  if (!voice) return undefined;
  return lastFirstName(voice) ?? voice;
}

/**
 * The names a label holds besides its speaker's, hidden with the speakers'
 * names (owner decision 26). An organization in brackets ("Acme" in "Priya
 * Shah (Acme)", "Northwind Labs") is an organization. Brackets holding two
 * or more name words that are not a company's name are hidden as a person,
 * word by word too, as every parser before v4 did ("Acme (Priya Shah)",
 * review 2026-09-25), and so is the other side of such a label. Pronouns,
 * roles, times, job titles and departments are not names.
 */
export function labelBracketNames(rawLabel: string): { people: string[]; organizations: string[] } {
  const none = { people: [], organizations: [] };
  const parts = bracketParts(rawLabel);
  if (!parts || ROLE_LABEL.test(parts.outer)) return none;
  // Comma parts are read one at a time, so "Acme (Jane Smith, Engineer)"
  // still hides Jane Smith: a comma used to make the whole bracket unreadable
  // and nothing in it was hidden (review 2026-09-25, fix-g P2-2).
  if (parts.inner.includes(",")) {
    const people = new Set<string>();
    const organizations = new Set<string>();
    for (const segment of parts.inner.split(",")) {
      const piece = segment.trim();
      if (!piece) continue;
      const found = labelBracketNames(`${parts.outer} (${piece})`);
      for (const name of found.people) people.add(name);
      for (const name of found.organizations) organizations.add(name);
    }
    return { people: [...people], organizations: [...organizations] };
  }
  if (companyThenName(parts)) return { people: [parts.inner], organizations: [parts.outer] };
  const inner = parts.inner;
  if (ONLY_TIMESTAMP.test(inner) || inner.includes("/") || ROLE_LABEL.test(inner)) return none;
  if (inner.length < 3 || !nameWords(inner) || isTitle(inner)) return none;
  if (/\s/.test(inner) && !ORG_WORDS.has(lastWord(inner))) return { people: [inner], organizations: [] };
  return { people: [], organizations: [inner] };
}

/**
 * Every string a speaker label may have been read as, by this parser or an
 * earlier one: the label as written, the name before its brackets, the
 * brackets' content and its first comma part, and "Shah, Priya" as written
 * and as "Priya Shah". A rebuild uses these to carry a role set on an old
 * label over to the label the new parse gives the same line (review
 * 2026-09-25).
 */
export function rawLabelForms(rawLabel: string): string[] {
  const label = rawLabel.trim().replace(TRAILING_TIMESTAMP, "");
  const forms = new Set([label]);
  const parts = bracketParts(label);
  const names = parts ? [label, parts.outer] : [label];
  if (parts) {
    forms.add(parts.outer);
    forms.add(parts.inner);
    forms.add(parts.inner.split(",")[0].trim());
  }
  for (const name of names) {
    const named = lastFirstName(name);
    if (named) forms.add(named);
  }
  forms.delete("");
  return [...forms];
}

/** The speaker a transcript line opens with, if it opens a turn. */
export function speakerOfTranscriptLine(line: string): string | undefined {
  const text = line.replace(/\r$/, "").trim();
  if (!text) return undefined;
  const voice = VTT_VOICE.exec(text);
  if (voice) return voiceSpeaker(voice[1]);
  const afterTime = text.replace(LEADING_TIMESTAMP, "");
  const colon = COLON_LABEL.exec(afterTime);
  if (colon) return speakerFromLabel(colon[1]);
  if (afterTime === text) {
    const header = NAME_THEN_TIMESTAMP.exec(text);
    if (header) return speakerFromLabel(header[1]);
  }
  return undefined;
}

/** Milliseconds from `0:03`, `02:03`, `1:02:03`, `00:00:03.520` or `00:00:03,520`. */
export function timestampToMs(raw: string): number | undefined {
  const match = /(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d{1,3}))?/.exec(raw);
  if (!match) return undefined;
  const [, a, b, c, fraction] = match;
  const millis = fraction ? Number(fraction.padEnd(3, "0")) : 0;
  const seconds =
    c === undefined
      ? Number(a) * 60 + Number(b)
      : Number(a) * 3600 + Number(b) * 60 + Number(c);
  return seconds * 1000 + millis;
}

/** `hh:mm:ss` for a millisecond offset, as the canonical render writes it. */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export type SpeakerLine =
  | {
      kind: "inline";
      speaker: string;
      /** The label as written, before normalization ("Interviewer (Dana)"). */
      rawLabel: string;
      /** Index in the line where the speech starts. */
      speechOffset: number;
      timeMs?: number;
    }
  | { kind: "header"; speaker: string; rawLabel: string; timeMs?: number }
  | { kind: "timestamp"; timeMs?: number }
  /** A bracketed time, then speech that names no one (`[00:00:05] text`). */
  | { kind: "timed"; timeMs?: number; speechOffset: number };

/**
 * How one line opens a turn, if it does. `inline` carries speech after the
 * label, `header` is a name and a time on its own line (Teams, Otter, Zoom),
 * `timestamp` is a time on its own line (Google Meet), `timed` is a
 * bracketed time and speech with no name (a VTT or SRT cue that named no
 * one). Agrees with `speakerOfTranscriptLine` on every line that function
 * names a speaker for.
 */
export function splitSpeakerLine(line: string): SpeakerLine | undefined {
  const withoutCr = line.replace(/\r$/, "");
  const lead = withoutCr.length - withoutCr.trimStart().length;
  const text = withoutCr.trim();
  if (!text) return undefined;
  if (ONLY_TIMESTAMP.test(text)) return { kind: "timestamp", timeMs: timestampToMs(text) };
  const voice = VTT_VOICE.exec(text);
  if (voice) {
    const speaker = voiceSpeaker(voice[1]);
    if (!speaker) return undefined;
    return { kind: "inline", speaker, rawLabel: voice[1].trim(), speechOffset: lead + voice[0].length };
  }
  const timePrefix = LEADING_TIMESTAMP.exec(text);
  const afterTime = timePrefix ? text.slice(timePrefix[0].length) : text;
  const colon = /^(.{1,100}?)\s*:\s+(?=\S)/.exec(afterTime);
  if (colon && COLON_LABEL.test(afterTime)) {
    const speaker = speakerFromLabel(colon[1]);
    if (speaker) {
      const labelTime = TRAILING_TIMESTAMP.exec(colon[1].trim());
      const time = labelTime?.[0] ?? timePrefix?.[0];
      return {
        kind: "inline",
        speaker,
        rawLabel: colon[1].trim(),
        speechOffset: lead + (timePrefix?.[0].length ?? 0) + colon[0].length,
        ...(time ? { timeMs: timestampToMs(time) } : {}),
      };
    }
    // Not a speaker: "[00:00:03] We tested two options: the first failed"
    // is an unnamed cue whose speech holds a colon, so it is still timed.
    if (!BRACKETED_TIME_LEAD.test(text)) return undefined;
  }
  const timed = BRACKETED_TIME_LEAD.exec(text);
  if (timed) {
    return { kind: "timed", timeMs: timestampToMs(timed[0]), speechOffset: lead + timed[0].length };
  }
  if (!timePrefix) {
    const zoom = ZOOM_HEADER.exec(text);
    if (zoom) {
      const speaker = speakerFromLabel(zoom[1]) ?? (zoom[1].trim() || undefined);
      return speaker
        ? { kind: "header", speaker, rawLabel: zoom[1].trim(), timeMs: timestampToMs(zoom[2]) }
        : undefined;
    }
    const header = NAME_THEN_TIMESTAMP.exec(text);
    if (header) {
      const speaker = speakerFromLabel(header[1]);
      if (!speaker) return undefined;
      return {
        kind: "header",
        speaker,
        rawLabel: header[1].trim(),
        timeMs: timestampToMs(text.slice(header[1].length)),
      };
    }
  }
  return undefined;
}

/** A line a weak label may open (parser v8): never a turn on its own. */
export type WeakSpeakerLine = Extract<SpeakerLine, { kind: "inline" | "header" }> & {
  weak: WeakLabelKind;
  /** How the label is written, so it is compared with v7 labels of the same form. */
  form: "header" | "inline" | "inline-lead-time" | "inline-label-time";
};

/** A caseless label before a full-width colon, or an ASCII colon with no space ("李伟：我们", "李伟:我们"). */
const CASELESS_COLON_LABEL = /^(.{0,29}?[^\d\s])[ \t]*[:\uFF1A][ \t]*(?=\S)/;

/**
 * A weak label a line may open with, for a line v7 reads as no speaker
 * (`splitSpeakerLine` returns no inline or header kind for it). Only a
 * candidate: `analyzeLines` makes it a speaker under the evidence rules of
 * `promoteWeakOpeners`, and a candidate that fails stays text.
 */
export function weakSpeakerLine(line: string): WeakSpeakerLine | undefined {
  const v7 = splitSpeakerLine(line);
  if (v7?.kind === "inline" || v7?.kind === "header" || v7?.kind === "timestamp") return undefined;
  const withoutCr = line.replace(/\r$/, "");
  const lead = withoutCr.length - withoutCr.trimStart().length;
  const text = withoutCr.trim();
  if (!text || VTT_VOICE.test(text)) return undefined;
  // An indented "key: value," line is code or a data dump, never a turn.
  if (/^(?:\t| {2})/.test(withoutCr) || /[,{([;]$/.test(text)) return undefined;
  const timePrefix = LEADING_TIMESTAMP.exec(text);
  const afterTime = timePrefix ? text.slice(timePrefix[0].length) : text;
  const colon = /^(.{1,100}?)\s*:\s+(?=\S)/.exec(afterTime);
  const caselessColon = colon ? undefined : CASELESS_COLON_LABEL.exec(afterTime);
  const match = colon ?? caselessColon;
  const read = match ? weakSpeakerFromLabel(match[1], colon ? ALL_WEAK : CASELESS_ONLY) : undefined;
  // Speech holds words: "rate: 5" or "temp: 20.5" is a reading, not a turn.
  if (match && read && (read.weak === "email" || /\p{L}/u.test(afterTime.slice(match[0].length)))) {
    const labelTime = CANONICAL_LABEL_TIME.exec(match[1].trim());
    const time = labelTime?.[1] ?? timePrefix?.[0];
    return {
      kind: "inline",
      speaker: read.speaker,
      rawLabel: match[1].trim(),
      speechOffset: lead + (timePrefix?.[0].length ?? 0) + match[0].length,
      ...(time ? { timeMs: timestampToMs(time) } : {}),
      weak: read.weak,
      form: timePrefix ? "inline-lead-time" : labelTime ? "inline-label-time" : "inline",
    };
  }
  if (!timePrefix) {
    const header = NAME_THEN_TIMESTAMP.exec(text);
    if (header) {
      const read = weakSpeakerFromLabel(header[1], ALL_WEAK);
      if (!read) return undefined;
      return {
        kind: "header",
        speaker: read.speaker,
        rawLabel: header[1].trim(),
        timeMs: timestampToMs(text.slice(header[1].length)),
        weak: read.weak,
        form: "header",
      };
    }
  }
  return undefined;
}

/** The form of a v7 label line, to compare a weak candidate with (`WeakSpeakerLine.form`). */
function v7Form(text: string, kind: Extract<SpeakerLine, { kind: "inline" | "header" }>): WeakSpeakerLine["form"] | "voice" {
  if (kind.kind === "header") return "header";
  const line = text.trim();
  if (VTT_VOICE.test(line)) return "voice";
  if (LEADING_TIMESTAMP.test(line)) return "inline-lead-time";
  return TRAILING_TIMESTAMP.test(kind.rawLabel) ? "inline-label-time" : "inline";
}

// ─── Format detection and canonical render ────────────────────────────────

const CUE_TIMING = /^\s*(\d{1,2}:\d{1,2}(?::\d{1,2})?[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{1,2}(?::\d{1,2})?[.,]\d{1,3})/;

function extensionOf(fileName: string | undefined): string {
  if (!fileName) return "";
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function looksLikeVtt(text: string): boolean {
  return /^﻿?WEBVTT\b/.test(text.trimStart());
}

function looksLikeSrt(text: string): boolean {
  const all = lines(text.trimStart());
  return /^\d+$/.test(all[0]?.trim() ?? "") && CUE_TIMING.test(all[1] ?? "");
}

function countMatching(all: string[], test: (line: string) => boolean): number {
  let count = 0;
  for (const line of all) if (test(line)) count += 1;
  return count;
}

/**
 * The format a transcript was exported in, from its file name and text.
 * Detection only picks the render and the label; the parser reads every
 * format with the same turn rules.
 */
export function detectTranscriptFormat(args: {
  fileName?: string;
  text: string;
  intake?: "file" | "paste";
}): TranscriptSourceFormat {
  const extension = extensionOf(args.fileName);
  const text = args.text;
  if (extension === ".vtt" || looksLikeVtt(text)) return "vtt";
  if (extension === ".srt" || looksLikeSrt(text)) return "srt";
  const all = lines(text).slice(0, 4000);
  if (/otter\.ai/i.test(text)) return "otter";
  const zoomHeaders = countMatching(all, (line) => ZOOM_HEADER.test(line.trim()));
  if (zoomHeaders >= 2) return "zoom";
  const timestampLines = countMatching(all, (line) => ONLY_TIMESTAMP.test(line.trim()));
  const colonTurns = countMatching(all, (line) => {
    const split = splitSpeakerLine(line);
    return split?.kind === "inline";
  });
  const headers = countMatching(all, (line) => splitSpeakerLine(line)?.kind === "header");
  if (/^\s*meeting (transcript|notes)\b/im.test(text.slice(0, 2000)) && timestampLines >= 1 && colonTurns >= 1) {
    return "meet";
  }
  if (extension === ".docx") {
    if (countMatching(all, (line) => CUE_TIMING.test(line)) >= 2) return "teams_docx";
    return headers >= 2 ? "teams_docx" : colonTurns >= 2 ? "teams_docx" : "unknown";
  }
  if (timestampLines >= 2 && colonTurns >= 2 && timestampLines <= colonTurns) return "meet";
  if (args.intake === "paste" || extension === "") return "paste";
  if (extension === ".txt") return "txt";
  return "unknown";
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&lrm;": "", "&rlm;": "",
};

function cueText(raw: string): string {
  return raw
    .replace(/<\/?(?:c|i|b|u|v|lang|ruby|rt)(?:\.[^>\s]*)?(?:\s[^>]*)?>/g, "")
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp|lrm|rlm);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

type Cue = { startMs?: number; speaker?: string; text: string };

/**
 * Cues of a WebVTT or SRT file (also a Teams .docx that kept cue timings).
 * A blank line ends a VTT or SRT cue. In a Word document every paragraph
 * ends in a blank line once extracted, so a Teams cue whose timing, name and
 * speech are separate paragraphs runs to the next timing line instead
 * (`acrossBlankLines`).
 */
function parseCues(text: string, options: { acrossBlankLines?: boolean } = {}): Cue[] {
  const reads = cueBlocks(text, options).map(readCue);
  // Parser v8: a weak name names its cue only under the evidence rules of
  // `promoteWeakOpeners`; otherwise the cue reads exactly as under v7.
  const openers: WeakOpener[] = [];
  reads.forEach((read, at) => {
    if (read.speaker !== undefined) openers.push({ at, speaker: read.speaker, form: "cue" });
    else if (read.weak) openers.push({ at, speaker: read.weak.speaker, weak: read.weak.kind, form: "cue" });
  });
  const promoted = promoteWeakOpeners(openers);
  const cues: Cue[] = [];
  reads.forEach((read, at) => {
    const speaker = promoted.get(at);
    const cue =
      speaker !== undefined && read.weak
        ? { startMs: read.startMs, speaker, text: read.weak.text }
        : { startMs: read.startMs, speaker: read.speaker, text: read.text };
    if (cue.text) cues.push(cue);
  });
  return cues;
}

type CueBlock = { startMs?: number; body: string[] };

function cueBlocks(text: string, options: { acrossBlankLines?: boolean }): CueBlock[] {
  const blocks: CueBlock[] = [];
  const all = lines(text);
  let index = 0;
  while (index < all.length) {
    const timing = CUE_TIMING.exec(all[index]);
    if (!timing) {
      index += 1;
      continue;
    }
    const body: string[] = [];
    index += 1;
    while (index < all.length && !CUE_TIMING.test(all[index])) {
      if (all[index].trim() === "") {
        if (!options.acrossBlankLines) break;
      } else {
        body.push(all[index]);
      }
      index += 1;
    }
    // An SRT or VTT cue id line directly before the next timing is not text.
    if (body.length > 0 && /^\d+$/.test(body[body.length - 1].trim()) && CUE_TIMING.test(all[index] ?? "")) {
      body.pop();
    }
    if (body.length === 0) continue;
    blocks.push({ startMs: timestampToMs(timing[1]), body });
  }
  return blocks;
}

type CueRead = {
  startMs?: number;
  speaker?: string;
  text: string;
  /** A weak name the cue may open with, and its text if it does (parser v8). */
  weak?: { speaker: string; kind: WeakLabelKind; text: string };
};

/** One cue as v7 reads it, plus a weak name candidate when v7 names no one. */
function readCue(block: CueBlock): CueRead {
  const { body } = block;
  let speaker: string | undefined;
  let first = body[0].trim();
  const voice = /^<v(?:\.[^\s>]+)*\s+([^>]{1,80})>/.exec(first);
  if (voice) {
    speaker = voice[1].trim();
    first = first.slice(voice[0].length);
  } else if (body.length >= 2 && speakerFromLabel(first) && !first.includes(":")) {
    // Teams .docx cue: the speaker's name on its own line above the text.
    speaker = speakerFromLabel(first);
    first = "";
  } else {
    const colon = /^(.{1,60}?)\s*:\s+(?=\S)/.exec(cueText(first));
    const named = colon ? speakerFromLabel(colon[1]) : undefined;
    if (colon && named) {
      speaker = named;
      first = cueText(first).slice(colon[0].length);
    }
  }
  const text = cueText([first, ...body.slice(1)].join(" "));
  if (speaker !== undefined) return { startMs: block.startMs, speaker, text };
  // Parser v8 candidates: a caseless name alone above the text, or a weak
  // label before a colon.
  const rest = body.slice(1);
  if (rest.length > 0 && !/[:\uFF1A]/.test(first)) {
    const read = weakSpeakerFromLabel(first, CASELESS_ONLY);
    if (read) return { startMs: block.startMs, text, weak: { speaker: read.speaker, kind: read.weak, text: cueText(rest.join(" ")) } };
  }
  const flat = cueText(first);
  const colon = /^(.{1,60}?)\s*:\s+(?=\S)/.exec(flat) ?? CASELESS_COLON_LABEL.exec(flat);
  const read = colon ? weakSpeakerFromLabel(colon[1], /:\s/.test(colon[0]) ? ALL_WEAK : CASELESS_ONLY) : undefined;
  if (colon && read) {
    const weakText = cueText([flat.slice(colon[0].length), ...rest].join(" "));
    return { startMs: block.startMs, text, weak: { speaker: read.speaker, kind: read.weak, text: weakText } };
  }
  return { startMs: block.startMs, text };
}

// ─── Evidence for weak labels (parser v8) ──────────────────────────────────

/** A line or cue that opens a turn under v7 (`weak` absent), or a weak candidate. */
type WeakOpener = { at: number; speaker: string; weak?: WeakLabelKind; form: string };

/**
 * Which weak candidates become speakers, and under which label. Privacy
 * must not reshape transcripts, so a weak label opens turns only on strong
 * evidence (lead decision, review of 2026-09-26):
 * - an email label always does;
 * - a label that is a v7 speaker's label in another case ("priya shah" for
 *   Priya Shah) does, as that speaker;
 * - otherwise the label must hold a real exchange: at least two of its
 *   turns sit between turns of one other speaker (X, L, X), that speaker is
 *   a v7 speaker or a candidate that passes too, and a run of the label's
 *   own lines counts once. A candidate seen once is ignored as a neighbour.
 *   Beside v7 speakers, a lowercase label never qualifies, and a caseless
 *   one must be written in the same form as a v7 label (both headers, both
 *   inline with a time before, and so on).
 * Returns each promoted opener's `at` and the speaker it opens a turn for.
 */
function promoteWeakOpeners(openers: readonly WeakOpener[]): Map<number, string> {
  const promoted = new Map<number, string>();
  if (!openers.some((opener) => opener.weak !== undefined)) return promoted;
  const strong = openers.filter((opener) => opener.weak === undefined);
  const byLower = new Map<string, string>();
  for (const opener of strong) {
    const key = opener.speaker.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, opener.speaker);
  }
  const strongForms = new Set(strong.map((opener) => opener.form));
  const candidates = new Set<WeakOpener>();
  for (const opener of openers) {
    if (opener.weak === undefined) continue;
    if (opener.weak === "email") {
      promoted.set(opener.at, opener.speaker);
      continue;
    }
    const same = byLower.get(opener.speaker.toLowerCase());
    if (same !== undefined) {
      promoted.set(opener.at, same);
      continue;
    }
    if (strong.length > 0 && (opener.weak === "lower" || !strongForms.has(opener.form))) continue;
    candidates.add(opener);
  }
  if (candidates.size === 0) return promoted;

  const collapse = (list: readonly { speaker: string; at: number }[]) => {
    const runs: Array<{ speaker: string; ats: number[] }> = [];
    for (const item of list) {
      const last = runs[runs.length - 1];
      if (last && last.speaker === item.speaker) last.ats.push(item.at);
      else runs.push({ speaker: item.speaker, ats: [item.at] });
    }
    return runs;
  };
  const speakerOf = (opener: WeakOpener) => promoted.get(opener.at) ?? opener.speaker;
  const firstPass = collapse(
    openers.filter((opener) => opener.weak === undefined || promoted.has(opener.at) || candidates.has(opener)).map((opener) => ({ speaker: speakerOf(opener), at: opener.at }))
  );
  const candidateNames = new Set([...candidates].map((opener) => opener.speaker));
  const runCount = new Map<string, number>();
  for (const run of firstPass) {
    if (candidateNames.has(run.speaker)) runCount.set(run.speaker, (runCount.get(run.speaker) ?? 0) + 1);
  }
  // A candidate seen in one run only can never pass; its lines read as text.
  const sequence = collapse(
    openers
      .filter(
        (opener) =>
          opener.weak === undefined ||
          promoted.has(opener.at) ||
          (candidates.has(opener) && (runCount.get(opener.speaker) ?? 0) >= 2)
      )
      .map((opener) => ({ speaker: speakerOf(opener), at: opener.at }))
  );
  const fixed = new Set([...strong.map((opener) => opener.speaker), ...promoted.values()]);
  let accepted = new Set([...runCount].filter(([, count]) => count >= 2).map(([name]) => name));
  for (;;) {
    const next = new Set<string>();
    for (const name of accepted) {
      let alternating = 0;
      sequence.forEach((run, index) => {
        if (run.speaker !== name) return;
        const neighbours = [sequence[index - 1]?.speaker, sequence[index + 1]?.speaker].filter(
          (speaker): speaker is string => speaker !== undefined
        );
        if (neighbours.length === 0 || new Set(neighbours).size !== 1) return;
        const partner = neighbours[0];
        if (partner !== name && (fixed.has(partner) || accepted.has(partner))) alternating += 1;
      });
      if (alternating >= 2) next.add(name);
    }
    if (next.size === accepted.size) break;
    accepted = next;
  }
  for (const opener of candidates) {
    if (accepted.has(opener.speaker)) promoted.set(opener.at, opener.speaker);
  }
  return promoted;
}

/**
 * Cues as one canonical verbatim text: `Name [hh:mm:ss]: text`, one turn per
 * paragraph, with consecutive cues of the same speaker joined into one turn.
 */
export function renderCuesCanonical(cues: readonly Cue[]): string {
  const turns: Cue[] = [];
  for (const cue of cues) {
    const last = turns[turns.length - 1];
    if (last && cue.speaker !== undefined && last.speaker === cue.speaker) {
      last.text = `${last.text} ${cue.text}`;
      continue;
    }
    turns.push({ ...cue });
  }
  return turns
    .map((turn) => {
      const time = turn.startMs === undefined ? "" : `[${formatTimestamp(turn.startMs)}]`;
      if (turn.speaker) return `${turn.speaker}${time ? ` ${time}` : ""}: ${turn.text}`;
      return time ? `${time} ${turn.text}` : turn.text;
    })
    .join("\n\n");
}

/** A paragraph of the canonical cue render: `Name [hh:mm:ss]: text` or `[hh:mm:ss] text`. */
const CANONICAL_CUE_PARAGRAPH = /^(?:\[\d{2}:\d{2}:\d{2}\] \S|[^\n]{1,100}? \[\d{2}:\d{2}:\d{2}\]: \S)/;

/**
 * Whether stored text is a cue render (`renderCuesCanonical`): a VTT or SRT
 * file, or a Teams .docx that kept its cue timings, whose every paragraph
 * opens with its cue's time. Only there does a line opening with a
 * bracketed time and no name mark a cue nobody was named for; in any other
 * transcript it marks a time inside the speech (`parseTranscriptTurns`).
 */
export function isCueRender(format: TranscriptSourceFormat | undefined, content: string): boolean {
  if (format === "vtt" || format === "srt") return true;
  if (format !== "teams_docx") return false;
  const paragraphs = content.split(/\n{2,}/).filter((paragraph) => paragraph.trim() !== "");
  return paragraphs.length > 0 && paragraphs.every((paragraph) => CANONICAL_CUE_PARAGRAPH.test(paragraph));
}

/**
 * The verbatim text stored for an upload. VTT, SRT and cue-timed Teams
 * exports are rendered to the canonical form; every other format is kept
 * as extracted, with line endings normalized to `\n` and outer blank space
 * trimmed.
 */
export function normalizeTranscriptText(format: TranscriptSourceFormat, text: string): string {
  const unified = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const teamsCues =
    format === "teams_docx" && countMatching(lines(unified), (line) => CUE_TIMING.test(line)) >= 2;
  if (format === "vtt" || format === "srt" || teamsCues) {
    const rendered = renderCuesCanonical(parseCues(unified, { acrossBlankLines: teamsCues }));
    if (rendered.trim() !== "") return rendered;
  }
  return unified.replace(/[ \t]+$/gm, "").trim();
}

/** Detect, then normalize: what the browser uploads for one transcript. */
export function prepareTranscriptUpload(args: {
  fileName?: string;
  text: string;
  intake?: "file" | "paste";
}): { format: TranscriptSourceFormat; content: string } {
  const format = detectTranscriptFormat(args);
  return { format, content: normalizeTranscriptText(format, args.text) };
}

// ─── Turns ─────────────────────────────────────────────────────────────────

export type TranscriptTurn = {
  index: number;
  /** Normalized speaker label; absent when the text names no one. */
  speakerLabel?: string;
  /** The label as written, kept for role hints ("Interviewer (Dana)"). */
  rawLabel?: string;
  startMs?: number;
  endMs?: number;
  /** Offset of the first spoken character in `content`. */
  charStart: number;
  /** Offset after the last spoken character in `content`. */
  charEnd: number;
  /** Speech without timestamps, fillers or stutters; the model's view. */
  cleanText: string;
};

const FILLER = /(?<![\p{L}\p{N}'])(?:um+|uh+|erm+|er|ah+|hmm+|mm+-?hmm+|uh-?huh)(?![\p{L}\p{N}'])[,.]?/giu;

/**
 * The model's view of one turn's speech: inline timestamps, fillers and
 * immediately repeated words dropped, whitespace collapsed. Verbatim text is
 * never replaced by this; offsets always index the stored content.
 */
export function cleanTurnText(speech: string): string {
  let text = speech
    .replace(new RegExp(String.raw`(^|\s)${TIMESTAMP}(?=\s|$)`, "g"), "$1")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "the the", "we we": a stutter, not content.
  text = text.replace(/\b([\p{L}\p{N}']+)(?:\s+\1\b)+/giu, "$1");
  return text.replace(/\s+([,.;:!?])/g, "$1").replace(/^[,.;:]\s*/, "").trim();
}

type LineInfo = { start: number; end: number; text: string };

function lineInfos(content: string): LineInfo[] {
  const out: LineInfo[] = [];
  let start = 0;
  for (;;) {
    const newline = content.indexOf("\n", start);
    const end = newline === -1 ? content.length : newline;
    const raw = content.slice(start, end);
    const trimmedEnd = raw.endsWith("\r") ? end - 1 : end;
    out.push({ start, end: trimmedEnd, text: content.slice(start, trimmedEnd) });
    if (newline === -1) break;
    start = newline + 1;
  }
  return out;
}

type Draft = {
  speakerLabel?: string;
  rawLabel?: string;
  startMs?: number;
  /** [start, end) spans of speech inside content. */
  spans: Array<[number, number]>;
};

function trimmedSpan(content: string, start: number, end: number): [number, number] | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(content[s])) s += 1;
  while (e > s && /\s/.test(content[e - 1])) e -= 1;
  return e > s ? [s, e] : null;
}

/** Where to end a piece of speech that runs past MAX_TURN_CHARS from `from`. */
function cutPoint(content: string, from: number): number {
  const limit = from + MAX_TURN_CHARS;
  for (let at = limit; at > from + MAX_TURN_CHARS / 2; at -= 1) {
    if (/\s/.test(content[at - 1])) return at;
  }
  // No whitespace in the second half: cut there, never inside a surrogate pair.
  const code = content.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

/**
 * A turn longer than MAX_TURN_CHARS as consecutive turns of the same
 * speaker, cut at whitespace. Only the first keeps the start time.
 */
function splitLongDraft(content: string, draft: Draft): Draft[] {
  const first = draft.spans[0][0];
  const last = draft.spans[draft.spans.length - 1][1];
  if (last - first <= MAX_TURN_CHARS) return [draft];
  const pieces: Array<[number, number]> = [];
  for (const [start, end] of draft.spans) {
    let from = start;
    while (end - from > MAX_TURN_CHARS) {
      const cut = cutPoint(content, from);
      const piece = trimmedSpan(content, from, cut);
      if (piece) pieces.push(piece);
      from = cut;
    }
    const rest = trimmedSpan(content, from, end);
    if (rest) pieces.push(rest);
  }
  const out: Draft[] = [];
  let chunk: Draft = { ...draft, spans: [] };
  for (const piece of pieces) {
    if (chunk.spans.length > 0 && piece[1] - chunk.spans[0][0] > MAX_TURN_CHARS) {
      out.push(chunk);
      chunk = { speakerLabel: draft.speakerLabel, rawLabel: draft.rawLabel, spans: [] };
    }
    chunk.spans.push(piece);
  }
  out.push(chunk);
  return out;
}

/**
 * Splits verbatim transcript text into speaker turns. A turn opens on a
 * labelled line ("Name: text", `<v Name>`), or on a header line holding a
 * name and a time with the speech below it; unlabelled lines continue the
 * turn above them. Text before the first label, and every paragraph of a
 * transcript that names no one, becomes its own turn with no speaker. A
 * turn longer than MAX_TURN_CHARS continues as further turns of the same
 * speaker.
 *
 * A line opening with a bracketed time and no name depends on `cues`
 * (`isCueRender`). In a cue render it is a cue nobody was named for: its
 * own turn with that time and no speaker, never folded into the speaker
 * above. Anywhere else it is speech with a time on it, read like any other
 * line: it continues a named turn, and a turn it opens starts at that time.
 */
export function parseTranscriptTurns(
  content: string,
  options: { cues?: boolean } = {}
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = speakerDrafts(content, options)
    .flatMap((draft) => splitLongDraft(content, draft))
    .map((draft, index) => {
      const charStart = draft.spans[0][0];
      const charEnd = draft.spans[draft.spans.length - 1][1];
      const speech = draft.spans.map(([s, e]) => content.slice(s, e)).join(" ");
      return {
        index,
        ...(draft.speakerLabel !== undefined ? { speakerLabel: draft.speakerLabel } : {}),
        ...(draft.rawLabel !== undefined ? { rawLabel: draft.rawLabel } : {}),
        ...(draft.startMs !== undefined ? { startMs: draft.startMs } : {}),
        charStart,
        charEnd,
        cleanText: cleanTurnText(speech),
      };
    });
  for (let i = 0; i < turns.length - 1; i += 1) {
    const next = turns[i + 1].startMs;
    if (turns[i].startMs !== undefined && next !== undefined && next >= turns[i].startMs!) {
      turns[i].endMs = next;
    }
  }
  return turns;
}

/** A transcript's analysis, kept for citation places (`speakersAtOffsets`). */
type PlaceAnalysis = {
  lineStarts: number[];
  /** Each line's own speaker when it opens a turn (inline or header, v8 rules). */
  lineSpeakers: Array<string | undefined>;
  turns: Array<{ charStart: number; speakerLabel?: string }>;
};

/**
 * Analyses of recent transcripts, most recent last. A mutation that places
 * citations on several transcripts in turn (copying a Brief to the reading
 * facts, say) parses each one once, not once per citation (review
 * 2026-09-26, P3).
 */
const placeCache = new Map<string, PlaceAnalysis>();
const PLACE_CACHE_SIZE = 8;

function placeAnalysis(content: string): PlaceAnalysis {
  const cached = placeCache.get(content);
  if (cached) {
    placeCache.delete(content);
    placeCache.set(content, cached);
    return cached;
  }
  const lines = analyzeLines(content);
  // A cue render (VTT, SRT, a Teams cue document) keeps its unnamed cues
  // as turns of no one, as the turn build reads it.
  const cues = isCueRender("teams_docx", content);
  const turns = draftsFrom(content, lines, { cues }).map((draft) => ({
    charStart: draft.spans[0][0],
    ...(draft.speakerLabel !== undefined ? { speakerLabel: draft.speakerLabel } : {}),
  }));
  const analysis: PlaceAnalysis = {
    lineStarts: lines.infos.map((info) => info.start),
    lineSpeakers: lines.kinds.map((kind) =>
      kind?.kind === "inline" || kind?.kind === "header" ? kind.speaker : undefined
    ),
    turns,
  };
  placeCache.set(content, analysis);
  if (placeCache.size > PLACE_CACHE_SIZE) placeCache.delete(placeCache.keys().next().value!);
  return analysis;
}

function lastAtOrBefore(values: readonly number[], offset: number): number {
  let low = 0;
  let high = values.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= offset) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * The speaker whose turn holds each offset, from the same analysis as the
 * turn build (review 2026-09-26, P2-5): a citation's place reads the turns,
 * never a line on its own, so a weak label that opens no turn never names
 * a citation's speaker. An offset on a line that opens a turn (a label
 * line, or a header line whose speech starts below it) is that line's
 * speaker's; an unnamed cue of a cue render is no one's.
 */
export function speakersAtOffsets(content: string, offsets: readonly number[]): Array<string | undefined> {
  const analysis = placeAnalysis(content);
  const turnStarts = analysis.turns.map((turn) => turn.charStart);
  return offsets.map((offset) => {
    const line = lastAtOrBefore(analysis.lineStarts, offset);
    const own = line === -1 ? undefined : analysis.lineSpeakers[line];
    if (own !== undefined) return own;
    const turn = lastAtOrBefore(turnStarts, offset);
    return turn === -1 ? undefined : analysis.turns[turn].speakerLabel;
  });
}

export type TranscriptSpeakerNames = {
  /** Every speaker label a turn gets, in order of first appearance. */
  labels: string[];
  /**
   * Other forms of speakers' names the text holds: a label as written when
   * it differs from the turn's label ("Shah, Priya"), and a label on a line
   * the transcript-wide rules did not count as a speaker.
   */
  otherNames: string[];
  /** Organizations named in labels' brackets ("Acme" in "Priya Shah (Acme)"). */
  organizations: string[];
  /**
   * Weak labels (parser v8) the transcript-wide rules set aside: hidden as
   * written only, never word by word, since a lowercase phrase seen once
   * may be ordinary words. Absent when there are none.
   */
  looseLabels?: string[];
};

/**
 * The names a transcript's speaker labels hold, from the same parse as
 * `parseTranscriptTurns`, so `labels` is exactly the set of the turns'
 * labels, which the stored speaker rows hold once the turn build has run.
 * Owner decision 26 hides all of them, so a draft started before that build
 * finishes still sends no speaker's name.
 */
export function transcriptSpeakerNames(content: string, options: { cues?: boolean } = {}): TranscriptSpeakerNames {
  const lines = analyzeLines(content);
  const labels = new Set<string>();
  // A draft holds at least one non-empty span, so it gives at least one turn.
  for (const draft of draftsFrom(content, lines, options)) {
    if (draft.speakerLabel !== undefined) labels.add(draft.speakerLabel);
  }
  const otherNames = new Set<string>();
  const organizations = new Set<string>();
  const add = (set: Set<string>, value: string | undefined) => {
    if (value !== undefined && !labels.has(value)) set.add(value);
  };
  // Parser v9: a metadata heading's label ("Project") names no one.
  const ownReads = lines.lineKinds.filter((_, at) => !lines.headings.has(at));
  for (const kind of [...ownReads, ...lines.kinds]) {
    if (kind?.kind !== "inline" && kind?.kind !== "header") continue;
    add(otherNames, kind.speaker);
    add(otherNames, writtenLastFirst(kind.rawLabel));
    const bracketed = labelBracketNames(kind.rawLabel);
    for (const name of bracketed.people) add(otherNames, name);
    for (const name of bracketed.organizations) add(organizations, name);
  }
  for (const name of lines.paneNames) add(otherNames, name);
  // Parser v8. A promoted weak label is a speaker: its label as written
  // ("priya shah" for Priya Shah) and the lowercase or caseless names in
  // its brackets are hidden like any speaker's. A candidate that stayed
  // text is a loose label: hidden only where it stands as a label.
  const looseLabels = new Set<string>();
  lines.weakLines.forEach((weak, at) => {
    if (!weak) return;
    if (lines.promoted.has(at)) {
      add(otherNames, weak.speaker);
      const bracketed = weakBracketNames(weak.rawLabel);
      for (const name of bracketed.people) add(otherNames, name);
      for (const name of bracketed.organizations) add(organizations, name);
      return;
    }
    looseLabels.add(weak.speaker);
    const written = weak.rawLabel.replace(CANONICAL_LABEL_TIME, "").trim();
    if (written !== weak.speaker) looseLabels.add(written);
  });
  for (const name of [...labels, ...otherNames]) looseLabels.delete(name);
  return {
    labels: [...labels],
    otherNames: [...otherNames],
    organizations: [...organizations],
    ...(looseLabels.size > 0 ? { looseLabels: [...looseLabels] } : {}),
  };
}

/**
 * Names in the brackets of a weak label that became a speaker ("dana
 * (acme)", parser v8): two or more words are a person, one is an
 * organization, as `labelBracketNames` reads capitalized ones. Pronouns,
 * roles, times and titles are not names.
 */
function weakBracketNames(rawLabel: string): { people: string[]; organizations: string[] } {
  const none = { people: [], organizations: [] };
  const parts = bracketParts(rawLabel.replace(CANONICAL_LABEL_TIME, ""));
  if (!parts || ROLE_LABEL.test(parts.outer)) return none;
  const people: string[] = [];
  const organizations: string[] = [];
  for (const segment of parts.inner.split(",")) {
    const piece = segment.trim();
    if (!piece || piece.includes("/") || ROLE_LABEL.test(piece) || isTitle(piece) || /\p{N}/u.test(piece)) continue;
    const words = piece.split(/\s+/);
    if (!words.every((word) => /^[\p{L}\p{M}'’.&-]+$/u.test(word)) || words.some((word) => isCommonLowercaseWord(word))) continue;
    if (words.length >= 2 && !ORG_WORDS.has(lastWord(piece))) people.push(piece);
    else organizations.push(piece);
  }
  return { people, organizations };
}

/** A "Shah, Priya" label as written, before it is read as "Priya Shah". */
function writtenLastFirst(rawLabel: string): string | undefined {
  let label = rawLabel.trim().replace(TRAILING_TIMESTAMP, "");
  const paren = /^(.+?)\s*[(\[]([^()[\]]{1,80})[)\]]$/.exec(label);
  if (paren) label = paren[1].trim();
  return lastFirstName(label) !== undefined ? label : undefined;
}

/** A time line a Teams-pane header took over (`markPaneHeaders`). */
type LineKind = SpeakerLine | { kind: "consumed" } | undefined;

/**
 * A line holding only a speaker's name ("Priya Shah", "Shah, Priya"), as
 * the Teams transcript pane puts above each turn's time.
 */
function bareNameLine(text: string): string | undefined {
  const line = text.trim();
  if (line.includes(":") || NOT_A_NAME.has(line.toLowerCase())) return undefined;
  return speakerFromLabel(line);
}

/**
 * Text copied from the Teams transcript pane: the speaker's name on one
 * line, the time on the next, then the speech. A name line becomes a header
 * with that time only when the next line is a time and the line after it is
 * speech, and only when the transcript holds at least two such headers.
 * Returns the names of the headers it found too few of, for hiding only.
 */
function markPaneHeaders(infos: readonly LineInfo[], kinds: LineKind[]): string[] {
  const next = (from: number) => {
    let at = from;
    while (at < infos.length && infos[at].text.trim() === "") at += 1;
    return at;
  };
  const found: Array<{ name: number; time: number; speaker: string }> = [];
  for (let i = 0; i < infos.length; i += 1) {
    if (kinds[i] !== undefined) continue;
    const speaker = bareNameLine(infos[i].text);
    if (!speaker) continue;
    const time = next(i + 1);
    if (kinds[time]?.kind !== "timestamp") continue;
    const speech = next(time + 1);
    if (speech >= infos.length) continue;
    const after = kinds[speech];
    if (after !== undefined && after.kind !== "timed") continue;
    found.push({ name: i, time, speaker });
  }
  if (found.length < 2) return found.map((header) => header.speaker);
  for (const header of found) {
    const time = kinds[header.time];
    kinds[header.name] = {
      kind: "header",
      speaker: header.speaker,
      rawLabel: infos[header.name].text.trim(),
      ...(time?.kind === "timestamp" && time.timeMs !== undefined ? { timeMs: time.timeMs } : {}),
    };
    kinds[header.time] = { kind: "consumed" };
  }
  return [];
}

/**
 * Plain "Name:" labels count only when the transcript shows a speaker
 * pattern (parser v4): a header or a timed or voiced label, a label that
 * recurs, a text that opens with its label, or an exchange between at
 * least two speakers that is not buried in prose (no more text before the
 * first label than labelled lines). Otherwise a lone "Lessons Learned: ..."
 * in notes would take over every paragraph after it; those lines stay
 * plain text.
 */
function dropUnpatternedLabels(infos: readonly LineInfo[], kinds: LineKind[]): void {
  const counts = new Map<string, number>();
  let strong = false;
  let labelled = 0;
  let textBeforeFirstLabel = 0;
  for (let i = 0; i < infos.length; i += 1) {
    const kind = kinds[i];
    if (infos[i].text.trim() === "" || kind?.kind === "consumed" || kind?.kind === "timestamp") continue;
    if (kind?.kind === "inline" || kind?.kind === "header") {
      counts.set(kind.speaker, (counts.get(kind.speaker) ?? 0) + 1);
      labelled += 1;
      if (!isPlainLabel(infos[i].text, kind)) strong = true;
    } else if (labelled === 0) {
      textBeforeFirstLabel += 1;
    }
  }
  if (strong || [...counts.values()].some((count) => count >= 2)) return;
  if (textBeforeFirstLabel === 0 || (counts.size >= 2 && labelled >= textBeforeFirstLabel)) return;
  for (let i = 0; i < infos.length; i += 1) {
    const kind = kinds[i];
    if (kind?.kind === "inline" && isPlainLabel(infos[i].text, kind)) kinds[i] = undefined;
  }
}

/** The metadata heading word a label opens or ends with ("Project", "Project name"). */
function metadataWord(label: string): string | undefined {
  const words = label.toLowerCase().split(/\s+/);
  if (words.length > 3) return undefined;
  if (METADATA_HEADINGS.has(words[0])) return words[0];
  return METADATA_HEADINGS.has(words[words.length - 1]) ? words[words.length - 1] : undefined;
}

/** Speech, not a heading's value: it ends like a sentence, and not in "Acme Inc.". */
function isSentence(value: string): boolean {
  return /[.?!]["')\]]*$/.test(value) && !/\b(?:co|corp|inc|llc|ltd|plc)\.$/i.test(value);
}

/**
 * Parser v9: the metadata lines above a transcript's exchange ("Project:
 * Low-temperature bonding", "Client: Northwind Test Labs") are headings, so
 * they stay text. A line is one when its label holds a metadata word, labels
 * no other line, and comes before every other speaker's first line with at
 * least one speaker after it; a role word ("Client") also needs a value
 * that is not a sentence, since "Client: We tried that." is speech. Returns
 * the lines set aside, whose labels are not hidden as names either.
 */
function dropMetadataHeadings(infos: readonly LineInfo[], kinds: LineKind[]): Set<number> {
  const counts = new Map<string, number>();
  for (const kind of kinds) {
    if (kind?.kind === "inline" || kind?.kind === "header") counts.set(kind.speaker, (counts.get(kind.speaker) ?? 0) + 1);
  }
  const candidates: number[] = [];
  for (let at = 0; at < kinds.length; at += 1) {
    const kind = kinds[at];
    if (kind?.kind !== "inline" && kind?.kind !== "header") continue;
    const word = kind.kind === "inline" && counts.get(kind.speaker) === 1 ? metadataWord(kind.speaker) : undefined;
    const value = kind.kind === "inline" ? infos[at].text.slice(kind.speechOffset).trim() : "";
    if (!word || (METADATA_ROLES.has(word) && isSentence(value))) {
      // The exchange starts here: the lines above it that qualified are headings.
      for (const heading of candidates) kinds[heading] = undefined;
      return new Set(candidates);
    }
    candidates.push(at);
  }
  return new Set();
}

/**
 * "Dana (Verdant Grid)" and "Sam (Verdant Grid)": a bracketed name that
 * follows several one-word names, each always with that same name, is the
 * company they share, so each word before it is the speaker. One line alone
 * cannot tell this from "Acme (Priya Shah)" (`companyThenName`), so this
 * reads the whole transcript (parser v5).
 */
function resolveBracketSpeakers(kinds: LineKind[]): void {
  const outersOf = new Map<string, Set<string>>();
  const innersOf = new Map<string, Set<string>>();
  const pairs: Array<{ at: number; outer: string; inner: string }> = [];
  kinds.forEach((kind, at) => {
    if (kind?.kind !== "inline" && kind?.kind !== "header") return;
    const parts = bracketParts(kind.rawLabel);
    if (!parts || !companyThenName(parts)) return;
    pairs.push({ at, ...parts });
    outersOf.set(parts.inner, (outersOf.get(parts.inner) ?? new Set()).add(parts.outer));
    innersOf.set(parts.outer, (innersOf.get(parts.outer) ?? new Set()).add(parts.inner));
  });
  for (const pair of pairs) {
    if ((outersOf.get(pair.inner)?.size ?? 0) < 2 || (innersOf.get(pair.outer)?.size ?? 0) !== 1) continue;
    const kind = kinds[pair.at] as Extract<SpeakerLine, { speaker: string }>;
    kinds[pair.at] = { ...kind, speaker: pair.outer };
  }
}

/** An untimed "Name: speech" line: the weakest sign of a speaker. */
function isPlainLabel(text: string, kind: SpeakerLine): boolean {
  return kind.kind === "inline" && kind.timeMs === undefined && !VTT_VOICE.test(text.trim());
}

type AnalyzedLines = {
  infos: LineInfo[];
  /** How each line opens a turn, on its own (`splitSpeakerLine`, v7). */
  lineKinds: readonly LineKind[];
  /** The same after the transcript-wide rules: what the turns follow. */
  kinds: LineKind[];
  /** Names on lines above a time that were too few to count as headers. */
  paneNames: string[];
  /** Parser v8: each line's weak label candidate (`weakSpeakerLine`, pane names). */
  weakLines: ReadonlyArray<WeakCandidate | undefined>;
  /** Lines whose weak label became a speaker, with the speaker's label. */
  promoted: ReadonlyMap<number, string>;
  /** Parser v9: lines that open with a metadata heading, read as text. */
  headings: ReadonlySet<number>;
};

type WeakCandidate = WeakSpeakerLine & {
  /** A caseless name above a pane time line: the time line it takes. */
  paneTime?: number;
};

function analyzeLines(content: string): AnalyzedLines {
  const infos = lineInfos(content);
  const lineKinds: LineKind[] = infos.map((info) => splitSpeakerLine(info.text));
  const kinds = [...lineKinds];
  const paneNames = markPaneHeaders(infos, kinds);
  resolveBracketSpeakers(kinds);
  dropUnpatternedLabels(infos, kinds);
  // Parser v9, after the v4 pattern rule, which still counts a heading's
  // label towards an exchange as v8 did.
  const headings = dropMetadataHeadings(infos, kinds);
  // Parser v8: every rule above reads the transcript exactly as v7 did.
  // Weak labels are candidates on lines v7 leaves as text, and open turns
  // only on the evidence `promoteWeakOpeners` asks for.
  const weakLines: Array<WeakCandidate | undefined> = infos.map((info, i) => {
    const kind = kinds[i];
    if (headings.has(i) || (kind !== undefined && kind.kind !== "timed")) return undefined;
    return weakSpeakerLine(info.text) ?? weakPaneName(infos, kinds, i);
  });
  const openers: WeakOpener[] = [];
  kinds.forEach((kind, at) => {
    if (kind?.kind === "inline" || kind?.kind === "header") {
      openers.push({ at, speaker: kind.speaker, form: v7Form(infos[at].text, kind) });
    } else if (weakLines[at]) {
      openers.push({ at, speaker: weakLines[at]!.speaker, weak: weakLines[at]!.weak, form: weakLines[at]!.form });
    }
  });
  const promoted = promoteWeakOpeners(openers);
  for (const [at, speaker] of promoted) {
    const weak = weakLines[at]!;
    if (weak.kind === "inline") {
      kinds[at] = {
        kind: "inline",
        speaker,
        rawLabel: weak.rawLabel,
        speechOffset: weak.speechOffset,
        ...(weak.timeMs !== undefined ? { timeMs: weak.timeMs } : {}),
      };
    } else {
      kinds[at] = {
        kind: "header",
        speaker,
        rawLabel: weak.rawLabel,
        ...(weak.timeMs !== undefined ? { timeMs: weak.timeMs } : {}),
      };
      if (weak.paneTime !== undefined) kinds[weak.paneTime] = { kind: "consumed" };
    }
  }
  return { infos, lineKinds, kinds, paneNames, weakLines, promoted, headings };
}

/**
 * A caseless name alone on a line above a time line and speech, as the
 * Teams transcript pane writes it ("李伟", "0:03", speech): a weak header
 * candidate with the time line it would take (parser v8).
 */
function weakPaneName(infos: readonly LineInfo[], kinds: readonly LineKind[], at: number): WeakCandidate | undefined {
  const line = infos[at].text.trim();
  if (!line || /[:\uFF1A]/.test(line) || kinds[at] !== undefined) return undefined;
  const read = weakSpeakerFromLabel(line, CASELESS_ONLY);
  if (!read) return undefined;
  const next = (from: number) => {
    let index = from;
    while (index < infos.length && infos[index].text.trim() === "") index += 1;
    return index;
  };
  const time = next(at + 1);
  const timeKind = kinds[time];
  if (timeKind?.kind !== "timestamp") return undefined;
  const speech = next(time + 1);
  if (speech >= infos.length) return undefined;
  const after = kinds[speech];
  if (after !== undefined && after.kind !== "timed") return undefined;
  return {
    kind: "header",
    speaker: read.speaker,
    rawLabel: line,
    ...(timeKind.timeMs !== undefined ? { timeMs: timeKind.timeMs } : {}),
    weak: read.weak,
    form: "header",
    paneTime: time,
  };
}

/** Speaker turns before long ones are split: each holds at least one span. */
function speakerDrafts(content: string, options: { cues?: boolean }): Draft[] {
  return draftsFrom(content, analyzeLines(content), options);
}

function draftsFrom(content: string, lines: AnalyzedLines, options: { cues?: boolean }): Draft[] {
  const { infos, kinds } = lines;
  const hasSpeakers = kinds.some((kind) => kind?.kind === "inline" || kind?.kind === "header");
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  let pendingTime: number | undefined;
  let blankSinceSpeech = false;

  const open = (draft: Draft) => {
    if (current && current.spans.length > 0) drafts.push(current);
    current = draft;
  };

  for (let i = 0; i < infos.length; i += 1) {
    const info = infos[i];
    const kind = kinds[i];
    if (info.text.trim() === "") {
      blankSinceSpeech = true;
      continue;
    }
    if (kind?.kind === "consumed") continue;
    if (kind?.kind === "timestamp") {
      pendingTime = kind.timeMs;
      continue;
    }
    if (kind?.kind === "inline") {
      open({
        speakerLabel: kind.speaker,
        rawLabel: kind.rawLabel,
        startMs: kind.timeMs ?? pendingTime,
        spans: [],
      });
      pendingTime = undefined;
      const span = trimmedSpan(content, info.start + kind.speechOffset, info.end);
      if (span) current!.spans.push(span);
      blankSinceSpeech = false;
      continue;
    }
    if (kind?.kind === "header") {
      open({
        speakerLabel: kind.speaker,
        rawLabel: kind.rawLabel,
        startMs: kind.timeMs ?? pendingTime,
        spans: [],
      });
      pendingTime = undefined;
      blankSinceSpeech = false;
      continue;
    }
    if (kind?.kind === "timed" && options.cues) {
      // A cue that named no one: its own turn, with its time, never folded
      // into the speaker above it.
      open({ startMs: kind.timeMs ?? pendingTime, spans: [] });
      pendingTime = undefined;
      const span = trimmedSpan(content, info.start + kind.speechOffset, info.end);
      if (span) current!.spans.push(span);
      blankSinceSpeech = false;
      continue;
    }
    // Outside a cue render a bracketed time is part of the line.
    const lineTime = kind?.kind === "timed" ? kind.timeMs : undefined;
    const span = trimmedSpan(content, info.start, info.end);
    if (!span) continue;
    const unlabelled = !current || current.speakerLabel === undefined;
    // Without any speaker labels, or before the first one, a paragraph is a
    // turn of its own; inside a labelled turn, text continues it.
    if (!hasSpeakers || unlabelled) {
      if (!current || current.speakerLabel !== undefined || blankSinceSpeech) {
        open({ spans: [], startMs: lineTime ?? pendingTime });
        pendingTime = undefined;
      }
    }
    current!.spans.push(span);
    blankSinceSpeech = false;
  }
  if (current && current.spans.length > 0) drafts.push(current);
  return drafts;
}
