import { describe, expect, test } from "bun:test";
import {
  applyProposedEdit,
  listMessages,
  rejectProposedEdit,
} from "../convex/chat";
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
  createdByRole: string;
  createdAt: number;
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
const legacyApplyRegistration = applyProposedEdit as unknown as RegisteredHandler<
  { messageId: string },
  { applied: true; count: number }
>;
const legacyListRegistration = listMessages as unknown as RegisteredHandler<
  { threadId: string },
  TestRow[]
>;
const legacyRejectRegistration = rejectProposedEdit as unknown as RegisteredHandler<
  { messageId: string },
  void
>;
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

const legacyApply = legacyApplyRegistration._handler;
const legacyList = legacyListRegistration._handler;
const legacyReject = legacyRejectRegistration._handler;
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
  const user: UserRow = { _id: userId, _creationTime: 1, role };
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
      getUserIdentity: async () => ({ subject: `${userId}|test-session` }),
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

async function applyAndAssert(
  kind: "legacy" | "v2",
  role: Role = "manager",
  userId = "reviewer"
) {
  const fixture = await createFixture(role, userId);
  const result =
    kind === "legacy"
      ? await legacyApply(fixture.ctx, { messageId: fixture.message._id })
      : await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });

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
  expect(fixture.message.proposedEdit?.state).toBe(
    kind === "legacy" ? "applied" : "pending"
  );
  expect(fixture.proposal.state).toBe(kind === "v2" ? "applied" : "pending");
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
    "allows an internal %s to query both proposal pipelines",
    async (role) => {
      const fixture = await createFixture(role);

      await expect(
        legacyList(fixture.ctx, { threadId: "legacy-thread" })
      ).resolves.toHaveLength(1);
      await expect(
        v2List(fixture.ctx, { threadId: "agent-thread" })
      ).resolves.toHaveLength(1);
    }
  );

  test("allows an unrelated authenticated writer to query both proposal pipelines", async () => {
    const fixture = await createFixture("writer", "unrelated-writer");

    await expect(
      legacyList(fixture.ctx, { threadId: "legacy-thread" })
    ).resolves.toHaveLength(1);
    await expect(
      v2List(fixture.ctx, { threadId: "agent-thread" })
    ).resolves.toHaveLength(1);
  });

  test("hides both proposal pipelines from an anonymous caller", async () => {
    const fixture = await createFixture("writer");
    fixture.ctx.auth.getUserIdentity = async () => null;

    await expect(
      legacyList(fixture.ctx, { threadId: "legacy-thread" })
    ).resolves.toEqual([]);
    await expect(
      v2List(fixture.ctx, { threadId: "agent-thread" })
    ).resolves.toEqual([]);
  });
});

describe("proposal apply integrity", () => {
  test("legacy apply updates the pinned report and complete audit tuple", async () => {
    await applyAndAssert("legacy");
  });

  test("V2 apply updates the pinned report and complete audit tuple", async () => {
    await applyAndAssert("v2");
  });

  test.each(["legacy", "v2"] as const)(
    "%s apply preserves deletion-only replacement behavior",
    async (kind) => {
      const fixture = await createFixture("manager");
      if (!fixture.message.proposedEdit) {
        throw new Error("Legacy proposal fixture is missing its edit");
      }
      fixture.message.proposedEdit.newText = "";
      fixture.proposal.newText = "";

      const result =
        kind === "legacy"
          ? await legacyApply(fixture.ctx, { messageId: fixture.message._id })
          : await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });

      expect(result.count).toBe(1);
      expect(fixture.pinnedReport.content).not.toContain("exact target");
      expect(fixture.pinnedReport.revisionNumber).toBe(8);
    }
  );

  test.each(["legacy", "v2"] as const)(
    "%s apply preserves ordered replacement-list behavior",
    async (kind) => {
      const fixture = await createFixture("manager");
      const replacements = [
        { find: "Replace the", replaceWith: "update this" },
        { find: "exact target", replaceWith: "approved replacement" },
      ];
      if (!fixture.message.proposedEdit) {
        throw new Error("Legacy proposal fixture is missing its edit");
      }
      fixture.message.proposedEdit.replacements = replacements;
      fixture.proposal.kind = "replacements";
      fixture.proposal.replacements = replacements;

      const result =
        kind === "legacy"
          ? await legacyApply(fixture.ctx, { messageId: fixture.message._id })
          : await v2Apply(fixture.ctx, { proposalId: fixture.proposal._id });

      expect(result.count).toBe(2);
      expect(fixture.pinnedReport.content).toContain(
        "Update this approved replacement."
      );
      expect(fixture.pinnedReport.revisionNumber).toBe(8);
    }
  );

  test.each(["legacy", "v2"] as const)(
    "%s apply allows an unrelated authenticated writer and preserves revision audit integrity",
    async (kind) => {
      await applyAndAssert(kind, "writer", "unrelated-writer");
    }
  );

  test("an anonymous caller cannot apply either proposal shape", async () => {
    const fixture = await createFixture("writer");
    fixture.ctx.auth.getUserIdentity = async () => null;

    await expect(
      legacyApply(fixture.ctx, { messageId: fixture.message._id })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
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
  test("an internal manager can reject through both existing callback paths", async () => {
    const legacyFixture = await createFixture("manager");
    const v2Fixture = await createFixture("manager");

    await legacyReject(legacyFixture.ctx, { messageId: legacyFixture.message._id });
    await v2Reject(v2Fixture.ctx, { proposalId: v2Fixture.proposal._id });

    expect(legacyFixture.message.proposedEdit?.state).toBe("rejected");
    expect(legacyFixture.db.tables.chatMessages).toHaveLength(2);
    expect(v2Fixture.proposal.state).toBe("rejected");
    expect(v2Fixture.db.tables.chatMessages).toHaveLength(1);
  });

  test("an unrelated authenticated writer can reject through both pipelines", async () => {
    const legacyFixture = await createFixture("writer", "unrelated-writer");
    const v2Fixture = await createFixture("writer", "unrelated-writer");

    await legacyReject(legacyFixture.ctx, { messageId: legacyFixture.message._id });
    await v2Reject(v2Fixture.ctx, { proposalId: v2Fixture.proposal._id });

    expect(legacyFixture.message.proposedEdit?.state).toBe("rejected");
    expect(legacyFixture.db.tables.chatMessages).toHaveLength(2);
    expect(v2Fixture.proposal.state).toBe("rejected");
    expect(v2Fixture.db.tables.chatMessages).toHaveLength(1);
  });

  test("an anonymous caller cannot reject through either pipeline", async () => {
    const fixture = await createFixture("writer");
    fixture.ctx.auth.getUserIdentity = async () => null;

    await expect(
      legacyReject(fixture.ctx, { messageId: fixture.message._id })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    await expect(
      v2Reject(fixture.ctx, { proposalId: fixture.proposal._id })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    expect(fixture.message.proposedEdit?.state).toBe("pending");
    expect(fixture.proposal.state).toBe("pending");
  });
});
