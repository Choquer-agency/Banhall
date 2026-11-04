/**
 * Owner 2026-10-28 (Paper rows 32 to 37): what the Assistant's suggestion
 * cards share with the rest of the panel and the report.
 *
 * - `ReviewSession`: the one card under review. Nothing shows in the report
 *   until the writer presses Review; the report then marks the words that
 *   change and a review bar floats over it. The page owns the session and
 *   draws the marks and the bar; the cards start, steer and end it.
 * - `AssistantCards`: the panel's Undo bar (the latest accept only) and the
 *   newest inline notice, the Claude-style grey box under the conversation.
 */
import { getContext, setContext } from "svelte";

/**
 * 2026-11-02 (rule overrides): thrown by a card's accept when the person
 * cancels the rule override confirmation. Not a failure: no error is shown.
 */
export class AcceptCancelled extends Error {
  constructor() {
    super("");
    this.name = "AcceptCancelled";
  }
}

export type ReviewPair = { find: string; replaceWith: string };

export type ReviewTarget = {
  proposalId: string;
  /** "242", or null for an older card that names no Line. */
  line: string | null;
  /** How many versions the card offers, 1 to 3. */
  optionCount: number;
  /** The passages of one version, 0 for Option 1. */
  pairsFor: (option: number) => ReviewPair[];
  /** Applies one version; throws with a plain reason when it cannot. */
  accept: (option: number) => Promise<void>;
};

export class ReviewSession {
  target = $state<ReviewTarget | null>(null);
  option = $state(0);
  /** On: struck old words and new words. Off: the report as it would read. */
  showChanges = $state(true);
  accepting = $state(false);
  error = $state<string | null>(null);
  /** Told when the report no longer holds a reviewed card's words. */
  onUnmatched: ((target: ReviewTarget) => void) | null = null;

  get pairs(): ReviewPair[] {
    return this.target ? this.target.pairsFor(this.option) : [];
  }

  isReviewing(proposalId: string): boolean {
    return this.target?.proposalId === proposalId;
  }

  start(target: ReviewTarget, option = 0) {
    this.target = target;
    this.option = Math.min(Math.max(0, option), target.optionCount - 1);
    this.showChanges = true;
    this.error = null;
  }

  setOption(option: number) {
    if (!this.target) return;
    this.option = Math.min(Math.max(0, option), this.target.optionCount - 1);
  }

  stop() {
    this.target = null;
    this.option = 0;
    this.accepting = false;
    this.error = null;
  }

  /**
   * The report marked nothing for the card under review: its words were
   * edited after the suggestion was made. End the review rather than float
   * the bar over an unchanged report, and say why in the chat.
   */
  nothingToShow() {
    const target = this.target;
    if (!target) return;
    this.stop();
    this.onUnmatched?.(target);
  }

  async accept(): Promise<boolean> {
    const target = this.target;
    if (!target || this.accepting) return false;
    this.accepting = true;
    this.error = null;
    try {
      await target.accept(this.option);
      if (this.target === target) this.stop();
      return true;
    } catch (error) {
      // The person backed out (a rule override they did not confirm): the
      // review stays open and nothing is wrong.
      if (error instanceof AcceptCancelled) return false;
      this.error = error instanceof Error && error.message ? error.message : "This suggestion could not be accepted. Try again.";
      return false;
    } finally {
      this.accepting = false;
    }
  }
}

/** One accepted card, as the Undo bar and the Done line name it. */
export type AcceptedCard = {
  proposalId: string;
  line: string | null;
  /** 0-based; present only when the card offered options. */
  option?: number;
};

/** A Claude-style notice: a short plain sentence and an optional action. */
export type ChatNotice = {
  message: string;
  action?: "version_history";
};

export class AssistantCards {
  /** The latest accept, one card or an Accept all; the Undo bar shows it. */
  lastAccepted = $state<AcceptedCard[] | null>(null);
  notice = $state<ChatNotice | null>(null);
  /** Whether the page offers the review in the report (else in the card). */
  readonly review: ReviewSession | null;

  constructor(review: ReviewSession | null = null) {
    this.review = review;
    if (review) {
      review.onUnmatched = (target) =>
        this.showNotice({
          message: `Couldn't review. ${target.line ? `Line ${target.line}` : "This passage"} was edited after this suggestion was made.`,
        });
    }
  }

  accepted(cards: AcceptedCard[]) {
    this.lastAccepted = cards;
    this.notice = null;
  }

  /** Cards that are no longer applied leave the Undo bar. */
  forget(proposalIds: readonly string[]) {
    if (!this.lastAccepted) return;
    const left = this.lastAccepted.filter((card) => !proposalIds.includes(card.proposalId));
    this.lastAccepted = left.length ? left : null;
  }

  showNotice(notice: ChatNotice) {
    this.notice = notice;
  }

  clearNotice() {
    this.notice = null;
  }

  reset() {
    this.lastAccepted = null;
    this.notice = null;
    this.review?.stop();
  }
}

const KEY = Symbol("assistant-cards");

export function provideAssistantCards(cards: AssistantCards): void {
  setContext(KEY, cards);
}

/** The panel's shared card state; cards rendered outside the panel get none. */
export function useAssistantCards(): AssistantCards | null {
  return getContext<AssistantCards | undefined>(KEY) ?? null;
}

/** "Line 242", "Lines 242 and 244", "Lines 242, 244 and 246". */
export function linesLabel(lines: readonly (string | null)[]): string {
  const named = [...new Set(lines.filter((line): line is string => Boolean(line)))];
  if (named.length === 0) return "The report";
  if (named.length === 1) return `Line ${named[0]}`;
  return `Lines ${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}

/** The fixed line under the cards once they are accepted. */
export function doneLine(cards: readonly AcceptedCard[]): string {
  if (cards.length === 1 && cards[0].option !== undefined) {
    return `Done. Option ${cards[0].option + 1} is now in ${linesLabel([cards[0].line])}.`;
  }
  const label = linesLabel(cards.map((card) => card.line));
  return cards.length > 1 || label.startsWith("Lines") ? `Done. ${label} are updated.` : `Done. ${label} is updated.`;
}

/** The fixed line once a card's accept is undone. */
export function undoneLine(lines: readonly (string | null)[]): string {
  const label = linesLabel(lines);
  return label.startsWith("Lines") ? `Undone. ${label} are back to how they were.` : `Undone. ${label} is back to how it was.`;
}

/** The Undo bar's text. */
export function updatedLabel(cards: readonly AcceptedCard[]): string {
  return `${linesLabel(cards.map((card) => card.line))} updated`;
}
