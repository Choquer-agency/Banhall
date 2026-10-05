/**
 * 2026-10-04 (first, round 2, owner approved 2026-10-05): the Brief's
 * Storyline and Confidence Map use the settings document's terms. Release
 * suite run of 2026-10-04 (second run, fixture writer-settings-document,
 * fictional Velloway): the Brief's Storyline said "substrate temperature",
 * "pinholes", "edge DFT", "bake window" and "edge wrap", which the settings
 * document in Writer's Notes bans.
 */
import { describe, expect, it, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { BRIEF_WRITER_WORDING, briefSettingsSource, buildBriefUserMessage } from "./lib/briefRequest";
import { briefInputsHash } from "./lib/briefInputsHash";
import { sha256 } from "./lib/contracts";
import { runBriefRequest, type BriefSourceAdapter } from "./ai/brief";
import type { GenerationClient, GenerationMessageParams } from "./ai/openrouterCore";

const TRANSCRIPT =
  "Interviewer: What went wrong at first?\nClient: Pinholes showed up once the substrate temperature passed about 120, and the bake window was close to zero.";
const SETTINGS = [
  "# PD Writing Customized Settings",
  "- panel surface temperature: never write substrate temperature.",
  "- cure window: never write bake window or oven window.",
  "- outgassing defects: never write pinholes on their own.",
].join("\n");
const NOTES = "Writer's notes: the client wants the deep cove result stated plainly.";

type Row = Pick<Doc<"generationSources">, "label" | "content" | "kind" | "contentHash"> & {
  uploaderRole?: "writer" | "manager" | "admin";
};
const transcript: Row = { kind: "transcript", label: "Interview", content: TRANSCRIPT, contentHash: "h-transcript" };
const settings = (uploaderRole?: Row["uploaderRole"]): Row => ({
  kind: "project_document",
  label: "writer_notes:pd-writing-customized-settings.md",
  content: SETTINGS,
  contentHash: "h-settings",
  ...(uploaderRole ? { uploaderRole } : {}),
});
const notes: Row = {
  kind: "project_document",
  label: "writer_notes:notes.md",
  content: NOTES,
  contentHash: "h-notes",
  uploaderRole: "writer",
};

const SENTENCE = `${BRIEF_WRITER_WORDING.prefix}WRITER_NOTES:PD-WRITING-CUSTOMIZED-SETTINGS.MD${BRIEF_WRITER_WORDING.suffix}`;
const TASK =
  "Derive the Generation Brief from the evidence below. Every quote you give must be an exact, verbatim substring of one of these blocks.";

describe("the Brief follows the settings document's terms (round 2)", () => {
  it("names the settings document's block right after the task line, once", () => {
    const message = buildBriefUserMessage([transcript, settings("writer")]);
    expect(message.startsWith(`${TASK}${SENTENCE}\n\n--- BEGIN [SOURCE_KIND=transcript] [INTERVIEW] ---`)).toBe(true);
    expect(message.split(SENTENCE)).toHaveLength(2);
    expect(message).toContain("--- BEGIN [SOURCE_KIND=project_document] [WRITER_NOTES:PD-WRITING-CUSTOMIZED-SETTINGS.MD] ---");
    expect(SENTENCE).toContain("In the Storyline, the text of each claim, Claim Exclusion and Confidence Map entry, and the Glossary Terms");
    expect(SENTENCE).toContain("Quotes stay exact, verbatim substrings of the evidence.");
    expect(JSON.stringify(BRIEF_WRITER_WORDING)).not.toMatch(/[–—]/);
  });

  it("sends the request as before without a settings document an internal uploader supplied", () => {
    for (const sources of [[transcript], [transcript, notes], [transcript, settings()]]) {
      const message = buildBriefUserMessage(sources);
      // The trust floor: a client's copy of a settings document is evidence only.
      expect(message).not.toContain(BRIEF_WRITER_WORDING.suffix);
      expect(message.startsWith(`${TASK}\n\n--- BEGIN`)).toBe(true);
    }
    expect(briefSettingsSource([transcript, settings()])).toBeNull();
  });

  it("says nothing when the settings document's block did not fit the budget", () => {
    const tight = { totalTokens: Math.floor(TRANSCRIPT.length / 4), perSourceTokens: 100_000 };
    const message = buildBriefUserMessage([transcript, settings("writer")], tight);
    expect(message).not.toContain("WRITER_NOTES:PD-WRITING-CUSTOMIZED-SETTINGS.MD");
    expect(message).not.toContain(BRIEF_WRITER_WORDING.suffix);
  });

  it("never reuses a Brief across the rule, and keeps the hash as it was without it", async () => {
    const plain = await briefInputsHash([transcript, notes] as Array<Omit<Doc<"generationSources">, "_id" | "_creationTime">>);
    expect(plain).toBe(await sha256(plainConcat([transcript, notes])));
    const internal = await briefInputsHash([transcript, settings("writer")] as Array<Omit<Doc<"generationSources">, "_id" | "_creationTime">>);
    const client = await briefInputsHash([transcript, settings()] as Array<Omit<Doc<"generationSources">, "_id" | "_creationTime">>);
    expect(internal).not.toBe(client);
    expect(client).toBe(await sha256(plainConcat([transcript, settings()])));
    expect(internal).toBe(await sha256(`${plainConcat([transcript, settings("writer")])}|writerWording:${BRIEF_WRITER_WORDING.version}`));
  });

  it("is what the Brief request sends", async () => {
    const create = vi.fn(async (params: GenerationMessageParams) => ({
      content: [{
        type: "tool_use" as const,
        id: "brief",
        name: params.tool_choice?.name ?? "submit_generation_brief",
        input: { storyline: "", storylineClaims: [], claimExclusions: [], confidenceMap: [], glossaryTerms: [] },
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const adapter = { sources: [transcript, settings("writer")] } as unknown as BriefSourceAdapter<string>;
    await runBriefRequest(adapter, { messages: { create } } as unknown as GenerationClient, "claude-sonnet-5");
    const [params] = create.mock.calls[0]!;
    const user = params.messages[0]!.content;
    expect(typeof user === "string" ? user : JSON.stringify(user)).toContain(SENTENCE.trim());
  });
});

/** The hash's own concatenation without any marker: sorted rows' content hashes. */
function plainConcat(rows: Row[]): string {
  return [...rows]
    .sort((a, b) => {
      const left = JSON.stringify(a);
      const right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map((row) => row.contentHash)
    .join("|");
}
