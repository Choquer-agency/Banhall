/**
 * Model tracks (owner decision, 2026-10-22: "Models follow the newest
 * version of their tier"). A track is one tier of one vendor's models:
 * Claude Opus, Claude Sonnet, Claude Haiku, GPT Sol, GPT Luna, Gemini Pro and
 * Gemini Flash. The app always runs the newest version of each track, and
 * the daily job (convex/modelCatalog.ts) moves a track forward when a newer
 * version shows up on OpenRouter and passes a readiness check.
 *
 * Never tracked: the top tiers (Fable, Mythos, Astra), OpenAI's "-pro" and
 * Terra variants, and lite, image, codex, customtools and ":batch" ids.
 * Google's other lines (Gemini 4 Argon, 2026-10-13) match no track and are
 * left alone.
 *
 * Pure and import free, so every runtime (Convex, browser, scripts) can use
 * it and it tests without a deployment.
 */

export const MODEL_TRACK_IDS = [
  "claude-opus",
  "claude-sonnet",
  "claude-haiku",
  "gpt-sol",
  "gpt-luna",
  "gemini-pro",
  "gemini-flash",
] as const;
export type ModelTrackId = (typeof MODEL_TRACK_IDS)[number];

export function isModelTrackId(value: string): value is ModelTrackId {
  return (MODEL_TRACK_IDS as readonly string[]).includes(value);
}

export type TrackVendor = "anthropic" | "openai" | "google";

export type TrackDefinition = {
  id: ModelTrackId;
  /** The tier's name on the admin page, e.g. "Claude Sonnet". */
  name: string;
  vendor: TrackVendor;
  provider: "Anthropic" | "OpenAI" | "Google";
  /**
   * Where the app sends the track's calls. Claude tracks always go direct
   * to Anthropic: a Claude track never moves to the OpenRouter gateway.
   */
  gateway: "anthropic" | "openrouter";
  /** The word that names the tier inside an id ("sonnet", "sol", "pro"). */
  tier: string;
  /** Plain, short picker text. */
  description: string;
};

export const MODEL_TRACKS: Readonly<Record<ModelTrackId, TrackDefinition>> = {
  "claude-opus": {
    id: "claude-opus",
    name: "Claude Opus",
    vendor: "anthropic",
    provider: "Anthropic",
    gateway: "anthropic",
    tier: "opus",
    description: "Deepest reasoning, for dense technical claims.",
  },
  "claude-sonnet": {
    id: "claude-sonnet",
    name: "Claude Sonnet",
    vendor: "anthropic",
    provider: "Anthropic",
    gateway: "anthropic",
    tier: "sonnet",
    description: "The default. Strong writing at a mid price.",
  },
  "claude-haiku": {
    id: "claude-haiku",
    name: "Claude Haiku",
    vendor: "anthropic",
    provider: "Anthropic",
    gateway: "anthropic",
    tier: "haiku",
    description: "The fastest and cheapest Claude model.",
  },
  "gpt-sol": {
    id: "gpt-sol",
    name: "GPT Sol",
    vendor: "openai",
    provider: "OpenAI",
    gateway: "openrouter",
    tier: "sol",
    description: "OpenAI's flagship. Strong reasoning at a mid price.",
  },
  "gpt-luna": {
    id: "gpt-luna",
    name: "GPT Luna",
    vendor: "openai",
    provider: "OpenAI",
    gateway: "openrouter",
    tier: "luna",
    description: "OpenAI's fast tier. Quick drafts at a low price.",
  },
  "gemini-pro": {
    id: "gemini-pro",
    name: "Gemini Pro",
    vendor: "google",
    provider: "Google",
    gateway: "openrouter",
    tier: "pro",
    description: "Google's frontier model. Strong with long sources.",
  },
  "gemini-flash": {
    id: "gemini-flash",
    name: "Gemini Flash",
    vendor: "google",
    provider: "Google",
    gateway: "openrouter",
    tier: "flash",
    description: "Google's fast tier. Close to Pro at a lower price.",
  },
};

/**
 * Each track's model on 2026-10-22, read from OpenRouter's live list. A
 * deployment whose track table is empty runs these; the daily job moves
 * them forward from there. Claude tracks hold the direct Anthropic id.
 */
export const TRACK_SEED_MODEL_IDS: Readonly<Record<ModelTrackId, string>> = {
  "claude-opus": "claude-opus-5-5",
  "claude-sonnet": "claude-sonnet-5-5",
  "claude-haiku": "claude-haiku-5-5",
  "gpt-sol": "openai/gpt-6.1-sol",
  "gpt-luna": "openai/gpt-6-luna",
  "gemini-pro": "google/gemini-3.1-pro-preview",
  "gemini-flash": "google/gemini-3.8-flash",
};

/** A version: major, then minor (0 when the id has none). */
export type TrackVersion = { major: number; minor: number; hasMinor: boolean };

export type ParsedTrackId = {
  track: ModelTrackId;
  version: TrackVersion;
  /** A "-preview" id. A GA id at the same version is newer. */
  preview: boolean;
  /** Which form the id was written in. */
  form: "direct" | "openrouter";
};

/**
 * Words that keep an id off every track, whatever else it matches: the top
 * tiers (expensive), the variants that are not the plain tier model, and
 * OpenRouter's ":batch" style variants.
 */
export const EXCLUDED_ID_PARTS = [
  "fable",
  "mythos",
  "astra",
  "terra",
  "lite",
  "image",
  "codex",
  "customtools",
] as const;

/** Whether `modelId` is never tracked, by the exclusion rules above. */
export function isExcludedModelId(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (id.includes(":") || id.startsWith("~")) return true;
  const words = id.split(/[/\-.]/);
  if (EXCLUDED_ID_PARTS.some((part) => words.includes(part))) return true;
  // OpenAI's "-pro" variants (gpt-6.1-sol-pro). Gemini's "pro" is its tier.
  if (id.startsWith("openai/") && words.includes("pro")) return true;
  return false;
}

const DATE_SUFFIX = "(?:-\\d{8})?";
const VERSION = "(\\d+)(?:\\.(\\d+))?";
const CLAUDE_TIER: Record<string, ModelTrackId> = {
  opus: "claude-opus",
  sonnet: "claude-sonnet",
  haiku: "claude-haiku",
};

function version(major: string, minor: string | undefined): TrackVersion {
  return {
    major: Number(major),
    minor: minor === undefined ? 0 : Number(minor),
    hasMinor: minor !== undefined,
  };
}

/**
 * The track and version an id names, or null. Every form the app has ever
 * stored is read:
 * - direct Anthropic ids: claude-sonnet-5-5, claude-opus-5, and dated ones
 *   such as claude-haiku-4-5-20251001;
 * - OpenRouter ids and dated canonical slugs: anthropic/claude-sonnet-5.5,
 *   anthropic/claude-sonnet-5.5-20260928, and the older slug word order
 *   anthropic/claude-4.8-opus-20260528;
 * - OpenAI: openai/gpt-6.1-sol, openai/gpt-6-luna-20260922;
 * - Google: google/gemini-3.1-pro-preview, google/gemini-3.8-flash.
 */
export function parseTrackId(modelId: string): ParsedTrackId | null {
  const id = modelId.trim().toLowerCase();
  if (!id || isExcludedModelId(id)) return null;
  let match = new RegExp(`^claude-(opus|sonnet|haiku)-(\\d+)(?:-(\\d{1,2}))?${DATE_SUFFIX}$`).exec(id);
  if (match) {
    return { track: CLAUDE_TIER[match[1]], version: version(match[2], match[3]), preview: false, form: "direct" };
  }
  match = new RegExp(`^anthropic/claude-(opus|sonnet|haiku)-${VERSION}${DATE_SUFFIX}$`).exec(id);
  if (match) {
    return { track: CLAUDE_TIER[match[1]], version: version(match[2], match[3]), preview: false, form: "openrouter" };
  }
  match = new RegExp(`^anthropic/claude-${VERSION}-(opus|sonnet|haiku)${DATE_SUFFIX}$`).exec(id);
  if (match) {
    return { track: CLAUDE_TIER[match[3]], version: version(match[1], match[2]), preview: false, form: "openrouter" };
  }
  match = new RegExp(`^openai/gpt-${VERSION}-(sol|luna)${DATE_SUFFIX}$`).exec(id);
  if (match) {
    return {
      track: match[3] === "sol" ? "gpt-sol" : "gpt-luna",
      version: version(match[1], match[2]),
      preview: false,
      form: "openrouter",
    };
  }
  match = new RegExp(`^google/gemini-${VERSION}-(pro|flash)(-preview)?${DATE_SUFFIX}$`).exec(id);
  if (match) {
    return {
      track: match[3] === "pro" ? "gemini-pro" : "gemini-flash",
      version: version(match[1], match[2]),
      preview: match[4] !== undefined,
      form: "openrouter",
    };
  }
  return null;
}

/** The track `modelId` belongs to, in any of its forms, or null. */
export function trackOf(modelId: string): ModelTrackId | null {
  return parseTrackId(modelId)?.track ?? null;
}

/**
 * Negative when `a` is older than `b`, positive when newer, 0 when the same.
 * Major, then minor; at the same version a GA id beats a "-preview" one.
 */
export function compareVersions(
  a: Pick<ParsedTrackId, "version" | "preview">,
  b: Pick<ParsedTrackId, "version" | "preview">
): number {
  return (
    a.version.major - b.version.major ||
    a.version.minor - b.version.minor ||
    (a.preview === b.preview ? 0 : a.preview ? -1 : 1)
  );
}

/** "5.5", or "6" for a version without a minor number. */
export function versionString(value: TrackVersion): string {
  return value.hasMinor ? `${value.major}.${value.minor}` : String(value.major);
}

/**
 * A track model's picker label from the track and the version, so a model
 * the daily job finds needs no code: "Sonnet 5.5", "GPT-6.1 Sol",
 * "Gemini 3.8 Flash".
 */
export function trackLabel(track: ModelTrackId, value: TrackVersion): string {
  const v = versionString(value);
  switch (track) {
    case "claude-opus":
      return `Opus ${v}`;
    case "claude-sonnet":
      return `Sonnet ${v}`;
    case "claude-haiku":
      return `Haiku ${v}`;
    case "gpt-sol":
      return `GPT-${v} Sol`;
    case "gpt-luna":
      return `GPT-${v} Luna`;
    case "gemini-pro":
      return `Gemini ${v} Pro`;
    case "gemini-flash":
      return `Gemini ${v} Flash`;
  }
}

/** The label for any tracked id, or null for an id on no track. */
export function trackLabelFor(modelId: string): string | null {
  const parsed = parseTrackId(modelId);
  return parsed ? trackLabel(parsed.track, parsed.version) : null;
}

/**
 * The direct Anthropic id of a Claude version: claude-sonnet-5-5, or
 * claude-opus-6 when the version has no minor number. Null for a track that
 * is not Claude's.
 */
export function directAnthropicId(track: ModelTrackId, value: TrackVersion): string | null {
  const tier = MODEL_TRACKS[track];
  if (tier.vendor !== "anthropic") return null;
  return `claude-${tier.tier}-${value.major}${value.hasMinor ? `-${value.minor}` : ""}`;
}

/**
 * The OpenRouter id of a direct Claude id (claude-sonnet-5-5 to
 * anthropic/claude-sonnet-5.5), read from the id itself. Null for a dated
 * direct id or an id on no Claude track: those have their own listing.
 */
export function openRouterIdForDirectClaude(directId: string): string | null {
  const parsed = parseTrackId(directId);
  if (!parsed || parsed.form !== "direct" || /-\d{8}$/.test(directId)) return null;
  const tier = MODEL_TRACKS[parsed.track];
  if (tier.vendor !== "anthropic") return null;
  return `anthropic/claude-${tier.tier}-${versionString(parsed.version)}`;
}

/**
 * The newest OpenRouter id on `track` among `ids` (undated listing ids, as
 * OpenRouter's `id` field gives them), or null when none matches. Direct
 * Anthropic ids are ignored: discovery reads OpenRouter's list only.
 */
export function newestInTrack(track: ModelTrackId, ids: Iterable<string>): string | null {
  let best: { id: string; parsed: ParsedTrackId } | null = null;
  for (const id of ids) {
    if (/-\d{8}$/.test(id)) continue;
    const parsed = parseTrackId(id);
    if (!parsed || parsed.track !== track || parsed.form !== "openrouter") continue;
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { id, parsed };
  }
  return best?.id ?? null;
}

/** Whether `candidate` is a newer version than `current` on the same track. */
export function isNewerInTrack(candidate: string, current: string): boolean {
  const a = parseTrackId(candidate);
  const b = parseTrackId(current);
  if (!a || !b || a.track !== b.track) return false;
  return compareVersions(a, b) > 0;
}

/**
 * The id the app runs for a track's newest OpenRouter listing: the direct
 * Anthropic id for a Claude track, the OpenRouter id for every other.
 */
export function appModelIdForListing(track: ModelTrackId, openRouterId: string): string | null {
  const parsed = parseTrackId(openRouterId);
  if (!parsed || parsed.track !== track) return null;
  if (MODEL_TRACKS[track].vendor === "anthropic") return directAnthropicId(track, parsed.version);
  return openRouterId;
}
