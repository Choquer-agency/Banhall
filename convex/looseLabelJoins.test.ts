/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { parseTranscriptTurns, TRANSCRIPT_PARSER_VERSION } from "../shared/transcriptParse";
import { pseudonymize } from "./lib/deidentify";
import { renderFactPack, renderTurnLine } from "./lib/transcriptFacts";
import { extractTranscriptFacts } from "./ai/transcriptFactsAgent";
import CONTENT from "../shared/__fixtures__/transcripts/loose-labels.txt?raw";

/**
 * Review 2026-09-26 (P2-4): a loose label ("thermal drift:") is hidden
 * where it stands as a label, but the paths that feed models join a turn's
 * lines (a turn's clean text, a quote with its whitespace collapsed, the
 * speaker-role samples). Each path still hides it. Names are fictional.
 */
const modules = import.meta.glob("./**/*.ts");
const LOOSE = ["thermal drift", "latency", "bottom line"];

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "loose-writer", role: "writer", name: "Wren Writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Feeder rig",
      clientName: "Verdant Grid Inc.",
      status: "draft",
      ownerId: userId,
      createdBy: userId,
      shareToken: "loose-token",
      createdAt: 1,
      updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: CONTENT,
      position: 0,
      parserVersion: TRANSCRIPT_PARSER_VERSION,
      createdAt: 1,
    });
    for (const turn of parseTranscriptTurns(CONTENT)) {
      await ctx.db.insert("transcriptTurns", {
        transcriptId,
        projectId,
        parserVersion: TRANSCRIPT_PARSER_VERSION,
        index: turn.index,
        ...(turn.speakerLabel ? { speakerLabel: turn.speakerLabel } : {}),
        charStart: turn.charStart,
        charEnd: turn.charEnd,
        cleanText: turn.cleanText,
      });
    }
    // Priya's role is a weak guess, so the role call samples her turns.
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Priya Raman", role: "client", roleSource: "heuristic", confidence: 0.5, turnCount: 2,
    });
    await ctx.db.insert("transcriptSpeakers", {
      transcriptId, projectId, label: "Dana Whitfield", role: "interviewer", roleSource: "consultant", confidence: 1, turnCount: 2,
    });
    return { projectId, transcriptId };
  });
  return { t, ...ids };
}

function expectHidden(text: string) {
  for (const label of LOOSE) expect(text, label).not.toContain(`${label}:`);
}

async function mapOf(f: Awaited<ReturnType<typeof setup>>) {
  const input = await f.t.query(internal.transcripts.factsInput, { transcriptId: f.transcriptId });
  const map = input!.placeholders;
  for (const label of LOOSE) expect(map.find((entry) => entry.value === label)?.at, label).toBe("label");
  return map;
}

describe("loose labels after lines are joined", () => {
  it("the fixture's turns join the loose labels into Priya's speech", () => {
    const turns = parseTranscriptTurns(CONTENT);
    expect(turns[1].cleanText).toBe(
      "Flow and temperature, every hour. thermal drift: within band. latency: 30 ms at the feeder."
    );
  });

  it("a fact window's turn lines hide them (transcriptFacts, the facts agent)", async () => {
    const f = await setup();
    const map = await mapOf(f);
    const turns = parseTranscriptTurns(CONTENT).map((turn) => ({ ...turn, role: "unknown" as const }));
    for (const turn of turns) expectHidden(renderTurnLine(turn, map));
    const windows: string[] = [];
    await extractTranscriptFacts({
      content: CONTENT,
      turns,
      placeholders: map,
      extractWindow: async (lines) => {
        windows.push(lines.map((line) => line.text).join("\n"));
        return [];
      },
    });
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) expectHidden(window);
  });

  it("a fact pack's quotes hide them once their whitespace is collapsed", async () => {
    const f = await setup();
    const map = await mapOf(f);
    const start = CONTENT.indexOf("Flow and temperature");
    const end = CONTENT.indexOf("at the feeder.") + "at the feeder.".length;
    const pack = renderFactPack(
      { position: 1, label: "Interview" },
      [
        {
          key: "F1",
          type: "result",
          claim: "Drift stayed within band.",
          turnIndexes: [1],
          quotes: [{ charStart: start, charEnd: end, exactExcerpt: CONTENT.slice(start, end) }],
          speakerLabel: "Priya Raman",
        },
      ],
      { roles: new Map([["Priya Raman", "client"]]), turnInfo: new Map([[1, { speakerLabel: "Priya Raman" }]]) }
    );
    expect(pack).toContain("every hour. thermal drift: within band. latency: 30 ms");
    expectHidden(pseudonymize(pack, map));
  });

  it("the speaker-role samples hide them", async () => {
    const f = await setup();
    const input = await f.t.query(internal.transcripts.speakerRoleInput, { transcriptId: f.transcriptId });
    const lines = input!.samples.flatMap((sample) => sample.lines);
    expect(lines.join("\n")).toContain("thermal drift: within band.");
    expectHidden(pseudonymize(lines.join("\n"), input!.placeholders));
  });
});
