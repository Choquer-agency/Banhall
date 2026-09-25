/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

// Neither name is on the project record, so the rules leave both below the
// threshold and the one structured_helper call runs.
const INTERVIEW = [
  "Marcus Lindqvist: We could not forecast net load fast enough when cloud cover changed, so we built a rig.",
  "Dana Kowalczyk: What did the rig measure?",
  "Marcus Lindqvist: Feeder voltage every second for six weeks.",
].join("\n\n");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-speaker-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "sr-writer", role: "writer", firstName: "Wren" });
    await ctx.db.insert("users", { authId: "sr-roleless", firstName: "Nobody" });
    const projectId = await ctx.db.insert("projects", {
      title: "Helios",
      clientName: "Verdant Grid Technologies Inc.",
      status: "draft",
      createdBy: writerId,
      shareToken: "sr-token",
      createdAt: 1,
      updatedAt: 1,
    });
    return { writerId, projectId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "sr-writer" }),
    roleless: t.withIdentity({ subject: "sr-roleless" }),
  };
}

function toolResponse(input: unknown) {
  return Response.json({
    id: "msg_speakers",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "tool_use", id: "tool_1", name: "record_speaker_roles", input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 400, output_tokens: 40 },
  });
}

async function speakers(f: Awaited<ReturnType<typeof setup>>, transcriptId: Id<"transcripts">) {
  return await f.writer.query(api.transcripts.getTranscriptSpeakers, { transcriptId });
}

describe("speaker roles by model, behind placeholders", () => {
  it("sends placeholders, never names, and stores the restored answer", async () => {
    const f = await setup();
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        const body = await request.text();
        bodies.push(body);
        const parsed = JSON.parse(body) as { messages: Array<{ content: unknown }> };
        const user = JSON.stringify(parsed.messages[0].content);
        // The model answers with the labels it was shown: the one asking
        // is the interviewer.
        const blocks = [...user.matchAll(/Speaker: (\[PERSON_\d+\])\\n- ([^\\]*)/g)];
        return toolResponse({
          speakers: blocks.map((block) => ({
            label: block[1],
            role: block[2].includes("?") ? "interviewer" : "client",
            confidence: 0.9,
          })),
        });
      })
    );
    const transcriptId = await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: f.projectId,
      content: INTERVIEW,
      label: "call.txt",
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(bodies).toHaveLength(1);
    const request = JSON.parse(bodies[0]) as { model: string; messages: Array<{ content: unknown }> };
    expect(request.model).toBe("claude-haiku-4-5-20251001");
    expect(bodies[0]).not.toContain("Marcus");
    expect(bodies[0]).not.toContain("Kowalczyk");
    expect(bodies[0]).toContain("[PERSON_");

    const rows = await speakers(f, transcriptId);
    expect(rows?.map((row) => [row.label, row.role, row.roleSource])).toEqual([
      ["Dana Kowalczyk", "interviewer", "model"],
      ["Marcus Lindqvist", "client", "model"],
    ]);
    const list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list[0].speakerStatus).toBe("needs_check");
  });

  it("keeps the rule-based roles when the call fails", async () => {
    const f = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("overloaded", { status: 529 })));
    const transcriptId = await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: f.projectId,
      content: INTERVIEW,
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await speakers(f, transcriptId);
    expect(rows?.every((row) => row.roleSource === "heuristic")).toBe(true);
  });
});

describe("the Speakers popover reads and writes", () => {
  async function added(f: Awaited<ReturnType<typeof setup>>) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const id = await f.writer.mutation(api.transcripts.addTranscript, {
      projectId: f.projectId,
      content: INTERVIEW,
    });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    return id;
  }

  it("shows a verbatim sample line per speaker", async () => {
    const f = await setup();
    const id = await added(f);
    const rows = await speakers(f, id);
    expect(rows?.find((row) => row.label === "Marcus Lindqvist")?.sample).toBe(
      "We could not forecast net load fast enough when cloud cover changed, so we built a rig."
    );
    expect(await f.roleless.query(api.transcripts.getTranscriptSpeakers, { transcriptId: id })).toBeNull();
  });

  it("records a consultant's role and confirms the rest", async () => {
    const f = await setup();
    const id = await added(f);
    await f.writer.mutation(api.transcripts.setSpeakerRole, {
      transcriptId: id,
      label: "Dana Kowalczyk",
      role: "interviewer",
    });
    let rows = await speakers(f, id);
    expect(rows?.find((row) => row.label === "Dana Kowalczyk")).toMatchObject({
      role: "interviewer",
      roleSource: "consultant",
    });
    let list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list[0].speakerStatus).toBe("needs_check");

    await f.writer.mutation(api.transcripts.confirmSpeakers, { transcriptId: id });
    rows = await speakers(f, id);
    expect(rows?.every((row) => row.roleSource === "consultant")).toBe(true);
    list = await f.writer.query(api.transcripts.listTranscripts, { projectId: f.projectId });
    expect(list[0].speakerStatus).toBe("confirmed");

    await expect(
      f.roleless.mutation(api.transcripts.setSpeakerRole, { transcriptId: id, label: "Dana Kowalczyk", role: "client" })
    ).rejects.toThrow();
  });
});
