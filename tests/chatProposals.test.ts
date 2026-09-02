import { describe, expect, test } from "bun:test";
import {
  applyProposal,
  listProposals,
  rejectProposal,
  saveProposal,
  updateProposalWording,
} from "../convex/chatV2";
import { sha256 } from "../convex/lib/contracts";

type Role = "writer" | "manager" | "admin";
type ProposalState = "pending" | "applied" | "rejected" | "stale";

interface BaseRow {
  _id: string;
  _creationTime: number;
}

interface UserRow extends BaseRow {
  role: Role;
  /** Better Auth component user id (identity.subject → by_authId lookup). */
  authId?: string;
}

interface ProjectRow extends BaseRow {
  createdBy: string;
}

interface ReportRow extends BaseRow {
  projectId: string;
  content: string;
  contentHash: string;
  revisionNumber: number;
  provenanceId?: string;
  generationId?: string;
  sourceTranscriptId?: string;
  updatedAt: number;
}

interface ProposedEdit {
  targetText?: string;
  newText?: string;
  replacements?: Array<{ find: string; replaceWith: string }>;
  state: ProposalState;
}

interface MessageRow extends BaseRow {
  threadId: string;
  projectId: string;
  reportId: string;
  role: "writer" | "assistant";
  content: string;
  status: "pending" | "complete" | "error";
  proposedEdit?: ProposedEdit;
  createdAt: number;
}

interface ProposalRow extends BaseRow {
  agentThreadId: string;
  toolCallId?: string;
  promptMessageId?: string;
  messageId?: string;
  projectId: string;
  reportId: string;
  kind: "edit" | "replacements" | "references";
  targetText?: string;
  newText?: string;
  replacements?: Array<{ find: string; replaceWith: string }>;
  researchSessionId?: string;
  requireUniqueTarget?: boolean;
  wordingEditedBy?: string;
  wordingEditedAt?: number;
  wordingEditCount?: number;
  state: ProposalState;
  createdAt: number;
}

interface ThreadRow extends BaseRow {
  projectId: string;
  reportId: string;
  agentThreadId?: string;
}

interface TurnRow extends BaseRow {
  agentThreadId: string;
  promptMessageId: string;
  order: number;
  status: "queued" | "running" | "completed" | "failed" | "aborted";
  stepCount: number;
}

interface AuditRow extends BaseRow {
  projectId: string;
  contentHash?: string;
  generationId?: string;
  sourceTranscriptId?: string;
}

interface SnapshotRow extends BaseRow {
  projectId: string;
  reportId: string;
  content: string;
  contentHash: string;
  provenanceId?: string;
  generationId?: string;
  sourceTranscriptId?: string;
  sourceRevisionNumber: number;
  reason: string;
  label?: string;
  researchSessionId?: string;
  researchSourceCount?: number;
  createdByRole: string;
  createdAt: number;
}

interface ResearchSessionRow extends BaseRow {
  evidenceSourceCount?: number;
}

interface ProposalWordingEditEventRow extends BaseRow {
  projectId: string;
  reportId: string;
  proposalId: string;
  userId: string;
  originalText: string;
  editedText: string;
  createdAt: number;
}

interface TestTables {
  users: UserRow[];
  projects: ProjectRow[];
  reports: ReportRow[];
  chatThreads: ThreadRow[];
  agentChatThreads: ThreadRow[];
  chatTurns: TurnRow[];
  chatMessages: MessageRow[];
  chatProposals: ProposalRow[];
  reportSnapshots: SnapshotRow[];
  researchSessions: ResearchSessionRow[];
  proposalWordingEditEvents: ProposalWordingEditEventRow[];
  reportProvenance: AuditRow[];
  generations: AuditRow[];
  transcripts: AuditRow[];
}

type TestRow = TestTables[keyof TestTables][number];
type IndexQuery = {
  eq: (field: string, value: unknown) => IndexQuery;
  gte: (field: string, value: number) => IndexQuery;
  lte: (field: string, value: number) => IndexQuery;
};

class QueryBuilder {
  constructor(private rows: TestRow[]) {}

  withIndex(_indexName: string, build: (query: IndexQuery) => IndexQuery) {
    const predicates: Array<(row: TestRow) => boolean> = [];
    const query: IndexQuery = {
      eq: (field, value) => {
        predicates.push((row) => Reflect.get(row, field) === value);
        return query;
      },
      gte: (field, value) => {
        predicates.push((row) => {
          const fieldValue = Reflect.get(row, field);
          return typeof fieldValue === "number" && fieldValue >= value;
        });
        return query;
      },
      lte: (field, value) => {
        predicates.push((row) => {
          const fieldValue = Reflect.get(row, field);
          return typeof fieldValue === "number" && fieldValue <= value;
        });
        return query;
      },
    };
    build(query);
    this.rows = this.rows.filter((row) =>
      predicates.every((predicate) => predicate(row))
    );
    return this;
  }

  order(direction: "asc" | "desc") {
    this.rows.sort((left, right) =>
      direction === "asc"
        ? left._creationTime - right._creationTime
        : right._creationTime - left._creationTime
    );
    return this;
  }

  async collect() {
    return [...this.rows];
  }

  async take(limit: number) {
    return this.rows.slice(0, limit);
  }

  async first() {
    return this.rows[0] ?? null;
  }

  async unique() {
    if (this.rows.length > 1) throw new Error("Query was not unique");
    return this.rows[0] ?? null;
  }
}

class FakeDb {
  private nextId = 1;
  private readonly rowsByTable: TestRow[][];

  constructor(readonly tables: TestTables) {
    this.rowsByTable = [
      tables.users,
      tables.projects,
      tables.reports,
      tables.chatThreads,
      tables.agentChatThreads,
      tables.chatTurns,
      tables.chatMessages,
      tables.chatProposals,
      tables.reportSnapshots,
      tables.researchSessions,
      tables.proposalWordingEditEvents,
      tables.reportProvenance,
      tables.generations,
      tables.transcripts,
    ];
  }

  async get(id: string) {
    for (const rows of this.rowsByTable) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return row;
    }
    return null;
  }

  query(table: keyof TestTables) {
    return new QueryBuilder([...this.tables[table]]);
  }

  async insert(table: keyof TestTables, value: Record<string, unknown>) {
    const _id = `${table}:inserted-${this.nextId++}`;
    const _creationTime = Date.now() + this.nextId;
    if (table === "reportSnapshots") {
      const snapshot = { _id, _creationTime, ...value } as unknown as SnapshotRow;
      this.tables.reportSnapshots.push(snapshot);
      return _id;
    }
    if (table === "chatMessages") {
      const message = { _id, _creationTime, ...value } as unknown as MessageRow;
      this.tables.chatMessages.push(message);
      return _id;
    }
    if (table === "chatProposals") {
      const proposal = { _id, _creationTime, ...value } as unknown as ProposalRow;
      this.tables.chatProposals.push(proposal);
      return _id;
    }
    if (table === "proposalWordingEditEvents") {
      const event = {
        _id,
        _creationTime,
        ...value,
      } as unknown as ProposalWordingEditEventRow;
      this.tables.proposalWordingEditEvents.push(event);
      return _id;
    }
    throw new Error(`Unexpected insert into ${table}`);
  }

  async patch(id: string, value: Record<string, unknown>) {
    const row = await this.get(id);
    if (!row) throw new Error(`Cannot patch missing row ${id}`);
    Object.assign(row, value);
  }

  async delete(id: string) {
    for (const rows of this.rowsByTable) {
      const index = rows.findIndex((row) => row._id === id);
      if (index >= 0) {
        rows.splice(index, 1);
        return;
      }
    }
  }
}

interface TestContext {
  auth: {
    getUserIdentity: () => Promise<{ subject: string } | null>;
  };
  db: FakeDb;
}

interface RegisteredHandler<TArgs, TResult> {
  _handler: (ctx: TestContext, args: TArgs) => Promise<TResult>;
}

// Convex registrations expose `_handler` at runtime specifically for focused
// function tests, but the generated public function type intentionally hides it.
const v2ApplyRegistration = applyProposal as unknown as RegisteredHandler<
  { proposalId: string },
  | { applied: true; count: number; alreadyApplied?: true }
  | { applied: false; count: 0; reason: string }
>;
const v2ListRegistration = listProposals as unknown as RegisteredHandler<
  { threadId: string },
  TestRow[]
>;
const v2RejectRegistration = rejectProposal as unknown as RegisteredHandler<
  { proposalId: string },
  void
>;
const v2UpdateWordingRegistration = updateProposalWording as unknown as RegisteredHandler<
  {
    proposalId: string;
    newText?: string;
    replacements?: Array<{ find: string; replaceWith: string }>;
  },
  { updated: boolean }
>;
const v2SaveRegistration = saveProposal as unknown as RegisteredHandler<
  {
    agentThreadId: string;
    toolCallId?: string;
    promptMessageId?: string;
    messageId?: string;
    kind: "edit" | "replacements" | "references";
    targetText?: string;
    newText?: string;
    replacements?: Array<{ find: string; replaceWith: string }>;
    references?: string[];
  },
  { ok: true; proposalId: string } | { ok: false; reason: string }
>;

const v2Apply = v2ApplyRegistration._handler;
const v2List = v2ListRegistration._handler;
const v2Reject = v2RejectRegistration._handler;
const v2UpdateWording = v2UpdateWordingRegistration._handler;
const v2Save = v2SaveRegistration._handler;

interface Fixture {
  ctx: TestContext;
  db: FakeDb;
  pinnedReport: ReportRow;
  latestReport: ReportRow;
  message: MessageRow;
  proposal: ProposalRow;
  originalContent: string;
  originalHash: string;
  provenanceId: string;
  generationId: string;
  transcriptId: string;
}

async function createFixture(role: Role, userId = "reviewer"): Promise<Fixture> {
  const projectId = "project";
  const ownerId = "owner";
  const reportId = "report:pinned";
  const latestReportId = "report:latest";
  const generationId = "generation";
  const transcriptId = "transcript";
  const provenanceId = "provenance";
  const originalContent = JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Replace the exact target." }],
      },
    ],
  });
  const originalHash = await sha256(originalContent);
  const pinnedReport: ReportRow = {
    _id: reportId,
    _creationTime: 10,
    projectId,
    content: originalContent,
    contentHash: originalHash,
    revisionNumber: 7,
    provenanceId,
    generationId,
    sourceTranscriptId: transcriptId,
    updatedAt: 10,
  };
  const latestReport: ReportRow = {
    _id: latestReportId,
    _creationTime: 20,
    projectId,
    content: "LATEST REPORT MUST REMAIN UNCHANGED",
    contentHash: "latest-hash",
    revisionNumber: 2,
    updatedAt: 20,
  };
  const message: MessageRow = {
    _id: "message",
    _creationTime: 30,
    threadId: "legacy-thread",
    projectId,
    reportId,
    role: "assistant",
    content: "I suggest a change.",
    status: "complete",
    proposedEdit: {
      targetText: "exact target",
      newText: "approved replacement",
      state: "pending",
    },
    createdAt: 30,
  };
  const proposal: ProposalRow = {
    _id: "proposal",
    _creationTime: 30,
    agentThreadId: "agent-thread",
    promptMessageId: "prompt-message",
    projectId,
    reportId,
    kind: "edit",
    targetText: "exact target",
    newText: "approved replacement",
    state: "pending",
    createdAt: 30,
  };
  const user: UserRow = {
    _id: userId,
    _creationTime: 1,
    role,
    authId: `auth-${userId}`,
  };
  const tables: TestTables = {
    users: [user],
    projects: [{ _id: projectId, _creationTime: 1, createdBy: ownerId }],
    reports: [pinnedReport, latestReport],
    chatThreads: [
      {
        _id: "legacy-thread",
        _creationTime: 1,
        projectId,
        reportId,
      },
    ],
    agentChatThreads: [
      {
        _id: "agent-thread-row",
        _creationTime: 1,
        agentThreadId: "agent-thread",
        projectId,
        reportId,
      },
    ],
    chatTurns: [
      {
        _id: "chat-turn",
        _creationTime: 29,
        agentThreadId: "agent-thread",
        promptMessageId: "prompt-message",
        order: 0,
        status: "completed",
        stepCount: 0,
      },
    ],
    chatMessages: [message],
    chatProposals: [proposal],
    reportSnapshots: [],
    researchSessions: [],
    proposalWordingEditEvents: [],
    reportProvenance: [
      {
        _id: provenanceId,
        _creationTime: 1,
        projectId,
        contentHash: originalHash,
        generationId,
        sourceTranscriptId: transcriptId,
      },
    ],
    generations: [{ _id: generationId, _creationTime: 1, projectId }],
    transcripts: [{ _id: transcriptId, _creationTime: 1, projectId }],
  };
  const db = new FakeDb(tables);
  const ctx: TestContext = {
    auth: {
      getUserIdentity: async () => ({ subject: `auth-${userId}` }),
    },
    db,
  };
  return {
    ctx,
    db,
    pinnedReport,
    latestReport,
    message,
    proposal,
    originalContent,
    originalHash,
    provenanceId,
    generationId,
    transcriptId,
  };
}

async function applyAndAssert(role: Role = "manager", userId = "reviewer") {
  const fixture = await createFixture(role, userId);
  const result = await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });

  expect(result).toEqual({ applied: true, count: 1 });
  expect(fixture.pinnedReport.content).toContain("approved replacement");
  expect(fixture.pinnedReport.content).not.toContain("exact target");
  expect(fixture.pinnedReport.revisionNumber).toBe(8);
  expect(fixture.pinnedReport.contentHash).toBe(
    await sha256(fixture.pinnedReport.content)
  );
  expect(fixture.pinnedReport.provenanceId).toBeUndefined();
  expect(fixture.latestReport.content).toBe("LATEST REPORT MUST REMAIN UNCHANGED");
  expect(fixture.latestReport.revisionNumber).toBe(2);
  expect(fixture.proposal.state).toBe("applied");
  expect(fixture.db.tables.reportSnapshots).toHaveLength(1);
  expect(fixture.db.tables.reportSnapshots[0]).toMatchObject({
    projectId: fixture.pinnedReport.projectId,
    reportId: fixture.pinnedReport._id,
    content: fixture.originalContent,
    contentHash: fixture.originalHash,
    provenanceId: fixture.provenanceId,
    generationId: fixture.generationId,
    sourceTranscriptId: fixture.transcriptId,
    sourceRevisionNumber: 7,
    reason: "pre_chat_edit",
    label: "Before AI edit",
    createdByRole: "system",
  });
}

describe("proposal access", () => {
  test.each(["manager", "admin"] as const)(
    "allows an internal %s to query proposals",
    async (role) => {
      const fixture = await createFixture(role);

      await expect(
        v2List(fixture.ctx, { threadId: "agent-thread" })
      ).resolves.toHaveLength(1);
    }
  );

  test("allows an unrelated authenticated writer to query proposals", async () => {
    const fixture = await createFixture("writer", "unrelated-writer");

    await expect(
      v2List(fixture.ctx, { threadId: "agent-thread" })
    ).resolves.toHaveLength(1);
  });

  test("rejects an anonymous proposal reader", async () => {
    const fixture = await createFixture("writer");
    fixture.ctx.auth.getUserIdentity = async () => null;

    await expect(
      v2List(fixture.ctx, { threadId: "agent-thread" })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
  });
});

describe("proposal creation integrity", () => {
  test("rejects a target copied from an unapplied candidate", async () => {
    const fixture = await createFixture("manager");

    const result = await v2Save(fixture.ctx, {
      agentThreadId: "agent-thread",
      toolCallId: "tool-invalid",
      kind: "edit",
      targetText: "This wording existed only in a rejected suggestion.",
      newText: "A refined version of rejected wording.",
    });

    expect(result).toMatchObject({ ok: false });
    expect(fixture.db.tables.chatProposals).toHaveLength(1);
  });

  test("stores tool association and enforces uniqueness for a valid edit", async () => {
    const fixture = await createFixture("manager");

    const result = await v2Save(fixture.ctx, {
      agentThreadId: "agent-thread",
      toolCallId: "tool-valid",
      promptMessageId: "prompt-message",
      kind: "edit",
      targetText: "exact target",
      newText: "approved replacement",
    });

    expect(result).toMatchObject({ ok: true });
    expect(fixture.db.tables.chatProposals.at(-1)).toMatchObject({
      toolCallId: "tool-valid",
      promptMessageId: "prompt-message",
      requireUniqueTarget: true,
      state: "pending",
    });
  });

  test("deduplicates repeated tool execution", async () => {
    const fixture = await createFixture("manager");
    const args = {
      agentThreadId: "agent-thread",
      toolCallId: "tool-repeat",
      kind: "edit" as const,
      targetText: "exact target",
      newText: "approved replacement",
    };

    const first = await v2Save(fixture.ctx, args);
    const second = await v2Save(fixture.ctx, args);

    expect(second).toEqual(first);
    expect(
      fixture.db.tables.chatProposals.filter((row) => row.toolCallId === "tool-repeat")
    ).toHaveLength(1);
  });
});

describe("proposal wording edits", () => {
  test("updates candidate wording without changing the canonical target", async () => {
    const fixture = await createFixture("manager");

    await expect(
      v2UpdateWording(fixture.ctx, {
        proposalId: fixture.proposal._id,
        newText: "writer-polished replacement",
      })
    ).resolves.toEqual({ updated: true });

    expect(fixture.proposal.targetText).toBe("exact target");
    expect(fixture.proposal.newText).toBe("writer-polished replacement");
    expect(fixture.db.tables.proposalWordingEditEvents).toHaveLength(1);
    expect(fixture.db.tables.proposalWordingEditEvents[0]).toMatchObject({
      proposalId: fixture.proposal._id,
      originalText: "approved replacement",
      editedText: "writer-polished replacement",
    });
  });

  test("refuses to change replacement targets", async () => {
    const fixture = await createFixture("manager");
    fixture.proposal.kind = "replacements";
    fixture.proposal.targetText = undefined;
    fixture.proposal.newText = undefined;
    fixture.proposal.replacements = [
      { find: "exact target", replaceWith: "approved replacement" },
    ];

    await expect(
      v2UpdateWording(fixture.ctx, {
        proposalId: fixture.proposal._id,
        replacements: [
          { find: "different target", replaceWith: "writer wording" },
        ],
      })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
  });
});

describe("proposal apply integrity", () => {
  test("apply updates the pinned report and complete audit tuple", async () => {
    await applyAndAssert();
  });

  test("a researched V2 edit keeps its evidence session on the version checkpoint", async () => {
    const fixture = await createFixture("manager");
    fixture.proposal.researchSessionId = "research-session";
    // The research layer computed the brain-excluded evidence count at review
    // time; apply just copies it onto the checkpoint.
    fixture.db.tables.researchSessions.push({
      _id: "research-session",
      _creationTime: 1,
      evidenceSourceCount: 2,
    });

    await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });

    expect(fixture.db.tables.reportSnapshots[0]).toMatchObject({
      label: "Before researched edit",
      researchSessionId: "research-session",
      researchSourceCount: 2,
    });
  });

  test.each([
    ["requireUniqueTarget flag", { requireUniqueTarget: true }],
    // Research proposals created before the flag existed still gate on origin.
    ["legacy researchSessionId fallback", { researchSessionId: "research-session" }],
  ] as const)(
    "a single-target proposal (%s) never replaces an ambiguous repeated passage",
    async (_label, fields) => {
      const fixture = await createFixture("manager");
      Object.assign(fixture.proposal, fields);
      const parsed = JSON.parse(fixture.pinnedReport.content) as {
        content: Array<Record<string, unknown>>;
      };
      parsed.content.push({
        type: "paragraph",
        content: [{ type: "text", text: "A second exact target appears here." }],
      });
      fixture.pinnedReport.content = JSON.stringify(parsed);

      await expect(
        v2Apply(fixture.ctx, { proposalId: fixture.proposal._id })
      ).rejects.toMatchObject({ data: { code: "STALE_REVISION" } });

      expect(fixture.pinnedReport.content).toContain("exact target");
      expect(fixture.db.tables.reportSnapshots).toEqual([]);
      expect(fixture.proposal.state).toBe("pending");
    }
  );

  test("a missing target becomes stale and cannot be retried", async () => {
    const fixture = await createFixture("manager");
    fixture.proposal.targetText = "wording that is absent";

    const result = await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });

    expect(result).toMatchObject({ applied: false, count: 0 });
    expect(fixture.proposal.state).toBe("stale");
    expect(fixture.db.tables.reportSnapshots).toEqual([]);
    await expect(
      v2Apply(fixture.ctx, { proposalId: fixture.proposal._id })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
  });

  test("applying an already-applied proposal is idempotent", async () => {
    const fixture = await createFixture("manager");
    await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });
    const revision = fixture.pinnedReport.revisionNumber;
    const snapshots = fixture.db.tables.reportSnapshots.length;

    const retry = await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });

    expect(retry).toMatchObject({ applied: true, alreadyApplied: true, count: 0 });
    expect(fixture.pinnedReport.revisionNumber).toBe(revision);
    expect(fixture.db.tables.reportSnapshots).toHaveLength(snapshots);
  });

  test("apply preserves deletion-only replacement behavior", async () => {
    const fixture = await createFixture("manager");
    fixture.proposal.newText = "";

    const result = await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });

    expect(result.count).toBe(1);
    expect(fixture.pinnedReport.content).not.toContain("exact target");
    expect(fixture.pinnedReport.revisionNumber).toBe(8);
  });

  test("apply preserves ordered replacement-list behavior", async () => {
    const fixture = await createFixture("manager");
    fixture.proposal.kind = "replacements";
    fixture.proposal.replacements = [
      { find: "Replace the", replaceWith: "update this" },
      { find: "exact target", replaceWith: "approved replacement" },
    ];

    const result = await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });

    expect(result.count).toBe(2);
    expect(fixture.pinnedReport.content).toContain(
      "Update this approved replacement."
    );
    expect(fixture.pinnedReport.revisionNumber).toBe(8);
  });

  test("apply allows an unrelated authenticated writer and preserves revision audit integrity", async () => {
    await applyAndAssert("writer", "unrelated-writer");
  });

  test("an anonymous caller cannot apply a proposal", async () => {
    const fixture = await createFixture("writer");
    fixture.ctx.auth.getUserIdentity = async () => null;

    await expect(
      v2Apply(fixture.ctx, { proposalId: fixture.proposal._id })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    expect(fixture.pinnedReport.content).toBe(fixture.originalContent);
    expect(fixture.pinnedReport.contentHash).toBe(fixture.originalHash);
    expect(fixture.pinnedReport.revisionNumber).toBe(7);
    expect(fixture.db.tables.reportSnapshots).toEqual([]);
  });
});

describe("proposal rejection", () => {
  test("an internal manager can reject a proposal", async () => {
    const fixture = await createFixture("manager");

    await v2Reject(fixture.ctx, { proposalId: fixture.proposal._id });

    expect(fixture.proposal.state).toBe("rejected");
  });

  test("an unrelated authenticated writer can reject a proposal", async () => {
    const fixture = await createFixture("writer", "unrelated-writer");

    await v2Reject(fixture.ctx, { proposalId: fixture.proposal._id });

    expect(fixture.proposal.state).toBe("rejected");
  });

  test("an anonymous caller cannot reject a proposal", async () => {
    const fixture = await createFixture("writer");
    fixture.ctx.auth.getUserIdentity = async () => null;

    await expect(
      v2Reject(fixture.ctx, { proposalId: fixture.proposal._id })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    expect(fixture.proposal.state).toBe("pending");
  });
});
