import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Maintenance: dedupe projectDocuments by fileName (keeping the copy with
 * stored bytes) and tag the survivor with a category. One-off helper.
 *
 * Run with:  npx convex run seed:tagAndDedupeDoc '{"fileName":"X.pdf","category":"background"}'
 */
export const tagAndDedupeDoc = internalMutation({
  args: {
    fileName: v.string(),
    category: v.union(
      v.literal("previous_pd"),
      v.literal("scoping_notes"),
      v.literal("writer_notes"),
      v.literal("background"),
      v.literal("other")
    ),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("projectDocuments").collect();
    const matches = all.filter((d) => d.fileName === args.fileName);
    if (matches.length === 0) return { found: 0 };
    // Prefer keeping the copy that has original bytes stored.
    matches.sort((a, b) => (b.storageId ? 1 : 0) - (a.storageId ? 1 : 0));
    const keep = matches[0];
    let deleted = 0;
    for (let i = 1; i < matches.length; i++) {
      if (matches[i].storageId) await ctx.storage.delete(matches[i].storageId!);
      await ctx.db.delete(matches[i]._id);
      deleted++;
    }
    await ctx.db.patch(keep._id, { category: args.category });
    return { found: matches.length, kept: keep._id, deleted };
  },
});

/**
 * Seeds a demo project + transcript + generated report + generation record for
 * the demo user, so the chat feature can be tested without running the AI
 * pipeline. Fictional company — no real client data. Idempotent: re-running
 * returns the existing demo project instead of duplicating it.
 *
 * Run with:  npx convex run seed:seedDemoProject
 */
export const seedDemoProject = internalMutation({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", "demo@banhall.ca"))
      .first();

    if (!user) {
      throw new Error(
        "Demo user not found. Open http://localhost:3001 once to auto-create demo@banhall.ca, then re-run this seed."
      );
    }

    // Idempotency — reuse an existing demo project if present.
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", user._id))
      .collect();
    const already = existing.find((p) => p.title.startsWith("Demo:"));
    if (already) {
      return { projectId: already._id, reused: true };
    }

    const now = Date.now();
    const shareToken = generateShareToken();

    const projectId = await ctx.db.insert("projects", {
      title: "Demo: Cascade Hydroponics — Automated Nutrient Dosing",
      clientName: "Cascade Hydroponics Inc.",
      writer: "Tracy Nguyen",
      interviewer: "Larry Osei",
      status: "review",
      createdBy: user._id,
      shareToken,
      createdAt: now,
      updatedAt: now,
    });

    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: TRANSCRIPT,
      createdAt: now,
    });

    const doc = buildDoc(
      "Cascade Hydroponics — Automated Nutrient Dosing",
      SECTION_242,
      SECTION_244,
      SECTION_246
    );

    await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify(doc),
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "completed",
      currentStep: "Complete",
      agentOutputs: JSON.stringify({
        analyzer: ANALYSIS,
        section242: SECTION_242,
        section244: SECTION_244,
        section246: SECTION_246,
        qa: QA,
        chronology: CHRONOLOGY,
      }),
      startedAt: now - 60_000,
      completedAt: now,
    });

    return { projectId, reused: false };
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function paragraphs(text: string) {
  return text
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p.trim() }],
    }));
}

function buildDoc(title: string, s242: string, s244: string, s246: string) {
  const content: Array<Record<string, unknown>> = [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Line 242 — Scientific/Technological Uncertainty" }],
    },
    ...paragraphs(s242),
    { type: "horizontalRule" },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Line 244 — Work Performed" }],
    },
    ...paragraphs(s244),
    { type: "horizontalRule" },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Line 246 — Scientific/Technological Advancement" }],
    },
    ...paragraphs(s246),
  ];
  return { type: "doc", content };
}

// ─── Demo content (fictional) ─────────────────────────────────────────────────

const TRANSCRIPT = `Interviewer (Larry): Thanks for making time. Can you describe what Cascade was trying to build this year?

Subject (CTO): Sure. We run indoor vertical grow rooms for leafy greens. The big project was an automated nutrient dosing controller. We wanted the system to keep the nutrient solution — the EC and pH — stable on its own across all twelve grow towers, even as the plants grow and draw down nutrients at different rates.

Larry: What made that hard? Couldn't you just use off-the-shelf dosing pumps?

CTO: The pumps weren't the problem. The problem was the control logic. The towers are coupled — they share a reservoir — so dosing for one tower changes the conditions for the others. And the plant uptake isn't linear; it changes with growth stage and time of day. The standard PID controllers we tried oscillated badly. We didn't know what control approach would actually hold the solution stable in a coupled, time-varying system like ours.

Larry: So what did you try?

CTO: First we tried tuning a PID loop per tower. That overshot and the towers fought each other — pH would swing past target and then the correction would overshoot the other way. Then we tried a model-predictive approach where we modelled uptake from sensor history. The first model assumed constant uptake and failed during the rapid growth phase. We iterated — we added a term that estimated uptake rate from the rate of EC decline. That got us closer but it was unstable when a new crop was transplanted because the history reset.

Larry: Where did you land?

CTO: We ended up with an adaptive estimator that re-learns the uptake curve over the first 48 hours after transplant, then feeds a predictive dosing schedule. It holds EC within about 0.1 mS/cm now, where before we saw swings of 0.4 or more. We still don't fully understand why it destabilises occasionally during lighting transitions — that's an open question for next year.`;

const SECTION_242 = `Cascade Hydroponics Inc. operates twelve coupled vertical grow towers that share a common nutrient reservoir, producing leafy greens under controlled lighting and environmental conditions. The company's operational experience managing shared-reservoir hydroponic systems, where conditions in one tower directly affect every other tower, produced direct knowledge of the limitations of conventional dosing control for coupled, biologically driven systems.

The company's goal was to develop an automated nutrient dosing controller capable of holding electrical conductivity and pH stable across all twelve towers simultaneously, without manual intervention, as plants progressed through their growth cycle.

The limitations to standard practice were that the knowledge required to maintain a stable nutrient solution in a coupled, time-varying hydroponic system was insufficient, as established proportional-integral-derivative control methods assume independent, time-invariant processes and do not account for the cross-coupling between towers sharing a reservoir or for non-linear nutrient uptake that changes with plant growth stage.

The technological objective was to advance the understanding of adaptive control for coupled biological dosing systems for the purposes of developing a controller that holds solution chemistry within a narrow band across multiple interacting grow towers.

It was uncertain whether a predictive control strategy driven by sensor history could remain stable across transplant events, because resetting the plant population invalidates the accumulated uptake history the predictive model depends on, and it remained uncertain whether nutrient uptake could be estimated reliably from the rate of conductivity decline, because uptake rate varies with both growth stage and lighting cycle in ways that were not characterised for this crop and configuration.`;

const SECTION_244 = `The company undertook a planned series of experiments to resolve the uncertainty regarding stable dosing control in the coupled tower system. Each approach was evaluated against the prior one, with the conditions of failure used to direct the next iteration.

It was hypothesized that if nutrient uptake were estimated continuously from the rate of conductivity decline and used to drive a predictive dosing schedule, then solution conductivity could be held within 0.1 mS/cm of target across all twelve towers through a full growth cycle.

The first experiment applied an independently tuned proportional-integral-derivative loop to each tower. The towers, sharing a reservoir, interacted: a correction applied for one tower shifted conditions for the others, producing sustained oscillation in pH and conductivity that did not settle. This established that independent per-tower control could not account for the coupling and directed the work toward a model-based approach.

The company then developed a predictive model that estimated nutrient draw from recent sensor history. The initial model assumed a constant uptake rate and failed during the rapid-growth phase, when actual uptake departed sharply from the constant assumption. A subsequent iteration added a term estimating uptake rate from the slope of conductivity decline, which improved tracking but destabilised at transplant, when the sensor history that the estimator depended on was reset.

The final iteration introduced an adaptive estimator that re-learns the uptake curve over the first forty-eight hours following transplant before committing to a predictive dosing schedule, addressing the instability observed when the population changed.`;

const SECTION_246 = `Through systematic investigation, it was determined that nutrient uptake in the coupled tower system could be estimated from the rate of conductivity decline with sufficient accuracy to drive predictive dosing, provided the estimator was permitted to re-learn the uptake curve after each transplant rather than relying on a fixed or carried-over model.

It was determined that independently tuned control loops are unsuitable for shared-reservoir tower systems, as the cross-coupling between towers drives sustained oscillation that single-loop tuning cannot resolve. This knowledge now informs the company's control architecture for all coupled installations.

It was further established that the dominant source of model failure was the transplant event rather than steady-state operation, which redirected the engineering effort toward bounded re-learning windows rather than continuous re-estimation.

The resulting controller holds conductivity within approximately 0.1 mS/cm of target, compared with swings exceeding 0.4 mS/cm under the previous manual and single-loop methods.

A technological uncertainty remains regarding occasional destabilisation during lighting transitions, the cause of which has not been determined; the company plans to investigate whether transient uptake changes at lighting onset can be incorporated into the estimator in the next fiscal period.

The knowledge gained advances the company's ability to maintain stable solution chemistry across coupled grow towers, supporting consistent crop yield without continuous manual adjustment.`;

const ANALYSIS = {
  company_context:
    "Cascade Hydroponics operates twelve coupled vertical grow towers sharing one nutrient reservoir.",
  project_goal:
    "Build an automated nutrient dosing controller that holds EC and pH stable across all towers as plants grow.",
  business_problem:
    "Manual dosing was labour-intensive and could not keep solution chemistry stable in a coupled system.",
  scientific_technical_problem:
    "No known control method reliably stabilises a coupled, time-varying hydroponic dosing system.",
  passive_uncertainties: [
    "Standard PID control assumes independent, time-invariant processes and does not handle reservoir coupling or non-linear uptake.",
  ],
  active_uncertainties: [
    "Whether predictive control can stay stable across transplant events when uptake history resets.",
    "Whether uptake can be reliably estimated from the rate of EC decline across growth stages and lighting cycles.",
  ],
  technological_objective:
    "Advance adaptive control for coupled biological dosing systems to hold solution chemistry in a narrow band.",
  work_performed: {
    prior_year_status: null,
    workplan_steps: [
      "Per-tower PID tuning",
      "Predictive model from sensor history",
      "Adaptive uptake estimator with post-transplant re-learning",
    ],
    hypothesis:
      "If uptake is estimated from EC decline rate and drives predictive dosing, EC holds within 0.1 mS/cm across all towers.",
    experiments_iterations: [
      {
        problem_addressed: "Coupling between towers",
        approach: "Independent PID per tower",
        results: "Sustained oscillation; towers interfered with each other",
        conclusions: "Single-loop control cannot handle coupling",
      },
      {
        problem_addressed: "Non-linear uptake",
        approach: "Predictive model assuming constant uptake",
        results: "Failed during rapid growth phase",
        conclusions: "Constant-uptake assumption invalid",
      },
      {
        problem_addressed: "Transplant instability",
        approach: "Adaptive estimator re-learning over 48h post-transplant",
        results: "Stable; EC held within ~0.1 mS/cm",
        conclusions: "Bounded re-learning resolves transplant instability",
      },
    ],
  },
  advancements_achieved: [
    "Uptake can be estimated from EC decline rate with post-transplant re-learning.",
    "Independent loops are unsuitable for shared-reservoir systems.",
  ],
  remaining_uncertainties: [
    "Cause of occasional destabilisation during lighting transitions is unknown.",
  ],
  project_status: "Controller in production; one open uncertainty for next year.",
  unreliable_narrator_flags: [],
  gaps: [],
  useful_quotes: [
    "It holds EC within about 0.1 mS/cm now, where before we saw swings of 0.4 or more.",
  ],
};

const QA = {
  overall_score: 88,
  section_scores: {
    "242": { score: 86, issues: [{ text: "Active uncertainty paragraph is long — consider splitting.", severity: "warning" }], strengths: ["Knowledge-gap framing is strong.", "Mandated openers present."] },
    "244": { score: 90, issues: [], strengths: ["Clear experimental arc with failure-driven iteration.", "Measurable hypothesis."] },
    "246": { score: 88, issues: [{ text: "Quantify the lighting-transition instability if data exists.", severity: "deduction", deduction: 2 }], strengths: ["Knowledge-first advancement statements.", "Remaining uncertainty stated honestly."] },
  },
  cra_compliance: {
    verbiage_present: true,
    why_how_why_intact: true,
    uncertainties_distinguished: true,
  },
  hallucination_risks: [],
  ai_language_flags: [],
  superlative_flags: [],
  gaps_requiring_client_followup: [
    { section: "246", paragraph: 5, question: "Do you have logged data on the lighting-transition instability (frequency, magnitude)?" },
  ],
  suggested_improvements: [
    "Add a concrete figure for how often lighting-transition destabilisation occurs.",
  ],
};

const CHRONOLOGY = {
  entries: [
    { phase: "Per-tower PID", description: "Tuned independent PID loops per tower.", uncertaintyAddressed: "Coupling between towers", activityType: "experimental", estimatedHours: "80" },
    { phase: "Predictive model v1", description: "Constant-uptake predictive model.", uncertaintyAddressed: "Non-linear uptake", activityType: "experimental", estimatedHours: "120" },
    { phase: "Predictive model v2", description: "Added uptake-rate term from EC slope.", uncertaintyAddressed: "Non-linear uptake", activityType: "experimental", estimatedHours: "140" },
    { phase: "Adaptive estimator", description: "Post-transplant 48h re-learning window.", uncertaintyAddressed: "Transplant instability", activityType: "experimental", estimatedHours: "160" },
  ],
};
