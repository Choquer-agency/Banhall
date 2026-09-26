import {
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
  type RegisteredAction,
} from "convex/server";
import type { previewMyStyle } from "../../../convex/ai/stylePreview";

// `convex/ai/stylePreview.ts` is new in round 2. Until the lead regenerates
// `convex/_generated/api.d.ts`, `api.ai.stylePreview` has no types, so the
// page builds a typed reference from the module's own export (the pattern of
// `$lib/components/seeds/api.ts`). Swap for
// `api.ai.stylePreview.previewMyStyle` once the generated API lists it.
type ActionReference<Export> =
  Export extends RegisteredAction<infer Visibility, infer Args, infer ReturnValue>
    ? FunctionReference<"action", Visibility, Args, Awaited<ReturnValue>>
    : never;
type PreviewReference = ActionReference<typeof previewMyStyle>;

export const previewMyStyleRef = makeFunctionReference<
  "action",
  FunctionArgs<PreviewReference>,
  FunctionReturnType<PreviewReference>
>("ai/stylePreview:previewMyStyle");

export type StylePreviewVariant = FunctionArgs<PreviewReference>["variant"];
export type StylePreviewResult = FunctionReturnType<PreviewReference>;
