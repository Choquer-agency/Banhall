/**
 * Validators shared by the schema and the transcript functions (phase 3,
 * the transcript method). Runtime-light: convex/values only.
 */
import { v } from "convex/values";
import { TRANSCRIPT_SOURCE_FORMATS } from "../../shared/transcriptParse";

export const transcriptSourceFormatValidator = v.union(
  ...TRANSCRIPT_SOURCE_FORMATS.map((format) => v.literal(format))
);

export const TRANSCRIPT_SPEAKER_ROLES = ["interviewer", "client", "other", "unknown"] as const;
export type TranscriptSpeakerRole = (typeof TRANSCRIPT_SPEAKER_ROLES)[number];

export const transcriptSpeakerRoleValidator = v.union(
  v.literal("interviewer"),
  v.literal("client"),
  v.literal("other"),
  v.literal("unknown")
);

export const TRANSCRIPT_FACT_TYPES = [
  "uncertainty",
  "hypothesis",
  "experiment",
  "result",
  "advancement",
  "context",
] as const;
export type TranscriptFactType = (typeof TRANSCRIPT_FACT_TYPES)[number];

export const transcriptFactTypeValidator = v.union(
  v.literal("uncertainty"),
  v.literal("hypothesis"),
  v.literal("experiment"),
  v.literal("result"),
  v.literal("advancement"),
  v.literal("context")
);
