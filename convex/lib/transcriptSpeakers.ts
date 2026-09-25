/**
 * Speaker roles by rule (phase 3, the transcript method). Pure.
 *
 * Owner decision 24: roles warn, never block. These rules place each
 * speaker label as interviewer, client, other or unknown with a confidence;
 * a `structured_helper` call looks only at the labels left below
 * MODEL_ROLE_THRESHOLD, and a consultant confirms in the Speakers popover.
 */
import type { TranscriptTurn } from "../../shared/transcriptParse";
import type { TranscriptSpeakerRole } from "./transcriptValidators";

/** Labels below this confidence (or unknown) are sent to the model. */
export const MODEL_ROLE_THRESHOLD = 0.7;

export type SpeakerRoleGuess = {
  label: string;
  role: TranscriptSpeakerRole;
  confidence: number;
  turnCount: number;
  /** The turn a consultant is shown as the speaker's sample line. */
  sampleTurnIndex?: number;
};

export type SpeakerRoleContext = {
  /** The project's interviewer and every firm staff name (roster). */
  staffNames: readonly string[];
  /** The project's client-side participants. */
  clientNames: readonly string[];
};

const INTERVIEWER_HINT = /\b(interviewer|consultant|host|moderator|banhall)\b/i;
const CLIENT_HINT = /\b(subject|client|interviewee|respondent|guest|participant)\b/i;

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !["dr", "mr", "mrs", "ms", "prof"].includes(token));
}

/**
 * Whether a speaker label names this person: every token of the shorter
 * form appears in the longer ("Dana" and "Dana Whitfield").
 */
export function labelNamesPerson(label: string, name: string): boolean {
  const a = tokens(label);
  const b = tokens(name);
  if (a.length === 0 || b.length === 0) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((token) => long.includes(token));
}

type Stats = {
  label: string;
  rawLabels: string[];
  turns: number;
  questions: number;
  words: number;
  firstIndex: number;
  sampleTurnIndex?: number;
  sampleWords: number;
};

function collectStats(turns: readonly TranscriptTurn[]): Stats[] {
  const byLabel = new Map<string, Stats>();
  for (const turn of turns) {
    if (!turn.speakerLabel) continue;
    let stats = byLabel.get(turn.speakerLabel);
    if (!stats) {
      stats = {
        label: turn.speakerLabel,
        rawLabels: [],
        turns: 0,
        questions: 0,
        words: 0,
        firstIndex: turn.index,
        sampleWords: 0,
      };
      byLabel.set(turn.speakerLabel, stats);
    }
    if (turn.rawLabel && !stats.rawLabels.includes(turn.rawLabel)) stats.rawLabels.push(turn.rawLabel);
    const words = turn.cleanText.split(/\s+/).filter(Boolean).length;
    stats.turns += 1;
    stats.words += words;
    if (/\?\s*$/.test(turn.cleanText)) stats.questions += 1;
    // The sample line: the first turn with at least 8 words, else the longest.
    if (stats.sampleTurnIndex === undefined || (stats.sampleWords < 8 && words > stats.sampleWords)) {
      stats.sampleTurnIndex = turn.index;
      stats.sampleWords = words;
    }
  }
  return [...byLabel.values()].sort((a, b) => a.firstIndex - b.firstIndex);
}

/**
 * Rule-based roles for every speaker label, in order of first appearance.
 * Names on the project record and the roster win; then label hints such as
 * "Interviewer (Dana)"; then, for what is left, question share, talk share
 * and who spoke first.
 */
export function inferSpeakerRoles(
  turns: readonly TranscriptTurn[],
  context: SpeakerRoleContext
): SpeakerRoleGuess[] {
  const stats = collectStats(turns);
  const totalWords = stats.reduce((sum, s) => sum + s.words, 0) || 1;
  const guesses = new Map<string, { role: TranscriptSpeakerRole; confidence: number }>();

  for (const s of stats) {
    const names = [s.label, ...s.rawLabels];
    const staff = context.staffNames.some((name) => names.some((label) => labelNamesPerson(label, name)));
    const client = context.clientNames.some((name) => names.some((label) => labelNamesPerson(label, name)));
    if (staff !== client) {
      guesses.set(s.label, { role: staff ? "interviewer" : "client", confidence: 0.95 });
      continue;
    }
    const interviewerHint = s.rawLabels.some((raw) => INTERVIEWER_HINT.test(raw));
    const clientHint = s.rawLabels.some((raw) => CLIENT_HINT.test(raw));
    if (interviewerHint !== clientHint) {
      guesses.set(s.label, { role: interviewerHint ? "interviewer" : "client", confidence: 0.85 });
    }
  }

  const unplaced = stats.filter((s) => !guesses.has(s.label));
  const placedRoles = [...guesses.values()].map((guess) => guess.role);
  if (unplaced.length > 0) {
    if (stats.length === 2 && unplaced.length === 1) {
      // The other speaker is placed: this one takes the complementary role.
      const other = placedRoles[0];
      guesses.set(unplaced[0].label, {
        role: other === "interviewer" ? "client" : "interviewer",
        confidence: 0.75,
      });
    } else {
      const questionShare = (s: Stats) => (s.turns === 0 ? 0 : s.questions / s.turns);
      const talkShare = (s: Stats) => s.words / totalWords;
      const hasInterviewer = placedRoles.includes("interviewer");
      // The strongest questioner who talks least, if nobody is placed as
      // interviewer yet; ties go to whoever spoke first.
      const ranked = [...unplaced].sort(
        (a, b) =>
          questionShare(b) - talkShare(b) - (questionShare(a) - talkShare(a)) ||
          a.firstIndex - b.firstIndex
      );
      for (const s of ranked) {
        const asker = questionShare(s) >= 0.3 && talkShare(s) < 0.4;
        if (!hasInterviewer && s === ranked[0] && (asker || stats.length === 2)) {
          guesses.set(s.label, { role: "interviewer", confidence: asker ? 0.6 : 0.5 });
          continue;
        }
        guesses.set(s.label, {
          role: talkShare(s) >= 0.1 ? "client" : "unknown",
          confidence: talkShare(s) >= 0.1 ? 0.55 : 0.3,
        });
      }
    }
  }

  return stats.map((s) => {
    const guess = guesses.get(s.label) ?? { role: "unknown" as const, confidence: 0 };
    return {
      label: s.label,
      role: guess.role,
      confidence: guess.confidence,
      turnCount: s.turns,
      ...(s.sampleTurnIndex !== undefined ? { sampleTurnIndex: s.sampleTurnIndex } : {}),
    };
  });
}

/** Whether a rule-based guess still needs the model's look. */
export function needsModelRole(guess: Pick<SpeakerRoleGuess, "role" | "confidence">): boolean {
  return guess.role === "unknown" || guess.confidence < MODEL_ROLE_THRESHOLD;
}
