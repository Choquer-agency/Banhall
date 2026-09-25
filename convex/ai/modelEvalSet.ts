/**
 * The fixed evaluation set for the model catalog (EVAL_SET_VERSION in
 * shared/modelCatalog.ts). Built from the repo's end-to-end fixture,
 * test-data/helios-end-to-end-test.txt: the interview is copied verbatim
 * (modelEvalSet.test.ts keeps it in sync with the file), and the analysis and
 * sections are a fixed, hand-checked reading of that interview so every
 * candidate is scored on identical inputs.
 *
 * Changing anything here changes what an evaluation measures: bump
 * EVAL_SET_VERSION so results from different sets are never compared.
 */
import type { TranscriptAnalysis } from "./analyzerAgent";

export const EVAL_SOURCE_ID = "eval-helios-interview";

/** The interview section of test-data/helios-end-to-end-test.txt. */
export const HELIOS_INTERVIEW = "Interviewer (Dana): Thanks for the time, Marcus. Can you describe what Verdant Grid set out to build this year?\n\nSubject (Marcus Lindqvist, CTO): Sure. We build controllers for residential solar microgrids — neighbourhoods where a lot of homes have rooftop solar and a battery, all tied together. This year's project was a predictive load-balancing controller. The goal was to keep voltage stable across the cluster while shifting load and battery charge/discharge around, so no single feeder gets overloaded when everyone's exporting at noon or pulling hard at dinner.\n\nDana: What made that hard? Couldn't you just use standard grid controls?\n\nMarcus: The standard stuff assumes a central operator and predictable one-way power flow. Our situation is the opposite — power flows both directions, generation is intermittent, and there's no central meter we can trust in real time. The big unknown was whether we could forecast cluster-level net load accurately enough to act ahead of a voltage event, given how fast cloud cover changes generation. We genuinely didn't know if a useful forecast was even possible at the timescale we needed.\n\nDana: So what did you try?\n\nMarcus: First we tried a rule-based controller — thresholds on voltage that triggered battery dispatch. It oscillated badly; batteries fought each other across homes and we got voltage flicker. So that approach told us coordination had to be predictive, not reactive. Then we built a forecasting model off historical generation and weather, and drove dispatch from the forecast. That was better in steady conditions but fell apart during fast partial-cloud transitions — the forecast lagged reality. The third iteration was a distributed approach where each home's controller negotiates with its neighbours instead of relying on a central forecast. That held voltage much better, but it introduced a new problem: the negotiation could fail to converge when comms latency spiked.\n\nDana: Where did it land?\n\nMarcus: We've got the distributed negotiation working in simulation and on a small bench setup. Voltage stays within band in most scenarios. The open question we're still chasing is convergence guarantees under degraded communications — we don't yet know the conditions where it's provably stable. And honestly there's a lot of homeowner-app polish we did too, the dashboard and notifications, which took a chunk of time. But the core controller is the real work.\n\nDana: Anything on results?\n\nMarcus: In sim, the distributed controller cut voltage excursions by about two-thirds versus the rule-based baseline. That's the headline. The convergence-under-latency thing is next year's problem.";

export const HELIOS_ANALYSIS: TranscriptAnalysis = {
  "company_context": "Verdant Grid Technologies builds controllers for residential solar microgrids: neighbourhood clusters of homes with rooftop solar and batteries.",
  "project_goal": "Build a predictive load-balancing controller that keeps voltage stable across a cluster while shifting load and battery charge and discharge.",
  "business_problem": "Feeders overload when many homes export at noon or draw heavily at dinner, and standard grid controls assume a central operator.",
  "scientific_technical_problem": "It was unknown whether cluster-level net load could be forecast accurately enough, at a fast enough timescale, to act ahead of voltage events under two-way, intermittent power flow with no trusted real-time central meter.",
  "passive_uncertainties": [
    "Standard grid controls assume a central operator and predictable one-way power flow, which does not hold for the cluster."
  ],
  "active_uncertainties": [
    "Whether a useful cluster-level net load forecast was possible at the required timescale given fast cloud-cover changes.",
    "Under what communication conditions a distributed negotiation between home controllers is provably stable."
  ],
  "technological_objective": "Develop a controller that holds cluster voltage within band under bidirectional, intermittent generation without a central real-time meter.",
  "work_performed": {
    "prior_year_status": null,
    "workplan_steps": [
      "Rule-based voltage-threshold battery dispatch",
      "Forecast-driven dispatch from historical generation and weather",
      "Distributed neighbour-to-neighbour negotiation between home controllers"
    ],
    "hypothesis": "Predictive, coordinated dispatch can hold cluster voltage within band where reactive control cannot.",
    "experiments_iterations": [
      {
        "problem_addressed": "Voltage stability under reactive control",
        "approach": "Rule-based controller with voltage thresholds triggering battery dispatch",
        "results": "Batteries oscillated and fought each other across homes, causing voltage flicker",
        "conclusions": "Coordination had to be predictive, not reactive"
      },
      {
        "problem_addressed": "Acting ahead of voltage events",
        "approach": "Forecasting model from historical generation and weather driving dispatch",
        "results": "Better in steady conditions but lagged during fast partial-cloud transitions",
        "conclusions": "A central forecast could not keep up with fast transitions"
      },
      {
        "problem_addressed": "Forecast lag during fast transitions",
        "approach": "Distributed controllers negotiating with neighbours instead of a central forecast",
        "results": "Held voltage much better in simulation and on a bench setup, but negotiation could fail to converge when communication latency spiked",
        "conclusions": "Convergence under degraded communications remains unresolved"
      }
    ]
  },
  "advancements_achieved": [
    "In simulation the distributed controller cut voltage excursions by about two-thirds versus the rule-based baseline."
  ],
  "remaining_uncertainties": [
    "Convergence guarantees for the distributed negotiation under degraded communications."
  ],
  "project_status": "Working in simulation and on a small bench setup; convergence under latency carries into next year.",
  "unreliable_narrator_flags": [],
  "gaps": [
    "No field deployment results."
  ],
  "useful_quotes": [
    "We genuinely didn't know if a useful forecast was even possible at the timescale we needed."
  ]
};

/** Reference sections the QA-style call scores. */
export const HELIOS_SECTIONS = {
  "242": "Verdant Grid set out to build a controller that keeps voltage stable across a residential solar microgrid while shifting load and battery dispatch. Standard grid controls assume a central operator and one-way power flow. In this cluster power flows both ways, generation is intermittent and no central meter can be trusted in real time. It was not known whether cluster-level net load could be forecast accurately enough to act ahead of a voltage event, given how quickly cloud cover changes generation.",
  "244": "The team first tried a rule-based controller that dispatched batteries at voltage thresholds. Batteries across homes oscillated against each other and caused voltage flicker, which showed that coordination had to be predictive. The team then drove dispatch from a forecast built on historical generation and weather. It worked in steady conditions but lagged during fast partial-cloud transitions. The third iteration replaced the central forecast with controllers that negotiate with their neighbours. This held voltage better in simulation and on a bench setup, but the negotiation could fail to converge when communication latency spiked.",
  "246": "In simulation the distributed controller cut voltage excursions by about two-thirds against the rule-based baseline. The work showed that reactive threshold control and a central forecast both fail under fast transitions, and that neighbour negotiation can hold voltage within band in most scenarios. The conditions under which the negotiation is provably stable remain unknown and carry into the next year."
} as const;

/** The seed role the eval batch drafts. */
export const EVAL_SEED_ROLE = "active_uncertainties" as const;

export const EVAL_BRIEF = {
  storyline:
    "Verdant Grid tried reactive, forecast-driven and distributed control to hold microgrid voltage; convergence under latency is still open.",
  entries: [
    "Cluster-level net load forecasting at the needed timescale was uncertain.",
    "Distributed negotiation may not converge when communication latency spikes.",
  ],
};

// ─── Role-specific tasks (review finding 9) ─────────────────────────────────

/**
 * condense_digest: facts a digest of the Helios interview must keep. Each is
 * matched case-insensitively anywhere in the digest's fields.
 */
export const CONDENSE_REQUIRED_FACTS = [
  "Marcus Lindqvist",
  "Verdant Grid",
  "two-thirds",
  "rule-based",
  "latency",
  "simulation",
] as const;

/**
 * retrieval_queries: the queries search past reports by technology, so they
 * must name no person or company, and must carry the project's technical
 * vocabulary (at least RETRIEVAL_MIN_DOMAIN_TERMS of these, across all four).
 */
export const RETRIEVAL_FORBIDDEN_NAMES = ["Verdant", "Marcus", "Lindqvist", "Dana"] as const;
export const RETRIEVAL_DOMAIN_TERMS = [
  "voltage",
  "forecast",
  "microgrid",
  "battery",
  "latency",
  "converg",
  "load",
  "solar",
  "distributed",
  "controller",
] as const;
export const RETRIEVAL_MIN_DOMAIN_TERMS = 3;

/**
 * style_classification: a settings document that legislates exactly two
 * waivable categories, banned words and paragraph density, and nothing else.
 */
export const STYLE_EVAL_DOCUMENT = [
  "My rules for every report I write:",
  "1. Never use the words \"innovative\", \"cutting-edge\" or \"novel\" anywhere in a report.",
  "2. Keep every paragraph to three sentences or fewer.",
].join("\n");
export const STYLE_EVAL_EXPECTED = ["bannedWords", "paragraphDensity"] as const;

/**
 * changelog_summary: one day of commits. Release notes must not leak the
 * implementation terms below to writers.
 */
export const CHANGELOG_EVAL_WORK_DAY = "2026-09-20";
export const CHANGELOG_EVAL_COMMITS = [
  { subject: "Fix PD upload retry in documents.ts when the network drops", body: "Retry the upload mutation once on a dropped connection." },
  { subject: "Add Excel timesheet import to the financial page" },
  { subject: "Refactor providerConfig helpers", body: "No behavior change." },
] as const;
export const CHANGELOG_FORBIDDEN_TERMS = ["documents.ts", "providerConfig", "mutation"] as const;
