import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PD_SUBSECTIONS } from "../shared/pdSubsections";
import { isReleaseEvalProjectTitle, releaseEvalProjectTitle } from "../shared/releaseEval";
import {
  SEMANTIC_CASES,
  buildPlan,
  chooseExclusion,
  contentWordOverlap,
  deploymentRefusal,
  describeStep,
  droppedUncertaintyHits,
  figuresOf,
  distribution,
  emptyRunLog,
  exclusionBullet,
  experimentsCoveringUncertainties,
  formatWait,
  rateLimitBudget,
  rateLimitRetryAfterMs,
  waitOutRateLimits,
  latencySamples,
  linkedAdvancements,
  notCheckedCounts,
  loadFixtures,
  parseArgs,
  parseConvexError,
  renderFixturePack,
  renderSummary,
  rerenderResults,
  reservePackDir,
  runChecks,
  runFixture,
  seedRequestCount,
  testedUncertaintyCount,
  usageCost,
  validateFixture,
  writePack,
  RATE_LIMIT_MARGIN_MS,
  type Collected,
  type EvalDriver,
  type Fixture,
  type RunLog,
} from "../scripts/seed-plan-eval/eval";

/**
 * The release-blocking semantic suite (Step by step, CAP-13): the fixtures,
 * the scripted sessions, the deployment guard, the automatic checks, the
 * CAP-14 figures and the judging pack. The real run needs a deployment and
 * paid model calls, so only the pure parts are exercised here.
 */
const FIXTURES = path.join(process.cwd(), "scripts/seed-plan-eval/fixtures");
const fixtures = loadFixtures(FIXTURES);
const byCase = (semanticCase: keyof typeof SEMANTIC_CASES) =>
  fixtures.find((fixture) => fixture.semanticCase === semanticCase) as Fixture;

const DASHES = /[\u2013\u2014]/;

describe("fixtures", () => {
  it("has one valid fixture per semantic case CAP-13 names", () => {
    expect(fixtures.map((fixture) => fixture.semanticCase).sort()).toEqual(Object.keys(SEMANTIC_CASES).sort());
    for (const fixture of fixtures) {
      expect({ id: fixture.id, problems: validateFixture(fixture) }).toEqual({ id: fixture.id, problems: [] });
    }
  });

  it("keeps every source file plain ASCII", () => {
    for (const fixture of fixtures) {
      for (const file of readdirSync(fixture.dir)) {
        expect(/[^\x00-\x7F]/.test(readFileSync(path.join(fixture.dir, file), "utf8")), `${fixture.id}/${file}`).toBe(false);
      }
    }
  });

  it("refuses a fixture that breaks the rules", () => {
    const base = byCase("carried_old_selections");
    const transcript = base.sources[0].file;
    const broken: Fixture = {
      ...base,
      fictional: false,
      params: { ...base.params, editSentence: "No term here." },
      texts: { ...base.texts, [transcript]: `${base.texts[transcript]} The cascade-fired lattice \u2014 again.` },
    };
    const problems = validateFixture(broken);
    expect(problems).toContain("fictional must be true (never real client data)");
    expect(problems).toContain("sources contain an em or en dash; use a plain hyphen");
    expect(problems).toContain('"cascade-fired" must not appear in the sources');
    expect(problems).toContain('"cascade-fired lattice" must not appear in the sources');
    expect(problems).toContain("params.editSentence must contain params.editedTerm");

    const short: Fixture = { ...base, texts: Object.fromEntries(Object.keys(base.texts).map((file) => [file, "Too short."])) };
    expect(validateFixture(short).some((problem) => problem.includes("a fixture needs at least"))).toBe(true);

    const skip = byCase("skipped_role_supported");
    expect(validateFixture({ ...skip, params: { ...skip.params, skipRole: "hypothesis" } })).toContain(
      "params.skipRole must be a optional Subsection",
    );
    const feedback = byCase("withdrawn_feedback");
    expect(validateFixture({ ...feedback, params: { ...feedback.params, withdrawnInstruction: "x".repeat(301) } })).toContain(
      "params.withdrawnInstruction exceeds 300 characters",
    );
  });
});

describe("scripted sessions", () => {
  it("decides every Subsection and ends with sign-off", () => {
    for (const fixture of fixtures) {
      const plan = buildPlan(fixture);
      expect(plan.at(-1)).toEqual({ op: "signOff" });
      for (const role of PD_SUBSECTIONS) {
        const decided = plan.some((step) => (step.op === "approve" || step.op === "skip") && step.role === role.roleId);
        expect(decided, `${fixture.id} decides ${role.roleId}`).toBe(true);
      }
      for (const step of plan) {
        const text = describeStep(step);
        expect(text.length).toBeGreaterThan(5);
        expect(DASHES.test(text)).toBe(false);
      }
    }
  });

  it("scripts each semantic case", () => {
    const carried = buildPlan(byCase("carried_old_selections")).map((step) => step.op);
    expect(carried.indexOf("switchSelection")).toBeLessThan(carried.indexOf("regenerate"));
    expect(carried).toContain("reapproveStale");

    const skipped = buildPlan(byCase("skipped_role_supported"));
    const openAt = skipped.findIndex((step) => step.op === "open" && step.role === "prior_year_status");
    const skipAt = skipped.findIndex((step) => step.op === "skip" && step.role === "prior_year_status");
    expect(openAt).toBeGreaterThanOrEqual(0);
    expect(skipAt).toBe(openAt + 1);

    const feedback = buildPlan(byCase("withdrawn_feedback")).map((step) => step.op);
    expect(feedback.indexOf("withdrawFeedback")).toBeLessThan(feedback.indexOf("approve"));

    const exclusion = buildPlan(byCase("exclusion_conflict"));
    expect(exclusion.some((step) => step.op === "approve" && step.expect === "exclusion")).toBe(true);

    const links = buildPlan(byCase("changed_advancement_links")).map((step) => (step.op === "approve" ? `approve:${step.expect ?? ""}` : step.op));
    expect(links.indexOf("deselectMostLinkedUncertainty")).toBeLessThan(links.indexOf("approve:unlinkedRefused"));
    expect(links.indexOf("approve:unlinkedRefused")).toBeLessThan(links.indexOf("selectSharedAdvancements"));
    // 2026-09-29 (first): experiments are picked by what they tested, and the
    // ones that tested the dropped uncertainty are refused, then unticked,
    // before the advancements are fixed.
    expect(links.indexOf("selectCoveringExperiments")).toBeLessThan(links.indexOf("deselectMostLinkedUncertainty"));
    expect(
      buildPlan(byCase("changed_advancement_links")).some((step) => step.op === "select" && step.role === "experimentation"),
    ).toBe(false);
    expect(links.indexOf("deselectMostLinkedUncertainty")).toBeLessThan(links.indexOf("recordLinkNotice"));
    expect(links.indexOf("recordLinkNotice")).toBeLessThan(links.indexOf("approve:droppedRefused"));
    expect(links.lastIndexOf("recordLinkNotice")).toBeLessThan(links.indexOf("approve:unlinkedRefused"));
    expect(links.indexOf("approve:droppedRefused")).toBeLessThan(links.indexOf("deselectExperimentsForDroppedUncertainty"));
    expect(links.indexOf("deselectExperimentsForDroppedUncertainty")).toBeLessThan(links.indexOf("approve:unlinkedRefused"));
  });

  it("builds edits and picks within the server's rules", () => {
    expect(exclusionBullet("Billing portal migration to a new cloud host")).toBe(
      "The work also covered this: Billing portal migration to a new cloud host",
    );
    expect(exclusionBullet("x".repeat(700))).toHaveLength(600);
    const entries = [
      { text: "Customer training sessions", exactExcerpt: "training" },
      { text: "Moving the billing portal", exactExcerpt: "billing portal" },
    ];
    expect(chooseExclusion(entries, "billing")?.text).toBe("Moving the billing portal");
    expect(chooseExclusion(entries, "nothing")?.text).toBe("Customer training sessions");
    expect(chooseExclusion([], "billing")).toBeNull();

    const item = (seedId: string, uncertaintySeedId: string | null, experimentSeedIds: string[]) => ({
      seedId,
      batchId: "b",
      bullets: ["x"],
      selected: false,
      edited: false,
      revisionOfSeedId: null,
      feedbackRequestId: null,
      uncertaintySeedId,
      experimentSeedIds,
    });
    const picked = linkedAdvancements(
      [item("a1", "u1", ["e1"]), item("a2", "u2", ["e1"]), item("a3", "u2", ["e2"]), item("a4", "u9", ["e1"]), item("a5", "u2", ["e9"])],
      new Set(["u1", "u2"]),
      new Map([["e1", null], ["e2", null]]),
      2,
    );
    expect(picked.map((candidate) => candidate.seedId)).toEqual(["a2", "a3"]);
    // 2026-09-29 (first): an experiment that tested another uncertainty
    // cannot support the advancement (run 6: a start-up trial offered for
    // the sensor uncertainty).
    const tested = linkedAdvancements(
      [item("a1", "u3", ["e1"]), item("a2", "u2", ["e2"]), item("a3", "u2", ["e2", "e1"])],
      new Set(["u2", "u3"]),
      new Map([["e1", "u1"], ["e2", "u2"]]),
      3,
    );
    expect(tested.map((candidate) => candidate.seedId)).toEqual(["a2"]);
    // Review P2-2: a Feedback revision of an uncertainty counts as the original.
    const revised = linkedAdvancements(
      [item("a1", "u1b", ["e1"])],
      new Set(["u1b"]),
      new Map([["e1", "u1"]]),
      1,
      (seedId) => (seedId === "u1b" ? "u1" : seedId),
    );
    expect(revised.map((candidate) => candidate.seedId)).toEqual(["a1"]);
  });

  it("picks experiments by the uncertainty each tested, one for each uncertainty first", () => {
    const experiment = (seedId: string, uncertaintySeedId: string | null, selected = false) => ({
      seedId,
      batchId: "b",
      bullets: ["x"],
      selected,
      edited: false,
      revisionOfSeedId: null,
      feedbackRequestId: null,
      uncertaintySeedId,
      experimentSeedIds: [],
    });
    // Run 6's page: the first three were all start-up trials (u1).
    const page = [experiment("t1", "u1"), experiment("t2", "u1"), experiment("t3", "u1"), experiment("t4", "u2"), experiment("t5", "u3")];
    expect(experimentsCoveringUncertainties(page, ["u1", "u2", "u3"], 3).map((item) => item.seedId)).toEqual(["t1", "t4", "t5"]);
    expect(experimentsCoveringUncertainties(page, ["u1", "u2", "u3"], 4).map((item) => item.seedId)).toEqual(["t1", "t4", "t5", "t2"]);
    // Picks already made count, and an uncovered uncertainty goes first.
    const partly = [experiment("t1", "u1", true), ...page.slice(1)];
    expect(experimentsCoveringUncertainties(partly, ["u1", "u2"], 2).map((item) => item.seedId)).toEqual(["t4"]);
    // Never an experiment for an uncertainty that is not picked.
    expect(experimentsCoveringUncertainties(page, ["u2"], 3).map((item) => item.seedId)).toEqual(["t4"]);
    // Review P2-1: until coverage is met, never a second experiment for an
    // uncertainty, so a regenerated page still has slots to cover the rest.
    const startUpOnly = [experiment("t1", "u1"), experiment("t2", "u1"), experiment("t3", "u1")];
    expect(experimentsCoveringUncertainties(startUpOnly, ["u1", "u2", "u3"], 3, { extras: false }).map((item) => item.seedId)).toEqual(["t1"]);
    const regenerated = [experiment("t1", "u1", true), experiment("t4", "u2"), experiment("t6", "u2"), experiment("t5", "u3")];
    expect(experimentsCoveringUncertainties(regenerated, ["u1", "u2", "u3"], 3, { extras: false }).map((item) => item.seedId)).toEqual(["t4", "t5"]);
    expect(experimentsCoveringUncertainties([experiment("t1", "u1", true), experiment("t4", "u2", true), experiment("t6", "u2")], ["u1", "u2"], 3).map((item) => item.seedId)).toEqual(["t6"]);
    // A revision of an uncertainty is covered by an experiment of its original.
    expect(
      experimentsCoveringUncertainties([experiment("t1", "u1", true), experiment("t2", "u1")], ["u1b"], 3, { extras: false, rootOf: (id) => (id === "u1b" ? "u1" : id) }),
    ).toEqual([]);
    // Without any recorded uncertainty, the first on the page.
    expect(experimentsCoveringUncertainties([experiment("a", null), experiment("b", null)], ["u1"], 1).map((item) => item.seedId)).toEqual(["a"]);
    expect(testedUncertaintyCount([experiment("t1", "u1"), experiment("t4", "u2"), experiment("x", null)], new Set(["u1", "u2", "u3"]))).toBe(2);
    expect(testedUncertaintyCount([experiment("t1", "u1")], new Set(["u1b"]), (id) => (id === "u1b" ? "u1" : id))).toBe(1);
  });
});

describe("deployment guard", () => {
  const run = (argv: string[], env: Record<string, string | undefined> = {}) => deploymentRefusal(parseArgs(argv), env);
  const ok = ["--deployment", "local-e2e", "--as", "reviewer@example.com", "--confirm-spend"];

  it("allows a paid run only on a named local deployment with every flag", () => {
    expect(run(ok)).toBeNull();
    expect(run(["--dry-run"])).toBeNull();
    expect(run([])).toMatch(/--deployment/);
    expect(run(["--deployment", "local-e2e", "--as", "reviewer@example.com"])).toMatch(/--confirm-spend/);
    expect(run(["--deployment", "local-e2e", "--confirm-spend"])).toMatch(/--as/);
    expect(run(["--deployment", "local-e2e", "--as", "reviewer@example.com", "--cleanup"])).toBeNull();
    // The Convex CLI names the local backend plainly "local".
    expect(run(["--deployment", "local", "--as", "reviewer@example.com", "--confirm-spend"])).toBeNull();
    expect(run(["--deployment", "localhost-otter-1", "--as", "reviewer@example.com", "--confirm-spend"])).toMatch(/--allow-cloud-dev/);
  });

  it("never runs against production and needs a flag for any cloud deployment", () => {
    expect(run(["--deployment", "energized-salamander-237", "--as", "r@example.com", "--confirm-spend", "--allow-cloud-dev"])).toMatch(/production/);
    expect(run(["--deployment", "prod", "--as", "r@example.com", "--confirm-spend", "--allow-cloud-dev"])).toMatch(/production/);
    expect(run(["--deployment", "prod/banhall", "--as", "r@example.com", "--confirm-spend", "--allow-cloud-dev"])).toMatch(/production/);
    expect(run(["--deployment", "happy-otter-123", "--as", "r@example.com", "--confirm-spend"])).toMatch(/--allow-cloud-dev/);
    expect(run(["--deployment", "happy-otter-123", "--as", "r@example.com", "--confirm-spend", "--allow-cloud-dev"])).toBeNull();
    expect(run(ok, { CONVEX_DEPLOY_KEY: "prod:secret" })).toMatch(/CONVEX_DEPLOY_KEY/);
  });

  it("rejects unknown or incomplete options", () => {
    expect(() => parseArgs(["--deployment"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--yes"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["--dry-run", "--cleanup"])).toThrow(/cannot be combined/);
    expect(parseArgs(["--fixture", "a", "--fixture", "b"]).fixtures).toEqual(["a", "b"]);
  });

  it("reads the domain error out of the CLI's failure output", () => {
    const error = parseConvexError(
      'Failed to run function "seeds:approve":\nError: [Request ID: abc] Server Error\nUncaught ConvexError: {"reason":"UNLINKED_ADVANCEMENT","code":"INVALID_STATE","message":"Advancement references must be active selections"}\n    at handler (../convex/seeds.ts:726:6)\n',
    );
    expect(error.code).toBe("INVALID_STATE");
    expect(error.reason).toBe("UNLINKED_ADVANCEMENT");
    expect(error.message).toBe("Advancement references must be active selections");
    expect(parseConvexError("\u001b[31mboom\u001b[39m").code).toBeNull();
  });

  it("names every eval project with the release-eval prefix", () => {
    expect(releaseEvalProjectTitle("Corvane")).toBe("Release eval - Corvane");
    expect(isReleaseEvalProjectTitle("Release eval - Corvane")).toBe(true);
    expect(isReleaseEvalProjectTitle("Release eval - ")).toBe(false);
    expect(isReleaseEvalProjectTitle("Acme PD")).toBe(false);
  });
});

// ─── Synthetic results for the checks and the pack ─────────────────────────

function baseCollected(): Collected {
  return {
    project: { projectId: "p1", title: "Release eval - Test" },
    generation: {
      generationId: "g1",
      status: "completed",
      requestedAt: 0,
      seedRequestsReserved: 17,
      singleModelId: null,
      summaryVersionId: "sv1",
    },
    subsections: [],
    batches: [
      { batchId: "b1", roleId: "company_context", operation: "open", status: "shown", queuedAt: 1_000, startedAt: 1_100, completedAt: 9_000, roleOpen: true, startedBy: "server", requestsMade: 1, seedsDropped: 0, consumedContextRevision: "r0", feedbackRequestId: null },
      { batchId: "b2", roleId: "goal_problem", operation: "open", status: "shown", queuedAt: 20_000, startedAt: 20_100, completedAt: 30_000, roleOpen: true, startedBy: null, requestsMade: 1, seedsDropped: 0, consumedContextRevision: "r1", feedbackRequestId: null },
    ],
    seeds: [],
    feedback: [],
    batchContext: [],
    events: [
      { kind: "batchCompleted", at: 9_000, roleId: "company_context", actor: "system", batchId: "b1", seedId: null, feedbackRequestId: null, confirmed: null },
      { kind: "batchViewed", at: 9_500, roleId: "company_context", actor: "user", batchId: "b1", seedId: null, feedbackRequestId: null, confirmed: null },
      { kind: "batchCompleted", at: 30_000, roleId: "goal_problem", actor: "system", batchId: "b2", seedId: null, feedbackRequestId: null, confirmed: null },
      { kind: "batchViewed", at: 31_000, roleId: "goal_problem", actor: "user", batchId: "b2", seedId: null, feedbackRequestId: null, confirmed: null },
      { kind: "signOff", at: 100_000, roleId: null, actor: "user", batchId: null, seedId: null, feedbackRequestId: null, confirmed: null },
    ],
    summary: { summaryVersionId: "sv1", version: 1, skippedRoleIds: [], signedOffAt: 100_000, items: [] },
    complianceNotes: [],
    report: { reportId: "r1", generatedAt: 400_000, sections: { s242: "Section 242 text.", s244: "Section 244 text.", s246: "Section 246 text." } },
    briefEntries: [],
    usage: [
      { callSite: "generation:seeds:company_context", model: "claude-sonnet-5", costUsd: 0.02, inputTokens: 1, outputTokens: 1 },
      { callSite: "generation:seedFeedback:company_context", model: "claude-sonnet-5", costUsd: 0.01, inputTokens: 1, outputTokens: 1 },
      { callSite: "generation:section:242", model: "claude-sonnet-5", costUsd: 0.5, inputTokens: 1, outputTokens: 1 },
    ],
    truncated: [],
  };
}

type Item = NonNullable<Collected["summary"]>["items"][number];
const summaryItem = (itemId: string, roleId: string, seedId: string, extra: Partial<Item> = {}): Item => ({
  itemId,
  roleId,
  kind: PD_SUBSECTIONS.find((role) => role.roleId === roleId)?.kind ?? "standard",
  order: 0,
  seedId,
  bullets: ["A plain bullet."],
  support: "source_supported",
  tags: ["technical"],
  uncertaintySeedId: null,
  experimentSeedIds: [],
  confirmedExclusion: false,
  edited: false,
  ...extra,
});
const cover = (itemId: string, section: string, mergedItemIds: string[] = [itemId], extra: Partial<Collected["complianceNotes"][number]> = {}) => ({
  section,
  paragraphIndex: 0,
  source: "model",
  instruction: `Cover signed-off Summary item ${itemId}`,
  outcome: "applied",
  tier: "none",
  reason: "Covered.",
  repaired: false,
  planRef: { itemId, skippedRoleId: null, mergedItemIds },
  ...extra,
});
const status = (checks: ReturnType<typeof runChecks>, id: string) => checks.find((item) => item.id === id)?.status;

describe("automatic checks", () => {
  it("records a run that stopped early as a failed check", () => {
    const log = { ...emptyRunLog("x", 0), error: "Timed out waiting for the seed stage" };
    const checks = runChecks(byCase("skipped_role_supported"), null, log);
    expect(checks).toEqual([expect.objectContaining({ id: "run-completed", status: "fail", evidence: "Timed out waiting for the seed stage" })]);
  });

  it("checks the carried-old-selections case", () => {
    const fixture = byCase("carried_old_selections");
    const c = baseCollected();
    c.batches.push(
      { batchId: "old5", roleId: "active_uncertainties", operation: "open", status: "superseded", queuedAt: 1, startedAt: 1, completedAt: 2, roleOpen: true, startedBy: null, requestsMade: 1, seedsDropped: 0, consumedContextRevision: "r-old", feedbackRequestId: null },
      { batchId: "new5", roleId: "active_uncertainties", operation: "regenerate", status: "shown", queuedAt: 3, startedAt: 3, completedAt: 4, roleOpen: true, startedBy: null, requestsMade: 1, seedsDropped: 0, consumedContextRevision: "r-new", feedbackRequestId: null },
    );
    c.seeds.push(
      { seedId: "u1", batchId: "old5", roleId: "active_uncertainties", bullets: ["Old uncertainty."], support: "source_supported", revisionOfSeedId: null, feedbackRequestId: null, uncertaintySeedId: null, experimentSeedIds: [] },
      { seedId: "c1", batchId: "b1", roleId: "company_context", bullets: ["x"], support: "writer_asserted", revisionOfSeedId: null, feedbackRequestId: null, uncertaintySeedId: null, experimentSeedIds: [] },
    );
    c.summary!.items = [
      summaryItem("i1", "company_context", "c1", { bullets: ["They work in ceramics. The team calls the graded structure the cascade-fired lattice."], support: "writer_asserted", edited: true }),
      summaryItem("i2", "active_uncertainties", "u1"),
    ];
    c.complianceNotes = [cover("i1", "242"), cover("i2", "242")];
    c.report!.sections.s242 = "Brackenridge built what the team calls the cascade-fired lattice, a graded filter.";
    c.events.push(
      { kind: "staleOpened", at: 50, roleId: "hypothesis", actor: "system", batchId: null, seedId: null, feedbackRequestId: null, confirmed: null },
      { kind: "staleDisposed", at: 60, roleId: "hypothesis", actor: "system", batchId: null, seedId: null, feedbackRequestId: null, confirmed: null },
      { kind: "approve", at: 70, roleId: "active_uncertainties", actor: "user", batchId: null, seedId: null, feedbackRequestId: null, confirmed: true },
    );
    const log: RunLog = {
      ...emptyRunLog(fixture.id, 0),
      edits: { editedTerm: { roleId: "company_context", seedId: "c1", bullets: ["..."] } },
      approvals: [{ roleId: "active_uncertainties", at: 70, key: "carried", carriedSeedIds: ["u1"], exclusionEntryIds: [], changedRoleIds: ["goal_problem"] }],
    };
    const checks = runChecks(fixture, c, log);
    for (const id of ["run-completed", "report-created", "three-sections", "coverage-listed", "coverage-applied", "edited-term-in-plan", "edited-term-drafted", "carried-confirmed", "carried-kept", "stale-episodes", "writer-asserted-covered"]) {
      expect({ id, status: status(checks, id) }).toEqual({ id, status: "pass" });
    }
    c.report!.sections.s242 = "No sentinel here.";
    expect(status(runChecks(fixture, c, log), "edited-term-drafted")).toBe("fail");
  });

  it("checks the skipped-role case", () => {
    const fixture = byCase("skipped_role_supported");
    const c = baseCollected();
    c.batches.push({ batchId: "py", roleId: "prior_year_status", operation: "prefetch", status: "shown", queuedAt: 1, startedAt: 1, completedAt: 2, roleOpen: false, startedBy: null, requestsMade: 1, seedsDropped: 0, consumedContextRevision: "r", feedbackRequestId: null });
    c.seeds.push({ seedId: "py1", batchId: "py", roleId: "prior_year_status", bullets: ["Orion-1 held calibration for 14 days."], support: "source_supported", revisionOfSeedId: null, feedbackRequestId: null, uncertaintySeedId: null, experimentSeedIds: [] });
    c.summary!.skippedRoleIds = ["prior_year_status"];
    c.complianceNotes = [
      { section: "244", paragraphIndex: null, source: "model", instruction: "Omit signed-off role prior_year_status", outcome: "applied", tier: "none", reason: "Not covered.", repaired: false, planRef: { itemId: null, skippedRoleId: "prior_year_status", mergedItemIds: [] } },
    ];
    c.report!.sections.s244 = "This year the Orion-2 window coating was tested.";
    const checks = runChecks(fixture, c, emptyRunLog(fixture.id, 0));
    for (const id of ["skip-in-plan", "role-supported", "skip-honoured", "skip-not-drafted", "skips-listed"]) {
      expect({ id, status: status(checks, id) }).toEqual({ id, status: "pass" });
    }
    c.report!.sections.s244 = "At the end of fiscal 2025 Orion-1 drifted after 14 days.";
    expect(status(runChecks(fixture, c, emptyRunLog(fixture.id, 0)), "skip-not-drafted")).toBe("fail");
  });

  it("checks the withdrawn-feedback case", () => {
    const fixture = byCase("withdrawn_feedback");
    const c = baseCollected();
    c.feedback = [
      { feedbackRequestId: "fk", roleId: "company_context", targetSeedId: "s1", instruction: "kept", status: "active", withdrawnAt: null, batchId: "fbk" },
      { feedbackRequestId: "fw", roleId: "company_context", targetSeedId: "s2", instruction: "withdrawn", status: "withdrawn", withdrawnAt: 500, batchId: "fbw" },
    ];
    c.batches.push(
      { batchId: "fbw", roleId: "company_context", operation: "feedback", status: "shown", queuedAt: 400, startedAt: 400, completedAt: 450, roleOpen: true, startedBy: null, requestsMade: 1, seedsDropped: 0, consumedContextRevision: "r", feedbackRequestId: "fw" },
      { batchId: "b9", roleId: "experimentation", operation: "open", status: "shown", queuedAt: 900, startedAt: 900, completedAt: 950, roleOpen: true, startedBy: null, requestsMade: 1, seedsDropped: 0, consumedContextRevision: "r", feedbackRequestId: null },
    );
    c.batchContext = [
      { batchId: "fbw", roleId: "company_context", kind: "ownFeedback", sourceRoleId: "company_context", seedId: null, feedbackRequestId: "fw" },
      { batchId: "b9", roleId: "experimentation", kind: "feedback", sourceRoleId: "company_context", seedId: null, feedbackRequestId: "fk" },
    ];
    c.seeds.push(
      { seedId: "k1", batchId: "fbw", roleId: "company_context", bullets: ["The Kestrel line runs two shifts."], support: "source_supported", revisionOfSeedId: "s2", feedbackRequestId: "fw", uncertaintySeedId: null, experimentSeedIds: [] },
      { seedId: "n1", batchId: "b9", roleId: "experimentation", bullets: ["The compliant spindle held 12 N."], support: "source_supported", revisionOfSeedId: null, feedbackRequestId: null, uncertaintySeedId: null, experimentSeedIds: [] },
    );
    const log: RunLog = {
      ...emptyRunLog(fixture.id, 0),
      feedback: {
        kept: { roleId: "company_context", requestId: "fk", targetSeedId: "s1" },
        withdrawn: { roleId: "company_context", requestId: "fw", targetSeedId: "s2", withdrawnAt: 500 },
      },
    };
    const checks = runChecks(fixture, c, log);
    for (const id of ["feedback-withdrawn", "withdrawn-never-sent", "withdrawn-term-absent", "kept-feedback-reaches-9", "kept-feedback-respected-9"]) {
      expect({ id, status: status(checks, id) }).toEqual({ id, status: "pass" });
    }
    c.batchContext.push({ batchId: "b9", roleId: "experimentation", kind: "feedback", sourceRoleId: "company_context", seedId: null, feedbackRequestId: "fw" });
    expect(status(runChecks(fixture, c, log), "withdrawn-never-sent")).toBe("fail");
  });

  it("checks the exclusion case", () => {
    const fixture = byCase("exclusion_conflict");
    const c = baseCollected();
    const exclusionText = "Migration of the customer billing portal to a new cloud host";
    c.briefEntries = [{ entryId: "x1", group: "claimExclusion", text: exclusionText, reason: "routine_engineering" }];
    c.subsections = [
      { roleId: "experimentation", kind: "multiple", state: "approved", currentContextRevision: "r", approvedContextRevision: "r", approvedWithConfirmation: false, exclusionAcknowledgedAt: 123 },
    ];
    c.summary!.items = [
      summaryItem("i9", "experimentation", "e1", { confirmedExclusion: true, support: "writer_asserted", edited: true, bullets: ["Trial one.", exclusionBullet(exclusionText)] }),
      summaryItem("i12", "project_status", "p1", { support: "writer_asserted", edited: true, bullets: ["The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."] }),
    ];
    c.complianceNotes = [
      cover("i9", "244", ["i9"], { tier: "conflict", outcome: "not_applied", paragraphIndex: null, reason: "The writer confirmed a Brief Claim Exclusion conflict at sign-off." }),
      cover("i12", "246"),
    ];
    c.report!.sections.s244 = "The team also moved the customer billing portal to a new cloud host during the migration.";
    c.report!.sections.s246 = "The writer reports that a second field trial at the Ashgrove elevator is booked.";
    const log: RunLog = {
      ...emptyRunLog(fixture.id, 0),
      edits: {
        exclusion: { roleId: "experimentation", seedId: "e1", bullets: [], exclusionEntryId: "x1", exclusionText },
        writerAsserted: { roleId: "project_status", seedId: "p1", bullets: [] },
      },
      approvals: [{ roleId: "experimentation", at: 1, key: "exclusion", carriedSeedIds: [], exclusionEntryIds: ["x1"], changedRoleIds: [] }],
    };
    const checks = runChecks(fixture, c, log);
    for (const id of ["brief-exclusions", "exclusion-warned", "exclusion-in-plan", "conflict-recorded", "exclusion-drafted", "writer-asserted-in-plan", "writer-asserted-covered", "coverage-applied"]) {
      expect({ id, status: status(checks, id) }).toEqual({ id, status: "pass" });
    }
    expect(checks.find((item) => item.id === "writer-asserted-drafted")?.evidence).toContain("Ashgrove");
    expect(contentWordOverlap(exclusionText, "nothing relevant")).toBe(0);
  });

  it("says why each Seed Batch failed, as counts, never a black box (run 7)", () => {
    const fixture = byCase("withdrawn_feedback");
    const c = baseCollected();
    expect(runChecks(fixture, c, emptyRunLog(fixture.id, 0)).find((item) => item.id === "failed-batches")?.evidence).toBe("no Seed Batch failed");
    c.batches.push({
      batchId: "b9",
      roleId: "specific_advancements",
      operation: "retry",
      status: "failed",
      queuedAt: 1,
      startedAt: 2,
      completedAt: 3,
      roleOpen: false,
      startedBy: null,
      requestsMade: 2,
      seedsDropped: null,
      consumedContextRevision: "r9",
      feedbackRequestId: null,
      error: "INVALID_OUTPUT",
      errorDetail: "advancement_links",
      invalidAnswers: [
        {
          seedsReturned: 5,
          seedsValid: 1,
          minimum: 3,
          issues: [
            { code: "INVALID_ADVANCEMENT_REFERENCE", reason: "uncertainty_without_tested_experiment", seeds: 3 },
            { code: "INVALID_BATCH_SIZE", seeds: 0 },
          ],
        },
      ],
    });
    const failed = runChecks(fixture, c, emptyRunLog(fixture.id, 0)).find((item) => item.id === "failed-batches");
    expect(failed).toMatchObject({ status: "info" });
    expect(failed?.evidence).toBe(
      "specific_advancements retry: INVALID_OUTPUT / advancement_links, answer 1: 1 of 5 valid, needed 3 (INVALID_ADVANCEMENT_REFERENCE uncertainty_without_tested_experiment x3, INVALID_BATCH_SIZE x0)"
    );
  });

  it("checks the changed-advancement-links case", () => {
    const fixture = byCase("changed_advancement_links");
    const c = baseCollected();
    c.summary!.items = [
      summaryItem("iu2", "active_uncertainties", "u2"),
      summaryItem("ie1", "experimentation", "e1", { uncertaintySeedId: "u2" }),
      summaryItem("ia1", "specific_advancements", "a1", { uncertaintySeedId: "u2", experimentSeedIds: ["e1"] }),
      summaryItem("ia2", "specific_advancements", "a2", { uncertaintySeedId: "u2", experimentSeedIds: ["e1"] }),
    ];
    c.seeds = [{ seedId: "u1", batchId: "b", roleId: "active_uncertainties", bullets: ["Cold-water start-up below 10 C was unknown."], support: "source_supported", revisionOfSeedId: null, feedbackRequestId: null, uncertaintySeedId: null, experimentSeedIds: [] }];
    c.report = { ...c.report!, sections: { ...c.report!.sections, s246: "Dosing and fill held TAN under target.\n\nThe cold-water start-up below 10 C was resolved." } };
    c.complianceNotes = [cover("iu2", "242"), cover("ie1", "244"), cover("ia1", "246", ["ia1", "ia2"]), cover("ia2", "246", ["ia1", "ia2"])];
    const log: RunLog = {
      ...emptyRunLog(fixture.id, 0),
      removedUncertaintySeedId: "u1",
      linkNotices: { experimentation: "experiments_for_dropped_uncertainty", specific_advancements: "unlinked_advancements" },
      refusals: [
        { roleId: "experimentation", key: "droppedExperiments", code: "INVALID_STATE", reason: "EXPERIMENT_FOR_DROPPED_UNCERTAINTY" },
        { roleId: "specific_advancements", key: "unlinked", code: "INVALID_STATE", reason: "UNLINKED_ADVANCEMENT" },
      ],
    };
    const checks = runChecks(fixture, c, log);
    for (const id of ["unlinked-refused", "links-valid", "removed-uncertainty-gone", "merge-named", "advancements-follow-experiments", "experiments-hold-uncertainties", "dropped-experiments-refused", "dropped-experiments-named", "unlinked-advancements-named"]) {
      expect({ id, status: status(checks, id) }).toEqual({ id, status: "pass" });
    }
    // The hint points the judge at the paragraph closest to the dropped uncertainty.
    expect(checks.find((item) => item.id === "dropped-uncertainty-drafted")).toMatchObject({ status: "info" });
    expect(checks.find((item) => item.id === "dropped-uncertainty-drafted")?.evidence).toMatch(/^paragraph 2 shares/);

    // Run 6's plan: the advancement names a kept uncertainty, but its
    // experiment tested the dropped one.
    const run6 = baseCollected();
    run6.summary!.items = [
      summaryItem("iu3", "active_uncertainties", "u3"),
      summaryItem("ie1", "experimentation", "e1", { uncertaintySeedId: "u1" }),
      summaryItem("ia1", "specific_advancements", "a1", { uncertaintySeedId: "u3", experimentSeedIds: ["e1"] }),
    ];
    // Run 6's log: no notices were read (older results carry no linkNotices).
    const { linkNotices: _notices, ...run6Log } = log;
    const run6Checks = runChecks(fixture, run6, { ...run6Log, refusals: [log.refusals[1]!] });
    expect(status(run6Checks, "dropped-experiments-named")).toBe("fail");
    expect(status(run6Checks, "unlinked-advancements-named")).toBe("fail");
    expect(status(run6Checks, "links-valid")).toBe("pass");
    expect(status(run6Checks, "advancements-follow-experiments")).toBe("fail");
    expect(status(run6Checks, "experiments-hold-uncertainties")).toBe("fail");
    expect(status(run6Checks, "dropped-experiments-refused")).toBe("fail");
    c.complianceNotes = [cover("iu2", "242"), cover("ie1", "244"), cover("ia1", "246"), cover("ia2", "246")];
    expect(status(runChecks(fixture, c, log), "merge-named")).toBe("fail");
    c.summary!.items[2] = summaryItem("ia1", "specific_advancements", "a1", { uncertaintySeedId: "u1", experimentSeedIds: ["e1"] });
    const moved = runChecks(fixture, c, log);
    expect(status(moved, "links-valid")).toBe("fail");
    expect(status(moved, "removed-uncertainty-gone")).toBe("fail");
  });
});

describe("what the writer dropped stays out (2026-09-30, first)", () => {
  const SEED_FRACTION = "It was unclear what seed fraction would be needed once water dropped further to 6 degrees C. The team did not know if gains from more seed would keep scaling or flatten at some point.";
  const leaveOutRow = (section: string, outcome: "applied" | "not_applied" = "applied") => ({
    section,
    paragraphIndex: null,
    source: "model",
    instruction: "Leave out the uncertainty the writer dropped: \"It was unclear...\"",
    outcome,
    tier: "none",
    reason: outcome === "applied" ? "Nothing on seed fraction." : "P4 narrates Trial 2 at 6 C.",
    repaired: false,
    planRef: { itemId: null, skippedRoleId: null, droppedSeedId: "u1", ruleId: null, mergedItemIds: [] },
  });
  const answersRow = (outcome: "applied" | "not_applied" = "applied") => ({
    section: "246",
    paragraphIndex: null,
    source: "model",
    instruction: "Claim an advancement only for an uncertainty Line 242 states",
    outcome,
    tier: "none",
    reason: outcome === "applied" ? "Every advancement answers Line 242." : "P4 claims dosing.",
    repaired: false,
    planRef: { itemId: null, skippedRoleId: null, droppedSeedId: null, ruleId: "advancements_answer_242", mergedItemIds: [] },
  });
  function run10(): { c: Collected; log: RunLog } {
    const c = baseCollected();
    c.summary!.items = [
      summaryItem("iu2", "active_uncertainties", "u2", { bullets: ["It was uncertain whether stepwise acclimation would beat unacclimated seed at 8 C."] }),
      summaryItem("ie1", "experimentation", "e1", { uncertaintySeedId: "u2", bullets: ["Trial 1 ran three loops at 8 C for the 5-week target."] }),
      summaryItem("ia1", "specific_advancements", "a1", { uncertaintySeedId: "u2", experimentSeedIds: ["e1"] }),
    ];
    c.summary!.droppedUncertaintySeedIds = ["u1"];
    c.seeds = [
      { seedId: "u1", batchId: "b", roleId: "active_uncertainties", bullets: [SEED_FRACTION], support: "source_supported", revisionOfSeedId: null, feedbackRequestId: null, uncertaintySeedId: null, experimentSeedIds: [] },
      { seedId: "e2", batchId: "b", roleId: "experimentation", bullets: ["Trial 2 at 6 C compared 5 and 15 percent acclimated seed.", "The loops took 44 and 29 days."], support: "source_supported", revisionOfSeedId: null, feedbackRequestId: null, uncertaintySeedId: "u1", experimentSeedIds: [] },
    ] as Collected["seeds"];
    c.report = {
      ...c.report!,
      sections: {
        s242: "Marrowgate builds biofilters.\n\nIt was uncertain whether stepwise acclimation would beat unacclimated seed at 8 C.",
        s244: "Trial 1 ran three loops at 8 C.\n\nThe loops were sampled daily.\n\nNitrite stalled for 6 days.\n\nAt 6 C, a 5 percent acclimated-seed loop took 44 days, while a 15 percent loop took 29 days.",
        s246: "The objective was largely achieved.\n\nStepwise acclimation cut start-up to 31 days at 8 C.\n\nRequired seed fraction rises as temperature drops: 15 percent acclimated seed meets the 5-week target at 6 C, with returns flattening.",
      },
    };
    c.complianceNotes = [leaveOutRow("242"), leaveOutRow("244"), leaveOutRow("246"), answersRow()];
    return { c, log: { ...emptyRunLog(byCase("changed_advancement_links").id, 0), removedUncertaintySeedId: "u1" } };
  }

  it("reads figures with a unit, normalised, lists included", () => {
    expect(figuresOf("At 6 degrees C the loops took 44 and 29 days; 15 percent seed, from 14 to 8 degrees.")).toEqual([
      "6 C", "44 days", "29 days", "15 percent", "14 C", "8 C",
    ]);
    expect(figuresOf("A 5-week target, 10% seed and 2.3 mg/L TAN at 7 C.")).toEqual(["10 percent", "2.3 mg/L", "7 C"]);
    expect(figuresOf("No unit here: 44, 2025.")).toEqual([]);
  });

  it("passes when every Line records the dropped uncertainty as left out and Line 246's advancements answer Line 242", () => {
    const { c, log } = run10();
    const checks = runChecks(byCase("changed_advancement_links"), c, log);
    expect(status(checks, "dropped-uncertainty-left-out")).toBe("pass");
    expect(checks.find((item) => item.id === "dropped-uncertainty-left-out")?.evidence)
      .toBe("242: applied; 244: applied; 246: applied; frozen at sign-off: u1");
    expect(status(checks, "advancements-answer-242")).toBe("pass");
  });

  it("fails when a Line holds it, has no row, or Line 246 claims an advancement Line 242 does not state", () => {
    const { c, log } = run10();
    c.complianceNotes = [leaveOutRow("242"), leaveOutRow("244", "not_applied"), answersRow("not_applied")];
    const checks = runChecks(byCase("changed_advancement_links"), c, log);
    expect(status(checks, "dropped-uncertainty-left-out")).toBe("fail");
    expect(checks.find((item) => item.id === "dropped-uncertainty-left-out")?.evidence)
      .toBe('242: applied; 244: not_applied ("P4 narrates Trial 2 at 6 C."); 246: no row; frozen at sign-off: u1');
    expect(status(checks, "advancements-answer-242")).toBe("fail");
    c.complianceNotes = [];
    const none = runChecks(byCase("changed_advancement_links"), c, log);
    expect(none.find((item) => item.id === "advancements-answer-242")?.evidence).toBe("no Line 246 row for this check");
    // A run read back before the amendment (no dropped id recorded) fails too.
    expect(status(runChecks(byCase("changed_advancement_links"), c, { ...log, removedUncertaintySeedId: null }), "dropped-uncertainty-left-out")).toBe("fail");
  });

  it("reports Line 246's LEAVE OUT and Rule B repairs and any COVER row lost after one, for every fixture, as information (review P3-5)", () => {
    const { c, log } = run10();
    c.complianceNotes = [
      cover("ia1", "246", ["ia1"], { outcome: "not_applied", reason: "The acclimation advancement is gone." }),
      { ...answersRow(), repaired: true },
      leaveOutRow("246"),
    ];
    for (const fixture of fixtures) {
      const row = runChecks(fixture, c, log).find((item) => item.id === "leave-out-repairs-246");
      expect(row?.status).toBe("info");
      expect(row?.evidence).toBe('Rule B: applied, repaired; left out u1: applied; COVER rows not applied after such a repair: ia1 ("The acclimation advancement is gone.")');
    }
    c.complianceNotes = [cover("ia1", "246")];
    expect(runChecks(byCase("skipped_role_supported"), c, log).find((item) => item.id === "leave-out-repairs-246")?.evidence)
      .toBe("no LEAVE OUT or Rule B row in Line 246");
  });

  it("reports Line 244's Rule C row and any COVER row lost after its repair, for every fixture, as information (2026-09-30, second)", () => {
    const { c, log } = run10();
    const workRow = (extra: Partial<Collected["complianceNotes"][number]> = {}) => ({
      section: "244",
      paragraphIndex: null,
      source: "model",
      instruction: "Describe work only for an uncertainty Line 242 states, or work a signed-off item holds or needs as its evidence",
      outcome: "applied",
      tier: "none",
      reason: "All work answers 242 or a plan item.",
      repaired: false,
      planRef: { itemId: null, skippedRoleId: null, droppedSeedId: null, ruleId: "work_answers_242", mergedItemIds: [] },
      ...extra,
    });
    c.complianceNotes = [cover("ie1", "244", ["ie1"], { outcome: "not_applied", reason: "Trial 1 is gone." }), workRow({ repaired: true })];
    for (const fixture of fixtures) {
      const row = runChecks(fixture, c, log).find((item) => item.id === "work-answers-242");
      expect(row?.status).toBe("info");
      expect(row?.evidence).toBe('Rule C: applied, repaired ("All work answers 242 or a plan item."); COVER rows not applied after such a repair: ie1 ("Trial 1 is gone.")');
    }
    c.complianceNotes = [workRow({ outcome: "not_applied", reason: "P5 narrates a sensor trial.; repair not used (the repaired text no longer covers...)" })];
    expect(runChecks(byCase("carried_old_selections"), c, log).find((item) => item.id === "work-answers-242")?.evidence)
      .toBe('Rule C: not_applied, repair not used ("P5 narrates a sensor trial.; repair not used (the repaired text no longer covers...)"); COVER rows not applied after such a repair: none');
    c.complianceNotes = [cover("ie1", "244")];
    expect(runChecks(byCase("exclusion_conflict"), c, log).find((item) => item.id === "work-answers-242")?.evidence)
      .toBe("no Rule C row in Line 244");
  });

  it("names a LEAVE OUT row the figure check recorded applied (2026-09-30, second)", () => {
    const { c, log } = run10();
    const backstop = 'The flagged content is a signed-off item: the Self-check flagged paragraph 3 ("P3 states stall durations (19 vs 6 days)."), but every figure it cited (19 days, 6 days) is in the signed-off plan\'s wording, and the paragraph holds none of the dropped uncertainty\'s own figures (44 days). Not sent to the repair.';
    c.complianceNotes = [leaveOutRow("242"), { ...leaveOutRow("244"), reason: backstop }, leaveOutRow("246"), answersRow()];
    const checks = runChecks(byCase("changed_advancement_links"), c, log);
    expect(status(checks, "dropped-uncertainty-left-out")).toBe("pass");
    expect(checks.find((item) => item.id === "dropped-uncertainty-left-out")?.evidence)
      .toMatch(/^242: applied; 244: applied by the figure check \("The flagged content is a signed-off item: .*"\); 246: applied; frozen at sign-off: u1$/);
  });

  it("names every paragraph of every Line that holds the dropped uncertainty's words or its experiments' distinctive figures", () => {
    const { c, log } = run10();
    const hint = runChecks(byCase("changed_advancement_links"), c, log).find((item) => item.id === "dropped-uncertainty-drafted");
    expect(hint?.status).toBe("info");
    // The closest Line 246 paragraph first, as before.
    expect(hint?.evidence).toMatch(/^paragraph 3 shares \d+ percent of its content words/);
    // "8 C", "5-week" and the like are in signed-off items, so they are not distinctive.
    expect(hint?.evidence).toContain("distinctive figures: 6 C, 5 percent, 15 percent, 44 days, 29 days");
    expect(hint?.evidence).toContain("Line 244 P4 (");
    expect(hint?.evidence).toContain("6 C, 5 percent, 15 percent, 44 days, 29 days");
    expect(hint?.evidence).toContain("Line 246 P3 (");
    expect(hint?.evidence).not.toContain("Line 244 P1 ");
    expect(hint?.evidence).not.toContain("Line 242 P");
    const scan = droppedUncertaintyHits({
      sections: c.report!.sections,
      droppedWords: SEED_FRACTION,
      experimentWords: ["Trial 2 at 6 C compared 5 and 15 percent acclimated seed. The loops took 44 and 29 days."],
      planWords: c.summary!.items.map((item) => item.bullets.join(" ")),
    });
    expect(scan.hits.map((hit) => `${hit.section} P${hit.paragraph}`)).toEqual(["244 P4", "246 P3"]);
  });
});

describe("CAP-14 figures", () => {
  it("computes median and nearest-rank p95", () => {
    expect(distribution([])).toEqual({ count: 0, medianMs: null, p95Ms: null });
    expect(distribution([3, 1, 2])).toEqual({ count: 3, medianMs: 2, p95Ms: 3 });
    expect(distribution([4, 1, 3, 2])).toEqual({ count: 4, medianMs: 2.5, p95Ms: 4 });
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(distribution(hundred).p95Ms).toBe(95);
    expect(distribution([-5, Number.NaN, 7]).count).toBe(1);
  });

  it("uses the learning-health definitions for the latency samples", () => {
    const c = baseCollected();
    const samples = latencySamples(c, { ...emptyRunLog("x", 0), singleBaseline: { generationId: "g2", requestedAt: 0, reportGeneratedAt: 250_000 } });
    expect(samples.dispatchToResultMs).toEqual([8_000, 10_000]);
    // The server's first Batch is no wait (decision 65); only b2 counts.
    expect(samples.foregroundToFirstRenderMs).toEqual([11_000]);
    expect(samples.signOffToReportMs).toEqual([300_000]);
    expect(samples.singleModeRequestToReportMs).toEqual([250_000]);
  });

  it("counts seed-stage requests and cost from aiUsage", () => {
    const c = baseCollected();
    expect(seedRequestCount(c)).toEqual({ seeds: 1, feedback: 1, metered: 2, reserved: 17 });
    const cost = usageCost(c);
    expect(cost.totalUsd).toBeCloseTo(0.53);
    expect(cost.seedStageUsd).toBeCloseTo(0.03);
    expect(cost.models).toEqual(["claude-sonnet-5"]);
  });
});

describe("judging pack", () => {
  const context = { date: "2026-09-27", deployment: "local-e2e", commit: "abc1234", reviewer: "reviewer@example.com" };

  it("renders blank judgment fields, the checks, the plan and the drafted text", () => {
    const fixture = byCase("skipped_role_supported");
    const c = baseCollected();
    c.summary!.items = [summaryItem("i1", "company_context", "s1", { bullets: ["Corvane builds analyzers."] })];
    c.summary!.skippedRoleIds = ["prior_year_status"];
    const log = emptyRunLog(fixture.id, 0);
    const checks = runChecks(fixture, c, log);
    const text = renderFixturePack({ fixture, log, collected: c, checks }, context);
    expect(text).toContain("# Release eval - Corvane fouling-resistant analyzer");
    expect(text).toContain("- Verdict (pass or fail): \n");
    expect(text).toContain("- Judged by: \n");
    for (const question of fixture.judgmentQuestions) expect(text).toContain(question);
    expect(text).toContain("| The Compliance Note lists every Skip as honoured or not | fail |");
    expect(text).toContain("- Corvane builds analyzers.");
    expect(text).toContain("Skipped by the writer. The drafter must not cover this role.");
    expect(text).toContain("Section 244 text.");
    expect(text).toContain("Dispatch to validated result: median 9.0 s");
    expect(DASHES.test(text)).toBe(false);
    expect(text).not.toContain("Fixture notes:");

    // A fixture's notes on its scripted session reach the judge (2026-09-29).
    const links = byCase("changed_advancement_links");
    const linksText = renderFixturePack({ fixture: links, log: emptyRunLog(links.id, 0), collected: null, checks: [] }, context);
    expect(linksText).toContain("Fixture notes:");
    for (const note of links.notes ?? []) expect(linksText).toContain(`- ${note}`);
    expect(links.notes?.length).toBeGreaterThan(0);

    const summary = renderSummary([{ fixture, log, collected: c, checks }], context);
    expect(summary).toContain("| [skipped-role-supported](skipped-role-supported.md) | Skipped role supported by the Brief |");
    expect(summary).toContain("placeholder 12 s: within");
    expect(summary).toContain("Single-mode baseline not measured");
    expect(DASHES.test(summary)).toBe(false);
  });

  it("reserves a fresh folder per run and never overwrites evidence", () => {
    const root = mkdtempSync(path.join(tmpdir(), "seed-plan-eval-"));
    try {
      const first = reservePackDir(root, "2026-09-27");
      const second = reservePackDir(root, "2026-09-27");
      expect(path.basename(first)).toBe("2026-09-27");
      expect(path.basename(second)).toBe("2026-09-27-run2");
      const fixture = byCase("withdrawn_feedback");
      const log = emptyRunLog(fixture.id, 0);
      const written = writePack(first, [{ fixture, log, collected: null, checks: runChecks(fixture, null, log) }], context);
      expect(written.map((file) => path.basename(file))).toEqual(["withdrawn-feedback.md", "summary.md", "results.json"]);
      expect(JSON.parse(readFileSync(path.join(first, "results.json"), "utf8")).context).toEqual(context);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("runner", () => {
  it("records a refused call and never throws", async () => {
    const calls: string[] = [];
    const driver: EvalDriver = {
      mutation: async (name) => {
        calls.push(name);
        throw parseConvexError('Uncaught ConvexError: {"code":"NOT_AUTHORIZED","message":"An active internal role is required"}\n');
      },
      query: async () => null,
      internal: async () => null,
      now: () => 0,
      sleep: async () => undefined,
      log: () => undefined,
    };
    const { log, collected } = await runFixture(byCase("skipped_role_supported"), driver);
    expect(calls).toEqual(["projects:createProject"]);
    expect(log.error).toBe("An active internal role is required");
    expect(collected).toBeNull();
    expect(log.lines.at(-1)).toContain("stopped: An active internal role is required");
  });

  it("creates the project with the fixture's sources and the release-eval name", async () => {
    const created: Array<Record<string, unknown>> = [];
    const driver: EvalDriver = {
      mutation: async (name, args) => {
        created.push({ name, ...args });
        if (name === "generations:requestGeneration") throw new Error("stop here");
        // The real mutation returns the new ids as an object.
        return name === "projects:createProject" ? { projectId: "project-1", transcriptIds: ["t-1"] } : "document-1";
      },
      query: async () => null,
      internal: async () => null,
      now: () => 0,
      sleep: async () => undefined,
      log: () => undefined,
    };
    const fixture = byCase("exclusion_conflict");
    const { log } = await runFixture(fixture, driver);
    expect(created[0]).toMatchObject({
      name: "projects:createProject",
      title: "Release eval - Quillmere drift-tolerant burner anomaly model",
      clientName: "Quillmere Analytics Ltd.",
      transcripts: [{ content: fixture.texts["interview.txt"] }],
    });
    expect(created[1]).toMatchObject({ name: "documents:uploadDocument", projectId: "project-1", fileType: "md", intake: "pasted" });
    expect(created[2]).toMatchObject({ name: "generations:requestGeneration", projectId: "project-1", candidateMode: "iterative" });
    expect(log.error).toBe("stop here");
  });
});

describe("rate limits", () => {
  const limited = (retryAfter: number | undefined, scope = "user") =>
    parseConvexError(
      `Uncaught ConvexError: ${JSON.stringify({
        ...(retryAfter === undefined ? {} : { retryAfter }),
        scope,
        code: "RATE_LIMITED",
        message: "You have started a lot of runs in the last hour. Try again in 5 minutes.",
      })}\n`,
    );
  /** A fake clock: sleeping only advances time and records the wait. */
  function fakeClock() {
    const state = { now: 0, sleeps: [] as number[], lines: [] as string[] };
    return {
      state,
      sleep: async (ms: number) => {
        state.sleeps.push(ms);
        state.now += ms;
      },
      log: (line: string) => state.lines.push(line),
    };
  }

  it("reads retryAfter from a RATE_LIMITED refusal only", () => {
    expect(rateLimitRetryAfterMs(limited(300))).toBe(300_000);
    expect(rateLimitRetryAfterMs(limited(undefined))).toBe(60_000);
    expect(rateLimitRetryAfterMs(parseConvexError('Uncaught ConvexError: {"code":"STALE_REVISION","message":"x"}\n'))).toBeNull();
    expect(rateLimitRetryAfterMs(new Error("RATE_LIMITED"))).toBeNull();
    expect(formatWait(305_000)).toBe("5 min 5 s");
    expect(formatWait(120_000)).toBe("2 min");
    expect(formatWait(9_400)).toBe("9 s");
  });

  it("waits retryAfter plus a margin and retries the same action", async () => {
    const clock = fakeClock();
    const budget = rateLimitBudget();
    let calls = 0;
    const result = await waitOutRateLimits(
      "seeds:regenerate",
      async () => {
        calls += 1;
        if (calls <= 2) throw limited(calls === 1 ? 300 : 90);
        return "done";
      },
      clock,
      budget,
    );
    expect(result).toBe("done");
    expect(calls).toBe(3);
    expect(clock.state.sleeps).toEqual([300_000 + RATE_LIMIT_MARGIN_MS, 90_000 + RATE_LIMIT_MARGIN_MS]);
    expect(budget.waitedMs).toBe(400_000);
    expect(clock.state.lines[0]).toBe(
      'Rate limited: seeds:regenerate was refused by the user limit ("You have started a lot of runs in the last hour. Try again in 5 minutes."). Waiting 5 min 5 s, then trying the same action again; 39 min 55 s of this run\'s 45 min allowance will be left.',
    );
    expect(clock.state.lines).toHaveLength(2);
  });

  it("stops once the run's 45-minute allowance would be passed", async () => {
    const clock = fakeClock();
    const budget = rateLimitBudget();
    let calls = 0;
    await expect(
      waitOutRateLimits("seeds:open", async () => {
        calls += 1;
        throw limited(1_200);
      }, clock, budget),
    ).rejects.toThrow(
      "seeds:open is still refused by the user limit. Waiting 20 min 5 s more would pass this run's 45 min allowance (40 min 10 s already spent waiting), so the run stops here. The limits were not changed.",
    );
    expect(calls).toBe(3);
    expect(clock.state.sleeps).toEqual([1_205_000, 1_205_000]);
    expect(clock.state.now).toBe(2_410_000);
    expect(budget.waitedMs).toBeLessThanOrEqual(45 * 60_000);
  });

  it("passes other refusals straight through without waiting", async () => {
    const clock = fakeClock();
    await expect(
      waitOutRateLimits("seeds:approve", async () => {
        throw parseConvexError('Uncaught ConvexError: {"code":"INVALID_STATE","message":"The seed stage is closed"}\n');
      }, clock, rateLimitBudget()),
    ).rejects.toThrow("The seed stage is closed");
    expect(clock.state.sleeps).toEqual([]);
  });

  it("shares one allowance across the run and logs the wait in the run log", async () => {
    const clock = fakeClock();
    const budget = rateLimitBudget();
    budget.waitedMs = 44 * 60_000;
    const calls: string[] = [];
    const driver: EvalDriver = {
      mutation: async (name) => {
        calls.push(name);
        if (name === "projects:createProject" && calls.length === 1) throw limited(30, "project");
        throw new Error("stop here");
      },
      query: async () => null,
      internal: async () => null,
      now: () => clock.state.now,
      sleep: clock.sleep,
      log: () => undefined,
    };
    const { log } = await runFixture(byCase("withdrawn_feedback"), driver, { rateLimitBudget: budget });
    expect(calls).toEqual(["projects:createProject", "projects:createProject"]);
    expect(clock.state.sleeps).toEqual([35_000]);
    expect(budget.waitedMs).toBe(44 * 60_000 + 35_000);
    expect(log.lines.some((line) => line.includes("Rate limited: projects:createProject was refused by the project limit"))).toBe(true);
    expect(log.error).toBe("stop here");

    const exhausted = rateLimitBudget();
    exhausted.waitedMs = 45 * 60_000;
    const again = await runFixture(byCase("withdrawn_feedback"), { ...driver, mutation: async () => { throw limited(30); } }, { rateLimitBudget: exhausted });
    expect(again.log.error).toMatch(/would pass this run's 45 min allowance/);
  });
});

describe("first contact fixes", () => {
  it("names a failed Self-check and a Locked Rule breach, and groups repeated reasons", () => {
    const fixture = byCase("skipped_role_supported");
    const c = baseCollected();
    c.summary!.items = [summaryItem("i1", "company_context", "s1"), summaryItem("i2", "goal_problem", "s2")];
    const didNotComplete = { outcome: "not_applied", reason: "The plan coverage Self-check did not complete." };
    c.complianceNotes = [
      cover("i1", "242", ["i1"], didNotComplete),
      cover("i2", "242", ["i2"], didNotComplete),
      { section: "242", paragraphIndex: null, source: "deterministic", instruction: "Model Self-check", outcome: "not_applied", tier: "none", reason: "Self-check call failed (unknown: 9 ordinary verdicts for 22 labels); deterministic checks only", repaired: false, planRef: null },
      { section: "246", paragraphIndex: null, source: "deterministic", instruction: "Locked Rule: Line 246 holds at most 350 words and 50 form lines", outcome: "not_applied", tier: "locked", reason: "cap breach at 440/350 words, 45/50 lines; repair failed", repaired: false, planRef: null },
    ];
    const checks = runChecks(fixture, c, emptyRunLog(fixture.id, 0));
    const find = (id: string) => checks.find((item) => item.id === id)!;
    expect(find("coverage-applied")).toMatchObject({ status: "fail", evidence: '2 row(s) in 242: "The plan coverage Self-check did not complete."' });
    expect(find("self-check-ran")).toMatchObject({ status: "fail" });
    expect(find("self-check-ran").evidence).toContain("9 ordinary verdicts for 22 labels");
    expect(find("locked-rules")).toMatchObject({ status: "fail" });
    expect(find("locked-rules").evidence).toContain("440/350 words");
    const clean = runChecks(fixture, baseCollected(), emptyRunLog(fixture.id, 0));
    expect(clean.find((item) => item.id === "self-check-ran")?.status).toBe("pass");
    expect(clean.find((item) => item.id === "locked-rules")?.status).toBe("pass");
  });

  it("fails the Self-check when every label and plan check of a Section is not checked, and counts them per Section", () => {
    const fixture = byCase("skipped_role_supported");
    const c = baseCollected();
    c.summary!.items = [summaryItem("i1", "company_context", "s1"), summaryItem("i2", "workplan", "s2")];
    const label = (section: string, instruction: string, reason: string, outcome = "applied") => ({
      section, paragraphIndex: null, source: "model", instruction, outcome, tier: "none", reason, repaired: false, planRef: null,
    });
    const notCheckedItem = { outcome: "not_applied", reason: "Not checked: the plan coverage Self-check gave no verdict for this item." };
    const notCheckedLabel = "Not checked: the Self-check gave no verdict for this check.";
    c.complianceNotes = [
      // 242: nothing checked at all.
      label("242", "Storyline", notCheckedLabel, "not_applied"),
      label("242", "Confidence Map: Coupon result.", notCheckedLabel, "not_applied"),
      cover("i1", "242", ["i1"], notCheckedItem),
      // 244: one label not checked, the rest checked.
      label("244", "Storyline", "Matches the Storyline."),
      label("244", "Glossary Term: fouling rig", notCheckedLabel, "not_applied"),
      label("244", "Storyline", "Storyline question raised in the Brief: Which result holds? (not repaired)", "not_applied"),
      label("244", "Consistency pass (contradiction)", "section contradiction detected", "not_applied"),
      cover("i2", "244"),
    ];
    const checks = runChecks(fixture, c, emptyRunLog(fixture.id, 0));
    const ran = checks.find((item) => item.id === "self-check-ran")!;
    expect(ran.status).toBe("fail");
    expect(ran.evidence).toContain('242: every label and plan check is "Not checked" (3)');
    expect(ran.evidence).toContain('244: 1 label and 0 plan checks "Not checked" of 3');
    expect(notCheckedCounts(c)).toEqual([
      { section: "242", labels: 2, planChecks: 1, total: 3 },
      { section: "244", labels: 1, planChecks: 0, total: 3 },
    ]);
    const text = renderFixturePack({ fixture, log: emptyRunLog(fixture.id, 0), collected: c, checks }, {
      date: "2026-09-28", deployment: "local", commit: "abc1234", reviewer: "reviewer@example.com",
    });
    expect(text).toContain("## Not checked by the Self-check");
    expect(text).toContain('- Line 242: 2 labels and 1 plan check "Not checked" of 3.');
    expect(text).toContain('- Line 244: 1 label and 0 plan checks "Not checked" of 3.');
    expect(DASHES.test(text)).toBe(false);

    // Some rows not checked is named but does not fail the check by itself.
    c.complianceNotes = c.complianceNotes.filter((note) => note.section === "244");
    const partial = runChecks(fixture, c, emptyRunLog(fixture.id, 0)).find((item) => item.id === "self-check-ran")!;
    expect(partial.status).toBe("pass");
    expect(partial.evidence).toBe('244: 1 label and 0 plan checks "Not checked" of 3');
  });

  it("names a failed final coverage check in the Self-check evidence and the pack", () => {
    const fixture = byCase("withdrawn_feedback");
    const c = baseCollected();
    c.summary!.items = [summaryItem("i1", "overall_advancement", "s1")];
    const finalReason =
      "Final coverage Self-check failed (unknown: 2 of 3 verdicts invalid; first plan verdict 1 (item i1): mergedItemIds has 1 ids, expected [i1, i2] in that order); plan rows not checked on the final text";
    c.complianceNotes = [
      { section: "246", paragraphIndex: null, source: "model", instruction: "Storyline", outcome: "applied", tier: "none", reason: "Matches the Storyline.", repaired: false, planRef: null },
      cover("i1", "246", ["i1"], { outcome: "not_applied", reason: "Not checked: the plan coverage Self-check of the final text did not complete." }),
      { section: "246", paragraphIndex: null, source: "deterministic", instruction: "Final coverage Self-check", outcome: "not_applied", tier: "none", reason: finalReason, repaired: false, planRef: null },
    ];
    const checks = runChecks(fixture, c, emptyRunLog(fixture.id, 0));
    const ran = checks.find((item) => item.id === "self-check-ran")!;
    // The first check ran; the final check's failure is named, not failed here.
    expect(ran.status).toBe("pass");
    expect(ran.evidence).toContain(`246: "Final coverage Self-check failed (unknown: 2 of 3 verdicts invalid`);
    expect(ran.evidence).toContain("mergedItemIds has 1 ids, expected [i1, i2] in that order");
    expect(checks.find((item) => item.id === "coverage-applied")?.status).toBe("fail");
    const text = renderFixturePack({ fixture, log: emptyRunLog(fixture.id, 0), collected: c, checks }, {
      date: "2026-09-28", deployment: "local", commit: "abc1234", reviewer: "reviewer@example.com",
    });
    expect(text).toContain("Final coverage Self-check failed (unknown: 2 of 3 verdicts invalid");
    expect(DASHES.test(text)).toBe(false);
  });

  it("re-renders an earlier results.json with the current checks and no deployment", () => {
    expect(deploymentRefusal(parseArgs(["--render", "results.json"]), { CONVEX_DEPLOY_KEY: "x" })).toBeNull();
    expect(() => parseArgs(["--render", "a.json", "--cleanup"])).toThrow(/cannot be combined/);
    const fixture = byCase("skipped_role_supported");
    const log = emptyRunLog(fixture.id, 0);
    const saved = {
      context: { date: "2026-09-28", deployment: "local", commit: "abc1234", reviewer: "reviewer@example.com" },
      results: [{ fixture: { ...fixture, dir: undefined, texts: undefined } as never, log, collected: baseCollected(), checks: [] }],
    };
    const { results } = rerenderResults(saved, fixtures);
    expect(results[0].checks.some((item) => item.id === "self-check-ran")).toBe(true);
    expect("texts" in results[0].fixture).toBe(false);
  });

  it("stops plainly when createProject returns no project id", async () => {
    const driver: EvalDriver = {
      mutation: async () => ({ transcriptIds: [] }),
      query: async () => null,
      internal: async () => null,
      now: () => 0,
      sleep: async () => undefined,
      log: () => undefined,
    };
    const { log } = await runFixture(byCase("skipped_role_supported"), driver);
    expect(log.error).toBe('projects:createProject returned no projectId ({"transcriptIds":[]})');
    expect(log.projectId).toBeNull();
  });
});

describe("results against targets and no talk about sources (2026-09-30, third)", () => {
  const targetsRow = (section: string, outcome: "applied" | "not_applied", repaired = false) => ({
    section,
    paragraphIndex: null,
    source: "model",
    instruction: "State each result against its target as the numbers show",
    outcome,
    tier: "none",
    reason: outcome === "applied" ? "Every comparison matches." : "P1 calls met targets close.",
    repaired,
    planRef: { itemId: null, skippedRoleId: null, droppedSeedId: null, ruleId: "results_against_targets", mergedItemIds: [] },
  });
  const sourceRow = (section: string, outcome: "applied" | "not_applied", repaired = false) => ({
    section,
    paragraphIndex: null,
    source: "deterministic",
    instruction: "State facts without naming their source",
    outcome,
    tier: "none",
    reason: outcome === "applied" ? "no talk about sources found" : 'names a source in paragraph 2 ("the test memo indicates")',
    repaired,
    planRef: null,
  });
  const run = () => {
    const c = baseCollected();
    c.summary!.items = [summaryItem("ie1", "experimentation", "e1", { bullets: ["The engine ranked each interviewee by availability."] })];
    c.report = {
      ...c.report!,
      sections: {
        s242: "The company builds interview scheduling engines.\n\nIt was uncertain whether each interviewee could be ranked in time.",
        s244: "The team ran four trials.\n\nOver 240 runs, the test memo indicates the rank held.\n\nThe two sources disagree on the time, and a light source was not used.",
        s246: "The objective was met: 97.8 percent against the 97 percent target.",
      },
    };
    return c;
  };

  it("reports, per Line and for every fixture, the source talk left in the final text and the Self-check's row", () => {
    const c = run();
    c.complianceNotes = [sourceRow("242", "applied"), sourceRow("244", "not_applied", true)];
    for (const fixture of fixtures) {
      const row = runChecks(fixture, c, emptyRunLog(fixture.id, 0)).find((item) => item.id === "source-talk");
      expect(row?.status).toBe("info");
      // "interviewee" is the project's own subject (the signed-off wording).
      expect(row?.evidence).toBe(
        '242: none (row applied); 244: P2 "the test memo indicates", P3 "The two sources disagree" (row not_applied, repaired); 246: none (no row)'
      );
    }
    expect(runChecks(fixtures[0]!, { ...c, report: null }, emptyRunLog(fixtures[0]!.id, 0))
      .find((item) => item.id === "source-talk")?.evidence ?? "no report").toBe("no report");
  });

  it("reports Lines 244 and 246's targets rows for every fixture, and never names the targets row Rule B", () => {
    const c = run();
    c.complianceNotes = [targetsRow("244", "applied"), targetsRow("246", "applied", true)];
    for (const fixture of fixtures) {
      const checks = runChecks(fixture, c, emptyRunLog(fixture.id, 0));
      expect(checks.find((item) => item.id === "results-against-targets")).toEqual({
        id: "results-against-targets",
        label: "Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model)",
        status: "info",
        evidence: '244: applied ("Every comparison matches."); 246: applied, repaired ("Every comparison matches.")',
      });
      expect(checks.find((item) => item.id === "leave-out-repairs-246")?.evidence).toBe("no LEAVE OUT or Rule B row in Line 246");
    }
    c.complianceNotes = [targetsRow("246", "not_applied")];
    expect(runChecks(fixtures[0]!, c, emptyRunLog(fixtures[0]!.id, 0)).find((item) => item.id === "results-against-targets")?.evidence)
      .toBe('244: no row; 246: not_applied ("P1 calls met targets close.")');
  });
});
