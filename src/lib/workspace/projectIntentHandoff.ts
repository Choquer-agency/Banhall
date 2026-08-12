import { capContent } from "$lib/parseDocument";

// One-use Home → New Project intake handoff.
//
// This exists only long enough for an immediate client-side route transition.
// It never enters the URL, browser history, durable browser storage, Convex,
// or application data. A reload/new tab correctly opens a blank wizard.

export const PROJECT_INTENT_HANDOFF_TTL_MS = 5_000;
export const MAX_PROJECT_INTENT_LENGTH = 160;

export type ProjectStartHandoff = {
  title: string;
  transcriptText: string;
  transcriptFileName: string | null;
};

let stashed: { value: ProjectStartHandoff; at: number } | null = null;

export function normalizeProjectIntent(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_PROJECT_INTENT_LENGTH);
}

export function stashProjectStart(
  value: Partial<ProjectStartHandoff>,
  now: number = Date.now()
) {
  const normalized: ProjectStartHandoff = {
    title: normalizeProjectIntent(value.title ?? ""),
    transcriptText: capContent(value.transcriptText?.trim() ?? ""),
    transcriptFileName: value.transcriptFileName?.trim() || null,
  };
  stashed = normalized.title || normalized.transcriptText ? { value: normalized, at: now } : null;
}

export function takeProjectStart(now: number = Date.now()): ProjectStartHandoff {
  const current = stashed;
  stashed = null;
  if (!current || now - current.at > PROJECT_INTENT_HANDOFF_TTL_MS) {
    return { title: "", transcriptText: "", transcriptFileName: null };
  }
  return {
    title: normalizeProjectIntent(current.value.title),
    transcriptText: capContent(current.value.transcriptText),
    transcriptFileName: current.value.transcriptFileName,
  };
}

// Compatibility wrappers for existing tests/callers while the Home handoff
// expands from title-only to title + transcript.
export function stashProjectIntent(value: string, now: number = Date.now()) {
  stashProjectStart({ title: value }, now);
}

export function takeProjectIntent(now: number = Date.now()) {
  return takeProjectStart(now).title;
}
