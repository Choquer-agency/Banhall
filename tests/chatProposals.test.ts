import { describe, expect, test } from "bun:test";
import {
  applyProposal,
  listProposals,
  rejectProposal,
} from "../convex/chatV2";
import { sha256 } from "../convex/lib/contracts";

type Role = "writer" | "manager" | "admin";
type ProposalState = "pending" | "applied" | "rejected";

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
  projectId: string;
  reportId: string;
  kind: "edit" | "replacements" | "references";
  targetText?: string;
  newText?: string;
  replacements?: Array<{ find: string; replaceWith: string }>;
  researchSessionId?: string;
  requireUniqueTarget?: boolean;
  state: ProposalState;
  createdAt: number;
}

interface ThreadRow extends BaseRow {
  projectId: string;
  reportId: string;
  agentThreadId?: string;
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

interface TestTables {
  users: UserRow[];
  projects: ProjectRow[];
  reports: ReportRow[];
  chatThreads: ThreadRow[];
  agentChatThreads: ThreadRow[];
  chatMessages: MessageRow[];
  chatProposals: ProposalRow[];
  reportSnapshots: SnapshotRow[];
  researchSessions: ResearchSessionRow[];
  reportProvenance: AuditRow[];
  generations: AuditRow[];
  transcripts: AuditRow[];
}

type TestRow = TestTables[keyof TestTables][number];
type IndexClause = { field: string; value: unknown };

class QueryBuilder {
  constructor(private rows: TestRow[]) {}

  withIndex(
    _indexName: string,
    build: (query: { eq: (field: string, value: unknown) => IndexClause }) => IndexClause
  ) {
    const clause = build({ eq: (field, value) => ({ field, value }) });
    this.rows = this.rows.filter(
      (row) => Reflect.get(row, clause.field) === clause.value
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
      tables.chatMessages,
      tables.chatProposals,
      tables.reportSnapshots,
      tables.researchSessions,
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
  { applied: true; count: number }
>;
const v2ListRegistration = listProposals as unknown as RegisteredHandler<
  { threadId: string },
  TestRow[]
>;
const v2RejectRegistration = rejectProposal as unknown as RegisteredHandler<
  { proposalId: string },
  void
>;

const v2Apply = v2ApplyRegistration._handler;
const v2List = v2ListRegistration._handler;
const v2Reject = v2RejectRegistration._handler;

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
    chatMessages: [message],
    chatProposals: [proposal],
    reportSnapshots: [],
    researchSessions: [],
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

  test("hides proposals from an anonymous caller", async () => {
    const fixture = await createFixture("writer");
    fixture.ctx.auth.getUserIdentity = async () => null;

    await expect(
      v2List(fixture.ctx, { threadId: "agent-thread" })
    ).resolves.toEqual([]);
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
