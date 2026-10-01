/**
 * The writer style a generation freezes at start, and the `brain_blocks`
 * artifact built from it.
 *
 * Owner decision 32 (2026-09-25): a Step-by-step generation opens its seed
 * stage as soon as its Brief exists, while Brain retrieval and the analysis
 * run in the background. Seeds read only the style, so it is frozen on its
 * own as a `writer_style` artifact first. `brain_blocks` keeps its documented
 * shape, `{ blocks, ...style }`, so every drafting reader is unchanged; this
 * module builds both from one object so the two can never disagree, and
 * builds `brain_blocks` byte for byte as it was built before the reorder.
 *
 * Pure: no Convex or Node imports, safe in any runtime.
 */
import type { Id } from "../_generated/dataModel";
import type { OrderedPayload } from "./orderedChain";
import type { StyleOverrides } from "../../shared/styleOverrides";

export type FrozenWriterStyle = {
  styleGuidance: string;
  orderedContext: OrderedPayload["orderedContext"];
  qaCalibration?: string;
  draftStyle?: string;
  qaCalibrationDigestId?: Id<"learningDigests">;
  draftStyleDigestId?: Id<"learningDigests">;
  writerFlavor?: string;
  styleOverrides: StyleOverrides;
};

export type FrozenBrainBlocks = {
  analyzer: string;
  s242: string;
  s244: string;
  s246: string;
};

/** The style fields in the order `brain_blocks` has always stored them. */
function styleFields(style: FrozenWriterStyle) {
  return {
    styleGuidance: style.styleGuidance,
    orderedContext: style.orderedContext,
    ...(style.qaCalibration ? { qaCalibration: style.qaCalibration } : {}),
    ...(style.draftStyle ? { draftStyle: style.draftStyle } : {}),
    ...(style.qaCalibrationDigestId
      ? { qaCalibrationDigestId: style.qaCalibrationDigestId }
      : {}),
    ...(style.draftStyleDigestId
      ? { draftStyleDigestId: style.draftStyleDigestId }
      : {}),
    ...(style.writerFlavor ? { writerFlavor: style.writerFlavor } : {}),
    // Frozen at start like styleGuidance, including the all-false "full
    // enforcement" state, so a later profile or mode change can never
    // re-score this draft under waivers it was not written with.
    styleOverrides: style.styleOverrides,
  };
}

/** Content of the `writer_style` artifact: `brain_blocks` without `blocks`. */
export function writerStyleArtifactContent(style: FrozenWriterStyle): string {
  return JSON.stringify(styleFields(style));
}

/** Content of the `brain_blocks` artifact:
 * `{ blocks, styleGuidance, orderedContext, ..., styleOverrides }`. */
export function brainBlocksArtifactContent(
  blocks: FrozenBrainBlocks,
  style: FrozenWriterStyle
): string {
  return JSON.stringify({ blocks, ...styleFields(style) });
}

/**
 * `brain_blocks` content from Brain blocks and a stored `writer_style`
 * artifact. The style's own key order is kept, so the result equals
 * `brainBlocksArtifactContent(blocks, style)` for the style that wrote it.
 */
export function brainBlocksFromWriterStyle(
  blocks: FrozenBrainBlocks,
  writerStyleContent: string
): string {
  const parsed: unknown = JSON.parse(writerStyleContent);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Frozen writer style is malformed");
  }
  return JSON.stringify({ blocks, ...(parsed as Record<string, unknown>) });
}

/** Brain blocks as the background step hands them over: four strings. */
export function parseFrozenBrainBlocks(content: string): FrozenBrainBlocks {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Brain blocks are malformed");
  }
  const value = parsed as Record<string, unknown>;
  const blocks = {
    analyzer: value.analyzer,
    s242: value.s242,
    s244: value.s244,
    s246: value.s246,
  };
  if (Object.values(blocks).some((block) => typeof block !== "string")) {
    throw new Error("Brain blocks are incomplete");
  }
  return blocks as FrozenBrainBlocks;
}
