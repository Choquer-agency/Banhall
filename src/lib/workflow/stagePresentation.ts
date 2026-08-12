import type { WorkflowStage } from "../../../shared/workflowStages";

export type StageTone = "neutral" | "active" | "review" | "client" | "delivery" | "held" | "paused";

export const WORKFLOW_STAGE_TONES: Record<WorkflowStage, StageTone> = {
  intake: "neutral",
  interview_complete: "neutral",
  drafting: "active",
  internal_review: "review",
  client_review: "client",
  revisions: "review",
  ready_for_delivery: "delivery",
  delivered: "delivery",
  // 2026-08-10 owner direction: On hold reads as its own violet tone (still
  // paused semantically — see isPausedStage) so it never disappears into the
  // neutral grays. Client review keeps purple; violet stays distinct.
  on_hold: "held",
  abandoned: "paused",
};

/* Three surface treatments per tone:
   - `badge`/`dot` — Ledger Paper (light) surfaces.
   - `darkBadge`/`darkDot` — the saturated fir app bar (opaque, high-contrast;
     asserted by StageBadge tests — do not soften these).
   - `charcoalBadge`/`charcoalDot` — the Obvious-dark workspace shell:
     low-alpha tinted chips that keep the canonical stage hue while sitting
     quietly on near-black card material. Text labels always accompany color. */
const BADGE_CLASSES: Record<
  StageTone,
  {
    badge: string;
    dot: string;
    darkBadge: string;
    darkDot: string;
    charcoalBadge: string;
    charcoalDot: string;
  }
> = {
  neutral: {
    badge: "bg-gray-100 text-gray-600",
    dot: "bg-gray-400",
    darkBadge: "bg-white/15 text-white",
    darkDot: "bg-white/70",
    charcoalBadge: "bg-white/10 text-white/80",
    charcoalDot: "bg-white/60",
  },
  active: {
    badge: "bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
    darkBadge: "bg-blue-50 text-blue-800",
    darkDot: "bg-blue-600",
    charcoalBadge: "bg-blue-400/15 text-blue-300",
    charcoalDot: "bg-blue-400",
  },
  review: {
    badge: "bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    darkBadge: "bg-amber-50 text-amber-900",
    darkDot: "bg-amber-600",
    charcoalBadge: "bg-amber-400/15 text-amber-300",
    charcoalDot: "bg-amber-400",
  },
  client: {
    badge: "bg-purple-50 text-purple-700",
    dot: "bg-purple-500",
    darkBadge: "bg-purple-50 text-purple-900",
    darkDot: "bg-purple-600",
    charcoalBadge: "bg-purple-400/15 text-purple-300",
    charcoalDot: "bg-purple-400",
  },
  delivery: {
    badge: "bg-primary/15 text-navy",
    dot: "bg-primary",
    darkBadge: "bg-white text-navy",
    darkDot: "bg-primary",
    charcoalBadge: "bg-primary/15 text-primary-light",
    charcoalDot: "bg-primary-light",
  },
  held: {
    badge: "bg-violet-50 text-violet-700",
    dot: "bg-violet-500",
    darkBadge: "bg-violet-50 text-violet-900",
    darkDot: "bg-violet-600",
    charcoalBadge: "bg-violet-400/15 text-violet-300",
    charcoalDot: "bg-violet-400",
  },
  paused: {
    badge: "bg-gray-100 text-gray-600",
    dot: "bg-gray-400",
    darkBadge: "bg-white/15 text-white",
    darkDot: "bg-white/70",
    charcoalBadge: "bg-white/8 text-white/60",
    charcoalDot: "bg-white/40",
  },
};

/* Light (Ledger Paper) card treatments — the current dashboard's ProjectCard
   and any stage-aware card on a light surface. `focusWithinBorder` mirrors
   `hoverBorder` so a keyboard-focused stretched card link answers with the
   same edge affordance as hover (WCAG affinity — added 2026-08-06 with the
   light workspace so the board's focus-within contract survives the move
   off the charcoal tier). */
export const STAGE_CARD_THEMES: Record<
  StageTone,
  {
    border: string;
    hoverBorder: string;
    focusWithinBorder: string;
    footerBg: string;
    footerText: string;
    hoverShadow: string;
  }
> = {
  neutral: {
    border: "border-gray-200",
    hoverBorder: "hover:border-gray-300",
    focusWithinBorder: "focus-within:border-gray-300",
    footerBg: "bg-gray-50",
    footerText: "text-gray-500",
    hoverShadow: "hover:shadow-md hover:shadow-gray-200/70",
  },
  active: {
    border: "border-blue-200",
    hoverBorder: "hover:border-blue-300",
    focusWithinBorder: "focus-within:border-blue-300",
    footerBg: "bg-blue-50/70",
    footerText: "text-blue-700",
    hoverShadow: "hover:shadow-md hover:shadow-blue-100",
  },
  review: {
    border: "border-amber-200",
    hoverBorder: "hover:border-amber-300",
    focusWithinBorder: "focus-within:border-amber-300",
    footerBg: "bg-amber-50/70",
    footerText: "text-amber-800",
    hoverShadow: "hover:shadow-md hover:shadow-amber-100",
  },
  client: {
    border: "border-purple-200",
    hoverBorder: "hover:border-purple-300",
    focusWithinBorder: "focus-within:border-purple-300",
    footerBg: "bg-purple-50/70",
    footerText: "text-purple-700",
    hoverShadow: "hover:shadow-md hover:shadow-purple-100",
  },
  delivery: {
    border: "border-primary/30",
    hoverBorder: "hover:border-primary/50",
    focusWithinBorder: "focus-within:border-primary/50",
    footerBg: "bg-primary-wash",
    footerText: "text-primary-dark",
    hoverShadow: "hover:shadow-md hover:shadow-primary/10",
  },
  held: {
    border: "border-violet-200 border-dashed",
    hoverBorder: "hover:border-violet-300",
    focusWithinBorder: "focus-within:border-violet-300",
    footerBg: "bg-violet-50/70",
    footerText: "text-violet-700",
    hoverShadow: "hover:shadow-md hover:shadow-violet-100",
  },
  paused: {
    border: "border-gray-200 border-dashed",
    hoverBorder: "hover:border-gray-300",
    focusWithinBorder: "focus-within:border-gray-300",
    footerBg: "bg-gray-50",
    footerText: "text-gray-500",
    hoverShadow: "hover:shadow-md hover:shadow-gray-200/50",
  },
};

/* Charcoal card treatments — the Projects board on the Obvious-dark workspace
   shell (docs/design-system.md dark exception). The board's visual authority
   is the Obvious ARTIFACT Kanban (project workbench board artifact), whose
   task cards are a stage-TINTED outer shell (`shellBg` + low-alpha `border`,
   12px radius) wrapping a NEUTRAL `bg-surface` inner panel (10px radius).
   `footerBg`/`footerText` remain the low-alpha tint pair for any inset/footer
   use on charcoal. Paused work stays muted and dashed; heavy shadows are
   omitted (the inner panel carries only a hairline 1px shadow). */
export const STAGE_CARD_CHARCOAL_THEMES: Record<
  StageTone,
  {
    border: string;
    hoverBorder: string;
    /* Keyboard/touch parity for the hover affordance: the stretched title
       link inside a card focuses, and the shell edge answers exactly like
       hover (WCAG affinity — pointer and keyboard get the same cue). */
    focusWithinBorder: string;
    shellBg: string;
    footerBg: string;
    footerText: string;
  }
> = {
  neutral: {
    border: "border-white/10",
    hoverBorder: "hover:border-white/25",
    focusWithinBorder: "focus-within:border-white/25",
    shellBg: "bg-white/[0.04]",
    footerBg: "bg-white/[0.04]",
    footerText: "text-ink-secondary",
  },
  active: {
    border: "border-blue-400/30",
    hoverBorder: "hover:border-blue-300/50",
    focusWithinBorder: "focus-within:border-blue-300/50",
    shellBg: "bg-blue-400/10",
    footerBg: "bg-blue-400/10",
    footerText: "text-blue-300",
  },
  review: {
    border: "border-amber-400/30",
    hoverBorder: "hover:border-amber-300/50",
    focusWithinBorder: "focus-within:border-amber-300/50",
    shellBg: "bg-amber-400/10",
    footerBg: "bg-amber-400/10",
    footerText: "text-amber-300",
  },
  client: {
    border: "border-purple-400/30",
    hoverBorder: "hover:border-purple-300/50",
    focusWithinBorder: "focus-within:border-purple-300/50",
    shellBg: "bg-purple-400/10",
    footerBg: "bg-purple-400/10",
    footerText: "text-purple-300",
  },
  delivery: {
    border: "border-primary/40",
    hoverBorder: "hover:border-primary-light/60",
    focusWithinBorder: "focus-within:border-primary-light/60",
    shellBg: "bg-primary/10",
    footerBg: "bg-primary/10",
    footerText: "text-primary-light",
  },
  held: {
    border: "border-violet-400/30 border-dashed",
    hoverBorder: "hover:border-violet-300/50",
    focusWithinBorder: "focus-within:border-violet-300/50",
    shellBg: "bg-violet-400/10",
    footerBg: "bg-violet-400/10",
    footerText: "text-violet-300",
  },
  paused: {
    border: "border-white/10 border-dashed",
    hoverBorder: "hover:border-white/20",
    focusWithinBorder: "focus-within:border-white/20",
    shellBg: "bg-white/[0.03]",
    footerBg: "bg-white/[0.03]",
    footerText: "text-ink-muted",
  },
};

/** Paused SEMANTICS (dashed cue, muted column) — held (on_hold) and paused
 * (abandoned) tones both qualify; colour differs, behaviour does not. */
export function isPausedStage(stage: WorkflowStage) {
  const tone = WORKFLOW_STAGE_TONES[stage];
  return tone === "held" || tone === "paused";
}

export function stageBadgeClasses(stage: WorkflowStage) {
  return BADGE_CLASSES[WORKFLOW_STAGE_TONES[stage]];
}

export function stageCardTheme(stage: WorkflowStage) {
  return STAGE_CARD_THEMES[WORKFLOW_STAGE_TONES[stage]];
}

export function stageCardCharcoalTheme(stage: WorkflowStage) {
  return STAGE_CARD_CHARCOAL_THEMES[WORKFLOW_STAGE_TONES[stage]];
}
