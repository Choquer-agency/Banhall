import type { WorkflowStage } from "../../../shared/workflowStages";

export type StageTone = "neutral" | "active" | "review" | "client" | "delivery" | "paused";

export const WORKFLOW_STAGE_TONES: Record<WorkflowStage, StageTone> = {
  intake: "neutral",
  interview_complete: "neutral",
  drafting: "active",
  internal_review: "review",
  client_review: "client",
  revisions: "review",
  ready_for_delivery: "delivery",
  delivered: "delivery",
  on_hold: "paused",
  abandoned: "paused",
};

const BADGE_CLASSES: Record<StageTone, { badge: string; dot: string; darkBadge: string; darkDot: string }> = {
  neutral: {
    badge: "bg-gray-100 text-gray-600",
    dot: "bg-gray-400",
    darkBadge: "bg-white/15 text-white",
    darkDot: "bg-white/70",
  },
  active: {
    badge: "bg-blue-50 text-blue-700",
    dot: "bg-blue-500",
    darkBadge: "bg-blue-50 text-blue-800",
    darkDot: "bg-blue-600",
  },
  review: {
    badge: "bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    darkBadge: "bg-amber-50 text-amber-900",
    darkDot: "bg-amber-600",
  },
  client: {
    badge: "bg-purple-50 text-purple-700",
    dot: "bg-purple-500",
    darkBadge: "bg-purple-50 text-purple-900",
    darkDot: "bg-purple-600",
  },
  delivery: {
    badge: "bg-primary/15 text-navy",
    dot: "bg-primary",
    darkBadge: "bg-white text-navy",
    darkDot: "bg-primary",
  },
  paused: {
    badge: "bg-gray-100 text-gray-600",
    dot: "bg-gray-400",
    darkBadge: "bg-white/15 text-white",
    darkDot: "bg-white/70",
  },
};

export const STAGE_CARD_THEMES: Record<
  StageTone,
  {
    border: string;
    hoverBorder: string;
    footerBg: string;
    footerText: string;
    hoverShadow: string;
  }
> = {
  neutral: {
    border: "border-gray-200",
    hoverBorder: "hover:border-gray-300",
    footerBg: "bg-gray-50",
    footerText: "text-gray-500",
    hoverShadow: "hover:shadow-md hover:shadow-gray-200/70",
  },
  active: {
    border: "border-blue-200",
    hoverBorder: "hover:border-blue-300",
    footerBg: "bg-blue-50/70",
    footerText: "text-blue-700",
    hoverShadow: "hover:shadow-md hover:shadow-blue-100",
  },
  review: {
    border: "border-amber-200",
    hoverBorder: "hover:border-amber-300",
    footerBg: "bg-amber-50/70",
    footerText: "text-amber-800",
    hoverShadow: "hover:shadow-md hover:shadow-amber-100",
  },
  client: {
    border: "border-purple-200",
    hoverBorder: "hover:border-purple-300",
    footerBg: "bg-purple-50/70",
    footerText: "text-purple-700",
    hoverShadow: "hover:shadow-md hover:shadow-purple-100",
  },
  delivery: {
    border: "border-primary/30",
    hoverBorder: "hover:border-primary/50",
    footerBg: "bg-primary-wash",
    footerText: "text-primary-dark",
    hoverShadow: "hover:shadow-md hover:shadow-primary/10",
  },
  paused: {
    border: "border-gray-200 border-dashed",
    hoverBorder: "hover:border-gray-300",
    footerBg: "bg-gray-50",
    footerText: "text-gray-500",
    hoverShadow: "hover:shadow-md hover:shadow-gray-200/50",
  },
};

export function stageBadgeClasses(stage: WorkflowStage) {
  return BADGE_CLASSES[WORKFLOW_STAGE_TONES[stage]];
}

export function stageCardTheme(stage: WorkflowStage) {
  return STAGE_CARD_THEMES[WORKFLOW_STAGE_TONES[stage]];
}
