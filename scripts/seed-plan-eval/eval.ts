// The release-blocking semantic suite for Step by step (CAP-13) and the
// CAP-14 seed-stage numbers. scripts/seed-plan-eval.mjs is the command line;
// this module holds everything it runs: fixture loading and validation, the
// scripted writer actions per fixture, the runner (through an injected
// driver, so it never talks to Convex itself), the automatic checks, the
// latency and request figures, and the judging pack writer. The pure parts
// are unit tested in tests/seedPlanEval.test.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../../shared/pdSubsections";
import { droppedUncertaintyFigures, figuresOf, LEAVE_OUT_FIGURE_NOTE_PREFIX } from "../../shared/planFigures";
import { releaseEvalProjectTitle } from "../../shared/releaseEval";
import { findSourceTalk, sourceTalkSubject } from "../../shared/humanProse";
import { bannedTermPattern } from "../../shared/bannedWords";
import { sectionMetrics, WORD_CAPS } from "../../convex/lib/lineLimits";
import { matchesSettingsTitle } from "../../convex/lib/settingsDocument";
import { extractSettingsRules } from "../../convex/lib/settingsExtraction";
import {
  PLAN_ROLE_IDS,
  RESULT_ROLE_IDS,
  advancementLinkProblem,
  experimentsForDroppedUncertainties,
  isAnswerRole,
  isPlanRole,
  isResultRole,
  pickedLinkSelections,
  resultsForDroppedUncertainties,
  revisionRoots,
  type AnswerRoleId,
  type UncertaintyRoot,
} from "../../shared/advancementLinks";

// ─── Semantic cases ─────────────────────────────────────────────────────────

/**
 * The five cases CAP-13 names for the release-blocking suite, in the spec's
 * order. The other semantic checks CAP-13 and CAP-4 require (an edited term
 * in the drafted Section, merged advancements named in the Compliance Note,
 * writer-asserted items drafted as Writer's Notes, a Feedback instruction on
 * Subsection 1 respected in Subsection 9) ride on these five fixtures.
 *
 * 2026-10-02 (owner decision on alert 7): a sixth case measures how well a
 * draft follows a writer's settings document in Writer's Notes. CAP-13 does
 * not name it, so it carries its own basis.
 */
export const SEMANTIC_CASES = {
  carried_old_selections: {
    spec: "carried old selections",
    title: "Carried old selections",
    also: ["an edited term appears in the drafted Section", "a writer-asserted item is drafted as a Writer's Note"],
  },
  skipped_role_supported: {
    spec: "skipped role supported by the Brief",
    title: "Skipped role supported by the Brief",
    also: [],
  },
  withdrawn_feedback: {
    spec: "corrected-then-withdrawn Feedback",
    title: "Corrected then withdrawn Feedback",
    also: ["a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4)"],
  },
  exclusion_conflict: {
    spec: "exclusion-matching selection",
    title: "Exclusion-matching selection",
    also: ["a writer-asserted item is drafted as a Writer's Note"],
  },
  changed_advancement_links: {
    spec: "changed advancement links",
    title: "Changed advancement links",
    also: ["two advancements sharing an uncertainty are merged and the Compliance Note names the merge"],
  },
  writer_settings_document: {
    spec: "a writer's settings document in Writer's Notes is followed",
    title: "Writer settings document",
    also: ["the Compliance Note rows show what the product believed it applied from the settings document"],
    basis: "owner decision 2026-10-02, alert 7",
  },
} as const;
export type SemanticCase = keyof typeof SEMANTIC_CASES;

// ─── Fixtures ───────────────────────────────────────────────────────────────

export type FixtureSource = {
  kind: "transcript" | "document";
  file: string;
  label?: string;
  fileName?: string;
  category?: "previous_pd" | "scoping_notes" | "writer_notes" | "background";
};

export type CaseParams = {
  carried_old_selections: {
    editedTerm: string;
    editSentence: string;
    switchRole: PdSubsectionRoleId;
    regenerateRole: PdSubsectionRoleId;
    /** 2026-09-30 (fourth, review P3-6): the framing the writer switches to. */
    switchHint?: string;
  };
  skipped_role_supported: { skipRole: PdSubsectionRoleId; priorYearMarker: string };
  withdrawn_feedback: {
    keptInstruction: string;
    keptTerm: string;
    replacedTerm: string;
    withdrawnInstruction: string;
    withdrawnTerm: string;
  };
  exclusion_conflict: {
    exclusionHint: string;
    exclusionRole: PdSubsectionRoleId;
    writerAssertedRole: PdSubsectionRoleId;
    writerAssertedSentence: string;
    writerAssertedTerm: string;
  };
  changed_advancement_links: { uncertainties: number; experiments: number };
  /**
   * 2026-10-02 (alert 7): the explicit rules of the writer's settings
   * document, as data, so the checks never parse the document. Validation
   * proves each rule is stated in the document and tempting to break.
   */
  writer_settings_document: SettingsParams;
};

export type SettingsLine = "242" | "244" | "246";

export type SettingsParams = {
  /** The document source holding the settings document (category writer_notes). */
  settingsFile: string;
  /** Its first line, without the heading mark. */
  settingsTitle: string;
  /**
   * Required terms for named variables, each with the synonyms it bans.
   * `allowedWithTerm`: a synonym in a sentence that also uses the term is
   * not a break (the document allows it beside the term).
   */
  requiredTerms: Array<{ term: string; synonyms: string[]; allowedWithTerm?: boolean }>;
  /** Banned words and phrases; `forms` are other spellings and inflections. */
  bannedPhrases: Array<{ phrase: string; forms?: string[] }>;
  /** Exact words a statement must open with, in its Line. */
  requiredOpenings: Array<{ statement: string; section: SettingsLine; opening: string }>;
  /** A word cap per Line, below the CRA cap. */
  wordCaps: Record<SettingsLine, number>;
  /** Work the document excludes; any marker in a Line counts as a mention. */
  exclusions: Array<{ name: string; markers: string[] }>;
  /** The one style rule; `rule` is its sentence in the document. */
  styleRule: { kind: "noFirstPerson"; rule: string };
};

export type FixtureManifest = {
  id: string;
  title: string;
  clientName: string;
  industry?: string;
  interviewees?: string[];
  fictional: boolean;
  semanticCase: SemanticCase;
  purpose: string;
  /** What changed in the scripted session and why, shown in the judging pack. */
  notes?: string[];
  sources: FixtureSource[];
  mustNotAppearInSources: string[];
  mustAppearInSources: string[];
  params: Record<string, unknown>;
  judgmentQuestions: string[];
};

export type Fixture = FixtureManifest & {
  dir: string;
  texts: Record<string, string>;
};

export const MIN_FIXTURE_WORDS = 2000;
export const MAX_FEEDBACK_CHARS = 300;
export const MAX_EDITED_BULLET_CHARS = 600;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function loadFixture(dir: string): Fixture {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as FixtureManifest;
  const texts: Record<string, string> = {};
  for (const source of manifest.sources ?? []) {
    const file = path.join(dir, source.file);
    texts[source.file] = existsSync(file) ? readFileSync(file, "utf8") : "";
  }
  return { ...manifest, dir, texts };
}

export function loadFixtures(root: string, only?: readonly string[]): Fixture[] {
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(root, entry.name, "manifest.json")))
    .map((entry) => entry.name)
    .sort();
  const selected = only && only.length ? ids.filter((id) => only.includes(id)) : ids;
  const unknown = (only ?? []).filter((id) => !ids.includes(id));
  if (unknown.length) throw new Error(`Unknown fixture(s): ${unknown.join(", ")}`);
  return selected.map((id) => loadFixture(path.join(root, id)));
}

const ROLE_IDS = new Set<string>(PD_SUBSECTIONS.map((role) => role.roleId));
const roleDef = (roleId: string) => PD_SUBSECTIONS.find((role) => role.roleId === roleId);

/** Terms the scripted actions insert must be absent from the sources, so
 * finding them in the drafted text proves they came from the plan. */
export function sentinelTerms(fixture: FixtureManifest): string[] {
  const p = fixture.params as Record<string, unknown>;
  switch (fixture.semanticCase) {
    case "carried_old_selections":
      return [String(p.editedTerm ?? "")];
    case "withdrawn_feedback":
      return [String(p.keptTerm ?? ""), String(p.withdrawnTerm ?? "")];
    case "exclusion_conflict":
      return [String(p.writerAssertedTerm ?? "")];
    default:
      return [];
  }
}

function has(text: string, term: string): boolean {
  return term.length > 0 && text.toLowerCase().includes(term.toLowerCase());
}

/** Every problem that stops a fixture from running; empty means valid. */
export function validateFixture(fixture: Fixture): string[] {
  const problems: string[] = [];
  const need = (ok: unknown, message: string) => {
    if (!ok) problems.push(message);
  };
  need(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fixture.id ?? ""), "id must be kebab-case");
  need(path.basename(fixture.dir) === fixture.id, "id must match its folder name");
  need(fixture.title?.trim(), "title is required");
  need(fixture.clientName?.trim(), "clientName is required");
  need(fixture.fictional === true, "fictional must be true (never real client data)");
  need(fixture.semanticCase in SEMANTIC_CASES, `semanticCase must be one of ${Object.keys(SEMANTIC_CASES).join(", ")}`);
  need(fixture.purpose?.trim(), "purpose is required");
  need(Array.isArray(fixture.judgmentQuestions) && fixture.judgmentQuestions.length > 0, "at least one judgment question is required");
  need(Array.isArray(fixture.sources) && fixture.sources.some((s) => s.kind === "transcript"), "at least one transcript source is required");

  const allText: string[] = [];
  for (const source of fixture.sources ?? []) {
    const text = fixture.texts[source.file] ?? "";
    need(text.trim(), `${source.file} is missing or empty`);
    if (source.kind === "document") {
      need(source.fileName?.trim(), `${source.file}: document sources need a fileName`);
    }
    allText.push(text);
  }
  const combined = allText.join("\n");
  const words = wordCount(combined);
  need(words >= MIN_FIXTURE_WORDS, `sources hold ${words} words; a fixture needs at least ${MIN_FIXTURE_WORDS}`);

  for (const [label, value] of [
    ["sources", combined],
    ["manifest", JSON.stringify({ ...fixture, dir: undefined, texts: undefined })],
  ] as const) {
    if (/[\u2013\u2014]/.test(value)) problems.push(`${label} contain an em or en dash; use a plain hyphen`);
    if (/[\u2018\u2019\u201c\u201d\u2026]/.test(value)) problems.push(`${label} contain curly quotes or an ellipsis character`);
  }

  for (const term of [...(fixture.mustNotAppearInSources ?? []), ...sentinelTerms(fixture)]) {
    if (has(combined, term)) problems.push(`"${term}" must not appear in the sources`);
  }
  for (const term of fixture.mustAppearInSources ?? []) {
    if (!has(combined, term)) problems.push(`"${term}" must appear in the sources`);
  }

  const p = (fixture.params ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof p[key] === "string" ? (p[key] as string) : "");
  const role = (key: string, kind?: string) => {
    const value = text(key);
    if (!ROLE_IDS.has(value)) problems.push(`params.${key} must be a Subsection role id`);
    else if (kind && roleDef(value)?.kind !== kind) problems.push(`params.${key} must be a ${kind} Subsection`);
  };
  const feedback = (key: string) => {
    const value = text(key);
    need(value.trim(), `params.${key} is required`);
    need(value.length <= MAX_FEEDBACK_CHARS, `params.${key} exceeds ${MAX_FEEDBACK_CHARS} characters`);
  };
  switch (fixture.semanticCase) {
    case "carried_old_selections":
      need(text("editedTerm").trim(), "params.editedTerm is required");
      need(has(text("editSentence"), text("editedTerm")), "params.editSentence must contain params.editedTerm");
      role("switchRole");
      role("regenerateRole");
      need(
        (roleDef(text("switchRole"))?.order ?? 99) < (roleDef(text("regenerateRole"))?.order ?? 0),
        "params.switchRole must come before params.regenerateRole",
      );
      need(
        p.switchHint === undefined || (text("switchHint").trim() !== "" && contentWordOverlap(text("switchHint"), combined) === 1),
        "params.switchHint must use words from the sources",
      );
      break;
    case "skipped_role_supported":
      role("skipRole", "optional");
      need(has(combined, text("priorYearMarker")), "params.priorYearMarker must appear in the sources");
      break;
    case "withdrawn_feedback":
      feedback("keptInstruction");
      feedback("withdrawnInstruction");
      need(has(text("keptInstruction"), text("keptTerm")), "params.keptInstruction must name params.keptTerm");
      need(has(text("withdrawnInstruction"), text("withdrawnTerm")), "params.withdrawnInstruction must name params.withdrawnTerm");
      need(has(combined, text("replacedTerm")), "params.replacedTerm must appear in the sources");
      break;
    case "exclusion_conflict":
      need(has(combined, text("exclusionHint")), "params.exclusionHint must appear in the sources");
      role("exclusionRole");
      role("writerAssertedRole");
      need(has(text("writerAssertedSentence"), text("writerAssertedTerm")), "params.writerAssertedSentence must contain params.writerAssertedTerm");
      break;
    case "changed_advancement_links":
      need(Number(p.uncertainties) >= 2, "params.uncertainties must be at least 2");
      // One experiment for each of two uncertainties, so one is left after the drop.
      need(Number(p.experiments) >= 2, "params.experiments must be at least 2");
      break;
    case "writer_settings_document":
      problems.push(...settingsParamsProblems(fixture, p as unknown as SettingsParams));
      break;
  }
  return problems;
}

/** Lowercase with every run of whitespace as one space. */
const plain = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The phrase in the text by the settings matcher (settingsTermPattern, review P2-1). */
function found(text: string, phrase: string): boolean {
  return phrase.trim().length > 0 && settingsTermPattern(phrase).test(text);
}

/**
 * 2026-10-02 (alert 7): a settings fixture is valid only when the product
 * would apply its document (Writer's Notes, a settings title, the caps its
 * own extraction reads) and every rule is both stated in the document and
 * tempting to break (the interview or notes use a synonym, the banned word,
 * the first person, and mention the excluded work).
 */
function settingsParamsProblems(fixture: Fixture, params: SettingsParams): string[] {
  const problems: string[] = [];
  const need = (ok: unknown, message: string) => {
    if (!ok) problems.push(message);
  };
  const source = (fixture.sources ?? []).find((candidate) => candidate.file === params.settingsFile);
  need(
    source?.kind === "document" && source.category === "writer_notes",
    "params.settingsFile must name a document source in category writer_notes",
  );
  const settings = fixture.texts[params.settingsFile ?? ""] ?? "";
  const others = (fixture.sources ?? [])
    .filter((candidate) => candidate.file !== params.settingsFile)
    .map((candidate) => fixture.texts[candidate.file] ?? "")
    .join("\n");
  need(
    source && matchesSettingsTitle(source.fileName ?? source.file, settings),
    "the settings document's file name or first line must be a settings title the product detects",
  );
  const firstLine = (settings.split(/\r?\n/).find((line) => line.trim()) ?? "").replace(/^#+\s*/, "").trim();
  need(
    (params.settingsTitle ?? "").trim() && firstLine.toLowerCase() === params.settingsTitle.trim().toLowerCase(),
    "params.settingsTitle must be the settings document's first line",
  );

  const terms = Array.isArray(params.requiredTerms) ? params.requiredTerms : [];
  need(terms.length >= 4 && terms.length <= 6, "params.requiredTerms must hold 4 to 6 terms");
  for (const { term, synonyms } of terms) {
    need(found(settings, term ?? ""), `the settings document must state the required term "${term}"`);
    need(Array.isArray(synonyms) && synonyms.length > 0, `"${term}" needs at least one synonym`);
    const list = Array.isArray(synonyms) ? synonyms : [];
    // Review P3-3: every scored synonym is one the document names.
    for (const synonym of list) {
      need(found(settings, synonym), `the settings document must name the synonym "${synonym}" of "${term}"`);
    }
    need(
      list.some((synonym) => found(others, synonym)),
      `the interview or notes must use a synonym of "${term}", so the rule is tempting to break`,
    );
    for (const synonym of list) {
      for (const other of terms) {
        if (has(synonym, other.term) || has(other.term, synonym)) {
          problems.push(`the synonym "${synonym}" must not overlap the required term "${other.term}"`);
        }
      }
    }
  }

  for (const entry of terms) {
    need(
      entry.allowedWithTerm === undefined || typeof entry.allowedWithTerm === "boolean",
      `params.requiredTerms "${entry.term}": allowedWithTerm must be true or false`,
    );
  }

  const banned = Array.isArray(params.bannedPhrases) ? params.bannedPhrases : [];
  need(banned.length >= 5 && banned.length <= 8, "params.bannedPhrases must hold 5 to 8 phrases");
  for (const entry of banned) {
    need(found(settings, entry.phrase ?? ""), `the settings document must ban "${entry.phrase}"`);
    need(
      bannedForms(entry).some((form) => found(others, form)),
      `the interview or notes must use "${entry.phrase}", so the rule is tempting to break`,
    );
  }

  const openings = Array.isArray(params.requiredOpenings) ? params.requiredOpenings : [];
  need(openings.length > 0, "params.requiredOpenings needs at least one opening");
  for (const entry of openings) {
    need(SETTINGS_LINES.includes(entry.section), `the opening for "${entry.statement}" must name Line 242, 244 or 246`);
    need(
      (entry.opening ?? "").trim() && bannedTermPattern(entry.opening.trim()).test(settings),
      `the settings document must state the opening "${entry.opening}"`,
    );
  }

  const extracted = extractSettingsRules(settings).selfCheckRules;
  for (const line of SETTINGS_LINES) {
    const cap = params.wordCaps?.[line];
    need(
      Number.isInteger(cap) && cap > 0 && cap < WORD_CAPS[lineKey(line)],
      `params.wordCaps.${line} must be a whole number below the CRA cap of ${WORD_CAPS[lineKey(line)]} words`,
    );
    need(
      extracted.some((rule) => rule.section === line && rule.maxWords === cap),
      `the settings document must state the Line ${line} cap of ${cap} words so the product's rule extraction reads it`,
    );
  }

  const exclusions = Array.isArray(params.exclusions) ? params.exclusions : [];
  need(exclusions.length >= 1 && exclusions.length <= 3, "params.exclusions must hold 1 to 3 items");
  for (const entry of exclusions) {
    need(found(settings, entry.name ?? ""), `the settings document must exclude "${entry.name}"`);
    need(
      (entry.markers ?? []).some((marker) => found(others, marker)),
      `the interview or notes must mention "${entry.name}", so the rule is tempting to break`,
    );
  }

  need(params.styleRule?.kind === "noFirstPerson", 'params.styleRule.kind must be "noFirstPerson"');
  need(
    (params.styleRule?.rule ?? "").trim() && plain(settings).includes(plain(params.styleRule.rule)),
    "the settings document must state params.styleRule.rule",
  );
  need(firstPersonHits(others).length > 0, "the interview or notes must use the first person, so the style rule is tempting to break");
  return problems;
}

// ─── The scripted writer actions ────────────────────────────────────────────

export type Pick =
  | { kind: "first" }
  | { kind: "firstN"; n: number }
  | { kind: "notSelected" }
  | { kind: "selected" }
  | { kind: "linkedAdvancements"; n: number };

export type EditTransform =
  | { kind: "appendSentence"; sentence: string }
  | { kind: "addExclusionBullet"; hint: string };

export type Step =
  | { op: "open"; role: PdSubsectionRoleId }
  | { op: "select"; role: PdSubsectionRoleId; pick: Pick }
  | { op: "deselect"; role: PdSubsectionRoleId; pick: Pick; note?: string }
  | { op: "switchSelection"; role: PdSubsectionRoleId; note?: string; hint?: string }
  | { op: "selectSharedAdvancements"; n: number }
  | { op: "selectCoveringExperiments"; n: number; minUncertainties: number }
  | { op: "deselectMostLinkedUncertainty" }
  | { op: "deselectExperimentsForDroppedUncertainty" }
  | { op: "recordLinkNotice"; role: PdSubsectionRoleId }
  | { op: "deselectUnlinkedAdvancements" }
  | { op: "resolveResultsForDroppedUncertainty"; role: AnswerRoleId }
  | { op: "edit"; role: PdSubsectionRoleId; transform: EditTransform; key: string }
  | { op: "feedback"; role: PdSubsectionRoleId; key: string; target: "selected" | "notSelected"; instruction: string }
  | { op: "selectRevised"; role: PdSubsectionRoleId; key: string; deselectTarget: boolean }
  | { op: "withdrawFeedback"; role: PdSubsectionRoleId; key: string }
  | { op: "skip"; role: PdSubsectionRoleId }
  | { op: "regenerate"; role: PdSubsectionRoleId }
  | { op: "approve"; role: PdSubsectionRoleId; expect?: "carried" | "exclusion" | "unlinkedRefused" | "droppedRefused"; key?: string }
  | { op: "reapproveStale" }
  | { op: "signOff" };

const ORDER = PD_SUBSECTIONS.map((role) => role.roleId);
const between = (from: PdSubsectionRoleId, to: PdSubsectionRoleId) =>
  ORDER.slice(ORDER.indexOf(from), ORDER.indexOf(to) + 1);

/** The ordinary decision for a Subsection nobody scripted differently. */
export function defaultDecision(role: PdSubsectionRoleId, options: { keepPriorYear?: boolean } = {}): Step[] {
  if (role === "prior_year_status" && !options.keepPriorYear) return [{ op: "skip", role }];
  const pick: Pick =
    role === "specific_advancements"
      ? { kind: "linkedAdvancements", n: 2 }
      : role === "experimentation" || role === "active_uncertainties"
        ? { kind: "firstN", n: 2 }
        : { kind: "first" };
  return [{ op: "open", role }, { op: "select", role, pick }, { op: "approve", role }];
}

function defaults(from: PdSubsectionRoleId, to: PdSubsectionRoleId): Step[] {
  return between(from, to).flatMap((role) => defaultDecision(role));
}

/** The whole scripted session for one fixture, from first open to sign-off. */
export function buildPlan(fixture: FixtureManifest): Step[] {
  const p = fixture.params as Record<string, unknown>;
  switch (fixture.semanticCase) {
    case "carried_old_selections": {
      const params = p as CaseParams["carried_old_selections"];
      return [
        { op: "open", role: "company_context" },
        { op: "select", role: "company_context", pick: { kind: "first" } },
        { op: "edit", role: "company_context", key: "editedTerm", transform: { kind: "appendSentence", sentence: params.editSentence } },
        { op: "approve", role: "company_context" },
        ...defaults("goal_problem", "experimentation"),
        // The writer changes their mind about the goal after later steps were
        // approved: every approved successor goes Stale.
        {
          op: "switchSelection",
          role: params.switchRole,
          note: "writer switches the goal framing",
          ...(params.switchHint ? { hint: params.switchHint } : {}),
        },
        { op: "approve", role: params.switchRole },
        // A fresh Batch for the uncertainties; the writer keeps the old
        // selections and must confirm them as carried.
        { op: "regenerate", role: params.regenerateRole },
        { op: "approve", role: params.regenerateRole, expect: "carried", key: "carried" },
        { op: "reapproveStale" },
        ...defaults("overall_advancement", "goal_improvements"),
        { op: "signOff" },
      ];
    }
    case "skipped_role_supported": {
      const params = p as CaseParams["skipped_role_supported"];
      return [
        ...defaults("company_context", "active_uncertainties"),
        // Open first so the pack shows the sources support the role, then skip.
        { op: "open", role: params.skipRole },
        { op: "skip", role: params.skipRole },
        ...between("workplan", "goal_improvements")
          .filter((role) => role !== params.skipRole)
          .flatMap((role) => defaultDecision(role, { keepPriorYear: true })),
        { op: "signOff" },
      ];
    }
    case "withdrawn_feedback": {
      const params = p as CaseParams["withdrawn_feedback"];
      return [
        { op: "open", role: "company_context" },
        { op: "select", role: "company_context", pick: { kind: "first" } },
        { op: "feedback", role: "company_context", key: "kept", target: "selected", instruction: params.keptInstruction },
        { op: "selectRevised", role: "company_context", key: "kept", deselectTarget: true },
        { op: "feedback", role: "company_context", key: "withdrawn", target: "notSelected", instruction: params.withdrawnInstruction },
        { op: "withdrawFeedback", role: "company_context", key: "withdrawn" },
        { op: "approve", role: "company_context" },
        ...defaults("goal_problem", "goal_improvements"),
        { op: "signOff" },
      ];
    }
    case "exclusion_conflict": {
      const params = p as CaseParams["exclusion_conflict"];
      return ORDER.flatMap((role): Step[] => {
        if (role === params.exclusionRole) {
          return [
            { op: "open", role },
            { op: "select", role, pick: defaultPick(role) },
            { op: "edit", role, key: "exclusion", transform: { kind: "addExclusionBullet", hint: params.exclusionHint } },
            { op: "approve", role, expect: "exclusion", key: "exclusion" },
          ];
        }
        if (role === params.writerAssertedRole) {
          return [
            { op: "open", role },
            { op: "select", role, pick: { kind: "first" } },
            { op: "edit", role, key: "writerAsserted", transform: { kind: "appendSentence", sentence: params.writerAssertedSentence } },
            { op: "approve", role },
          ];
        }
        return defaultDecision(role);
      }).concat({ op: "signOff" });
    }
    case "changed_advancement_links": {
      const params = p as CaseParams["changed_advancement_links"];
      return [
        ...defaults("company_context", "technological_objective"),
        { op: "open", role: "active_uncertainties" },
        { op: "select", role: "active_uncertainties", pick: { kind: "firstN", n: params.uncertainties } },
        { op: "approve", role: "active_uncertainties" },
        ...defaults("prior_year_status", "hypothesis"),
        // 2026-09-29 (first): a writer picks experiments by what they tested,
        // one for each uncertainty first, not the first few on the page.
        { op: "open", role: "experimentation" },
        { op: "selectCoveringExperiments", n: params.experiments, minUncertainties: 2 },
        { op: "approve", role: "experimentation" },
        ...defaults("overall_advancement", "goal_improvements"),
        // The writer drops the uncertainty most advancements link to.
        { op: "deselectMostLinkedUncertainty" },
        { op: "approve", role: "active_uncertainties" },
        // 2026-09-30 (fifth): Work plan and Hypothesis record the
        // uncertainties they plan work for or test. In step order, before
        // the experiments: where a pick records the dropped uncertainty, the
        // step says so, approval is refused, and the writer unticks it and
        // picks (or regenerates for) one for a kept uncertainty.
        { op: "resolveResultsForDroppedUncertainty", role: "workplan" },
        { op: "resolveResultsForDroppedUncertainty", role: "hypothesis" },
        // Its experiments can no longer be approved into the plan: the step
        // says so, approval is refused, and the writer unticks them (or
        // picks experiments for a kept uncertainty when none is left).
        { op: "recordLinkNotice", role: "experimentation" },
        { op: "approve", role: "experimentation", expect: "droppedRefused", key: "droppedExperiments" },
        { op: "deselectExperimentsForDroppedUncertainty" },
        { op: "approve", role: "experimentation" },
        { op: "recordLinkNotice", role: "specific_advancements" },
        { op: "approve", role: "specific_advancements", expect: "unlinkedRefused", key: "unlinked" },
        { op: "regenerate", role: "specific_advancements" },
        { op: "deselectUnlinkedAdvancements" },
        { op: "selectSharedAdvancements", n: 2 },
        { op: "approve", role: "specific_advancements" },
        // 2026-09-30 (fourth): Advancement to science and goal improvements
        // record the uncertainties they answer. Once step 11 is fixed (its
        // picks no longer state the dropped results), where a pick answers
        // the dropped uncertainty the step says so and approval is refused;
        // where its words state a dropped result, approval asks to
        // acknowledge it. Either way the writer unticks it and picks (or
        // regenerates for) an idea for a kept uncertainty.
        { op: "resolveResultsForDroppedUncertainty", role: "overall_advancement" },
        { op: "resolveResultsForDroppedUncertainty", role: "goal_improvements" },
        { op: "reapproveStale" },
        { op: "signOff" },
      ];
    }
    case "writer_settings_document":
      // 2026-10-02 (alert 7): the plainest path, so the fixture measures the
      // settings document, not the writer's choices: the ordinary decision
      // on every step (Previous-year status skipped), then sign-off.
      return [...defaults("company_context", "goal_improvements"), { op: "signOff" }];
  }
}

function defaultPick(role: PdSubsectionRoleId): Pick {
  const step = defaultDecision(role, { keepPriorYear: true }).find((s) => s.op === "select");
  return step && step.op === "select" ? step.pick : { kind: "first" };
}

export function describeStep(step: Step): string {
  const title = (role: string) => roleDef(role)?.title ?? role;
  const pick = (value: Pick) =>
    value.kind === "first"
      ? "the first Seed"
      : value.kind === "firstN"
        ? `the first ${value.n} Seeds`
        : value.kind === "notSelected"
          ? "a Seed not yet selected"
          : value.kind === "selected"
            ? "the selected Seeds"
            : `${value.n} advancements linked to active selections (preferring a shared uncertainty)`;
  switch (step.op) {
    case "open":
      return `Open ${title(step.role)} and wait for its Batch`;
    case "select":
      return `${title(step.role)}: select ${pick(step.pick)}`;
    case "deselect":
      return `${title(step.role)}: untick ${pick(step.pick)}${step.note ? ` (${step.note})` : ""}`;
    case "switchSelection":
      return step.hint
        ? `${title(step.role)}: select the Seed closest to "${step.hint}" (else one that states a goal, else the next Seed on the page) and untick the earlier selection${step.note ? ` (${step.note})` : ""}`
        : step.role === "goal_problem"
          ? `${title(step.role)}: select a different Seed that states a goal (else the next Seed on the page) and untick the earlier selection${step.note ? ` (${step.note})` : ""}`
          : `${title(step.role)}: select a different Seed and untick the earlier selection${step.note ? ` (${step.note})` : ""}`;
    case "selectSharedAdvancements":
      return `Specific technological advancements: select ${step.n} linked advancements sharing one uncertainty (regenerating up to twice to find them)`;
    case "selectCoveringExperiments":
      return `Experimentation / Iterations: select ${step.n} experiments by the uncertainty each tested, one for each picked uncertainty first, covering at least ${step.minUncertainties} (regenerating up to twice to find them)`;
    case "deselectMostLinkedUncertainty":
      return "Technological uncertainties: untick the uncertainty most selected advancements link to";
    case "recordLinkNotice":
      return `${title(step.role)}: read what the step says about its links before approving`;
    case "deselectExperimentsForDroppedUncertainty":
      return "Experimentation / Iterations: untick the experiments that tested the dropped uncertainty (regenerating for the kept uncertainties if none is left)";
    case "deselectUnlinkedAdvancements":
      return "Specific technological advancements: untick advancements whose links are no longer active";
    case "resolveResultsForDroppedUncertainty":
      if (isPlanRole(step.role)) {
        return `${title(step.role)}: read what the step says about its links, expect the refusal where a pick ${step.role === "hypothesis" ? "tests" : "plans work for"} the dropped uncertainty, untick it, and pick (or regenerate for) one for a kept uncertainty`;
      }
      return `${title(step.role)}: read what the step says about its links and what approval asks to acknowledge, expect the refusal where a pick answers the dropped uncertainty, untick every pick that answers it or states its result, and pick (or regenerate for) an idea that answers a kept uncertainty`;
    case "edit":
      return step.transform.kind === "appendSentence"
        ? `${title(step.role)}: edit the selected Seed, adding "${step.transform.sentence}"`
        : `${title(step.role)}: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "${step.transform.hint}"`;
    case "feedback":
      return `${title(step.role)}: give Feedback on the ${step.target === "selected" ? "selected" : "next unselected"} Seed: "${step.instruction}"`;
    case "selectRevised":
      return `${title(step.role)}: select the first Revised Seed${step.deselectTarget ? " and untick the original" : ""}`;
    case "withdrawFeedback":
      return `${title(step.role)}: withdraw the "${step.key}" Feedback`;
    case "skip":
      return `Skip ${title(step.role)}`;
    case "regenerate":
      return `${title(step.role)}: Regenerate and wait for the fresh Batch`;
    case "approve":
      return step.expect === "carried"
        ? `${title(step.role)}: Confirm and approve the carried selections`
        : step.expect === "exclusion"
          ? `${title(step.role)}: approve, confirming the Claim Exclusion warning`
          : step.expect === "unlinkedRefused"
            ? `${title(step.role)}: try to approve and expect the unlinked-advancement refusal`
            : step.expect === "droppedRefused"
              ? `${title(step.role)}: try to approve and expect the refusal for experiments that tested the dropped uncertainty`
              : `Approve ${title(step.role)}`;
    case "reapproveStale":
      return "Confirm and approve every Stale Subsection, in order";
    case "signOff":
      return "Wait for readiness and the drafting inputs, sign off, and wait for the report";
  }
}

// ─── Deployment guard and options ───────────────────────────────────────────

export const PRODUCTION_DEPLOYMENTS = ["energized-salamander-237"];

export type EvalOptions = {
  dryRun: boolean;
  cleanup: boolean;
  render: string | null;
  deployment: string | null;
  confirmSpend: boolean;
  allowCloudDev: boolean;
  as: string | null;
  fixtures: string[];
  out: string | null;
  singleBaseline: boolean;
  help: boolean;
};

export function parseArgs(argv: readonly string[]): EvalOptions {
  const options: EvalOptions = {
    dryRun: false,
    cleanup: false,
    render: null,
    deployment: null,
    confirmSpend: false,
    allowCloudDev: false,
    as: null,
    fixtures: [],
    out: null,
    singleBaseline: false,
    help: false,
  };
  const value = (i: number, name: string) => {
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`${name} needs a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run": options.dryRun = true; break;
      case "--cleanup": options.cleanup = true; break;
      case "--render": options.render = value(i, arg); i += 1; break;
      case "--confirm-spend": options.confirmSpend = true; break;
      case "--allow-cloud-dev": options.allowCloudDev = true; break;
      case "--single-baseline": options.singleBaseline = true; break;
      case "--help": case "-h": options.help = true; break;
      case "--deployment": options.deployment = value(i, arg); i += 1; break;
      case "--as": options.as = value(i, arg); i += 1; break;
      case "--out": options.out = value(i, arg); i += 1; break;
      case "--fixture": options.fixtures.push(value(i, arg)); i += 1; break;
      default: throw new Error(`Unknown option ${arg}`);
    }
  }
  if ([options.dryRun, options.cleanup, options.render !== null].filter(Boolean).length > 1) {
    throw new Error("--dry-run, --cleanup and --render cannot be combined");
  }
  return options;
}

/** A local deployment: `local` (the CLI's name for the local backend), `local-*`, or an anonymous one. */
export function isLocalDeployment(name: string): boolean {
  return /^(local|anonymous)(-[a-z0-9-]+)?$/.test(name);
}

/**
 * Why this invocation must not touch a deployment, or null when it may.
 * Never production; never a cloud deployment unless --allow-cloud-dev;
 * paid runs need --confirm-spend; a deploy key in the environment is refused
 * because it can point the CLI somewhere other than --deployment.
 */
export function deploymentRefusal(options: EvalOptions, env: Record<string, string | undefined>): string | null {
  if (options.dryRun || options.render !== null) return null;
  const name = options.deployment?.trim();
  if (!name) return "Name the deployment with --deployment (for example --deployment local).";
  const lowered = name.toLowerCase();
  if (PRODUCTION_DEPLOYMENTS.includes(lowered) || lowered === "prod" || lowered.startsWith("prod/") || /(^|[^a-z])prod(uction)?([^a-z]|$)/.test(lowered)) {
    return `Refusing ${name}: the suite never runs against production.`;
  }
  if (!isLocalDeployment(lowered) && !options.allowCloudDev) {
    return `Refusing ${name}: it is not a local deployment. Add --allow-cloud-dev to run on a cloud development deployment.`;
  }
  if (env.CONVEX_DEPLOY_KEY) {
    return "Refusing to run with CONVEX_DEPLOY_KEY set: unset it so --deployment alone chooses the target.";
  }
  if (!options.as?.trim()) return "Name the reviewer account to act as with --as <email>.";
  if (!options.cleanup && !options.confirmSpend) {
    return "This run makes paid model calls. Add --confirm-spend to go ahead, or use --dry-run.";
  }
  return null;
}

// ─── The driver and the runner ──────────────────────────────────────────────

/** A refused Convex call: the domain error's code and reason when known. */
export class EvalCallError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly reason: string | null,
    readonly data: unknown,
  ) {
    super(message);
  }
}

/** Parse `npx convex run` stderr into the ConvexError data it carries. */
/**
 * 2026-09-30 (fourth, final check P3-3): an approval the scripted writer was
 * about to send while the step asks to acknowledge picks whose words state a
 * dropped result. The scripted writer never acknowledges one; it is said
 * plainly instead of failing as a changed challenge, retried.
 */
export class DroppedResultAcknowledgementNeeded extends Error {
  readonly seedIds: string[];
  constructor(role: string, seedIds: string[]) {
    super(`${role}: approval asks to acknowledge ${seedIds.length} pick(s) whose words state a result of the dropped uncertainty; the scripted writer replaces them instead`);
    this.name = "DroppedResultAcknowledgementNeeded";
    this.seedIds = seedIds;
  }
}

/** Throws DroppedResultAcknowledgementNeeded when the challenge asks for one. */
export function assertNoAcknowledgementNeeded(role: string, challenge: { droppedResultSeedIds?: string[] }): void {
  if (challenge.droppedResultSeedIds?.length) throw new DroppedResultAcknowledgementNeeded(role, challenge.droppedResultSeedIds);
}

export function parseConvexError(raw: string): EvalCallError {
  // eslint-disable-next-line no-control-regex
  const output = raw.replace(/\u001b\[[0-9;]*m/g, "");
  const match = output.match(/ConvexError:\s*(\{[\s\S]*?\})\s*(?:\n|$)/);
  if (match) {
    try {
      const data = JSON.parse(match[1]) as { code?: string; reason?: string; message?: string };
      return new EvalCallError(data.message ?? output.trim(), data.code ?? null, data.reason ?? null, data);
    } catch {
      // Fall through to the plain message.
    }
  }
  return new EvalCallError(output.trim() || "Convex call failed", null, null, null);
}

// ─── Waiting out the per-user limits ────────────────────────────────────────

/** How long one run may spend waiting out RATE_LIMITED refusals, in all. */
export const RATE_LIMIT_WAIT_BUDGET_MS = 45 * 60_000;
/** Added to the server's retryAfter so the bucket has surely refilled. */
export const RATE_LIMIT_MARGIN_MS = 5_000;
/** Used when a RATE_LIMITED refusal carries no retryAfter. */
export const RATE_LIMIT_DEFAULT_RETRY_MS = 60_000;

/** The run's shared allowance; one per invocation, across every fixture. */
export type RateLimitBudget = { totalMs: number; waitedMs: number };

export function rateLimitBudget(totalMs: number = RATE_LIMIT_WAIT_BUDGET_MS): RateLimitBudget {
  return { totalMs, waitedMs: 0 };
}

/** The server's retryAfter (whole seconds) in ms, or null when not RATE_LIMITED. */
export function rateLimitRetryAfterMs(error: unknown): number | null {
  if (!(error instanceof EvalCallError) || error.code !== "RATE_LIMITED") return null;
  const data = error.data as { retryAfter?: unknown } | null;
  const seconds = typeof data?.retryAfter === "number" && Number.isFinite(data.retryAfter) && data.retryAfter > 0 ? data.retryAfter : null;
  return seconds === null ? RATE_LIMIT_DEFAULT_RETRY_MS : Math.ceil(seconds * 1000);
}

export function formatWait(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const secondsLeft = total % 60;
  if (!minutes) return `${secondsLeft} s`;
  return secondsLeft ? `${minutes} min ${secondsLeft} s` : `${minutes} min`;
}

/**
 * Run an action; when the server refuses it with RATE_LIMITED, wait the
 * refusal's retryAfter plus a margin and run the same action again, until
 * the run's allowance is spent. The limits themselves are never bypassed or
 * changed: the script only waits, as a writer would.
 */
export async function waitOutRateLimits<T>(
  label: string,
  action: () => Promise<T>,
  clock: { sleep(ms: number): Promise<void>; log(line: string): void },
  budget: RateLimitBudget,
): Promise<T> {
  for (;;) {
    try {
      return await action();
    } catch (error) {
      const retryAfterMs = rateLimitRetryAfterMs(error);
      if (retryAfterMs === null) throw error;
      const waitMs = retryAfterMs + RATE_LIMIT_MARGIN_MS;
      const leftMs = budget.totalMs - budget.waitedMs;
      const scope = ((error as EvalCallError).data as { scope?: unknown } | null)?.scope;
      const whose = typeof scope === "string" ? `${scope} limit` : "limit";
      if (waitMs > leftMs) {
        throw new Error(
          `${label} is still refused by the ${whose}. Waiting ${formatWait(waitMs)} more would pass this run's ${formatWait(budget.totalMs)} allowance (${formatWait(budget.waitedMs)} already spent waiting), so the run stops here. The limits were not changed.`,
        );
      }
      clock.log(
        `Rate limited: ${label} was refused by the ${whose} ("${(error as EvalCallError).message}"). Waiting ${formatWait(waitMs)}, then trying the same action again; ${formatWait(leftMs - waitMs)} of this run's ${formatWait(budget.totalMs)} allowance will be left.`,
      );
      budget.waitedMs += waitMs;
      await clock.sleep(waitMs);
    }
  }
}

export type EvalDriver = {
  /** A public mutation, as the reviewer. */
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** A public query, as the reviewer. */
  query(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** An internal query (seedPlanEval reads), with the deployment's admin access. */
  internal(name: string, args: Record<string, unknown>): Promise<unknown>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
};

export type Timeouts = {
  pollMs: number;
  seedStageMs: number;
  batchMs: number;
  draftingInputsMs: number;
  reportMs: number;
};

export const DEFAULT_TIMEOUTS: Timeouts = {
  pollMs: 2_000,
  seedStageMs: 15 * 60_000,
  batchMs: 6 * 60_000,
  draftingInputsMs: 20 * 60_000,
  reportMs: 45 * 60_000,
};

type SeedItem = {
  seedId: string;
  batchId: string;
  bullets: string[];
  selected: boolean;
  edited: boolean;
  revisionOfSeedId: string | null;
  feedbackRequestId: string | null;
  uncertaintySeedId: string | null;
  experimentSeedIds: string[];
  /** 2026-09-30 (fourth): the uncertainties a result answers; absent before. */
  answeredUncertaintySeedIds?: string[];
};
type SubsectionView = {
  state: string;
  stale: boolean;
  items: SeedItem[];
  feedbackGroups: Array<{ requestId: string; status: string; batchId: string | null; revisedSeedIds: string[] }>;
  shownBatchId: string | null;
  pendingBatchId: string | null;
  lastAttemptFailed?: boolean;
  /** 2026-09-29 (first): why the step's links stop its approval. */
  linkNotice?: { kind: string; seedIds?: string[] } | null;
};
type OutlineView = {
  rows: Array<{ roleId: PdSubsectionRoleId; state: string; stale: boolean }>;
  readiness: { ready: boolean; blockingRoleIds: string[] };
  usage: { requests: number; notice: boolean };
  seedStageVersion: number;
  draftingInputs: { status: string };
};
type Challenge = {
  approvalChallenge: string;
  carriedSeedIds: string[];
  exclusionEntryIds: string[];
  changedRoleIds: string[];
  /** 2026-09-30 (fourth): picks whose words state a dropped result; absent before. */
  droppedResultSeedIds?: string[];
};

export type RunLog = {
  fixtureId: string;
  projectId: string | null;
  generationId: string | null;
  startedAt: number;
  finishedAt: number | null;
  lines: string[];
  edits: Record<string, { roleId: string; seedId: string; bullets: string[]; exclusionEntryId?: string; exclusionText?: string }>;
  feedback: Record<string, { roleId: string; requestId: string; targetSeedId: string; withdrawnAt?: number }>;
  approvals: Array<{ roleId: string; at: number; key?: string; carriedSeedIds: string[]; exclusionEntryIds: string[]; changedRoleIds: string[] }>;
  refusals: Array<{ roleId: string; key?: string; code: string | null; reason: string | null }>;
  removedUncertaintySeedId: string | null;
  /** 2026-09-29 (first): each step's link notice when the script read it. Absent in older results. */
  linkNotices?: Record<string, string | null>;
  /**
   * 2026-09-30 (fourth): for Advancement to science and goal improvements,
   * how many picks answered the dropped uncertainty when the script looked.
   * Absent in older results.
   */
  droppedResultPicks?: Record<string, number>;
  /**
   * 2026-09-30 (fourth, review re-check): how many picks approval asked the
   * writer to acknowledge, their words stating a dropped result. Absent in
   * older results.
   */
  droppedResultAcknowledgements?: Record<string, number>;
  retries: number;
  singleBaseline: { generationId: string; requestedAt: number; reportGeneratedAt: number } | null;
  error: string | null;
};

export function emptyRunLog(fixtureId: string, now: number): RunLog {
  return {
    fixtureId,
    projectId: null,
    generationId: null,
    startedAt: now,
    finishedAt: null,
    lines: [],
    edits: {},
    feedback: {},
    approvals: [],
    refusals: [],
    removedUncertaintySeedId: null,
    linkNotices: {},
    retries: 0,
    singleBaseline: null,
    error: null,
  };
}

export function appendSentence(bullet: string, sentence: string): string {
  const trimmed = bullet.trim();
  const base = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return `${base} ${sentence.trim()}`;
}

export function exclusionBullet(text: string): string {
  const bullet = `The work also covered this: ${text.trim()}`;
  return bullet.length <= MAX_EDITED_BULLET_CHARS ? bullet : bullet.slice(0, MAX_EDITED_BULLET_CHARS);
}

/** Pick the exclusion whose text or excerpt mentions the hint, else the first. */
export function chooseExclusion<T extends { text: string; exactExcerpt?: string }>(entries: readonly T[], hint: string): T | null {
  return entries.find((entry) => has(entry.text, hint) || has(entry.exactExcerpt ?? "", hint)) ?? entries[0] ?? null;
}

/**
 * Advancements linked under the product's rule (2026-09-29, first): a picked
 * uncertainty and picked experiments that tested it (an experiment that
 * records no uncertainty supports any). `activeExperiments` maps each picked
 * experiment to the uncertainty it tested. Grouped so the largest group
 * sharing one uncertainty comes first (the merge case).
 */
export function linkedAdvancements(
  items: readonly SeedItem[],
  activeUncertainties: ReadonlySet<string>,
  activeExperiments: ReadonlyMap<string, string | null>,
  n: number,
  rootOf?: UncertaintyRoot,
): SeedItem[] {
  const picked = pickedLinkSelections(
    activeUncertainties,
    [...activeExperiments].map(([seedId, uncertaintySeedId]) => ({ seedId, uncertaintySeedId })),
    rootOf,
  );
  const linked = items.filter((item) => advancementLinkProblem(item, picked) === null);
  const groups = new Map<string, SeedItem[]>();
  for (const item of linked) {
    const key = item.uncertaintySeedId as string;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
  return ordered.flat().slice(0, n);
}

/**
 * 2026-09-30 (fourth): the idea a writer picks for Advancement to science or
 * goal improvements after dropping an uncertainty: the first one not picked
 * that answers at least one uncertainty and only uncertainties still picked
 * (a revision counts as its original). Null when the page has none.
 */
export function resultAnsweringKept(
  items: readonly SeedItem[],
  activeUncertainties: ReadonlySet<string>,
  rootOf: UncertaintyRoot = (seedId) => seedId,
): SeedItem | null {
  const picked = new Set([...activeUncertainties].map(rootOf));
  return (
    items.find((item) => {
      const answered = item.answeredUncertaintySeedIds ?? [];
      return !item.selected && answered.length > 0 && answered.every((seedId) => picked.has(rootOf(seedId)));
    }) ?? null
  );
}

/**
 * 2026-09-30 (fourth, carried-old-selections): how plainly a Goal / Problem
 * Seed states a goal. 2 when it says "goal", 1 for "aim", "target",
 * "objective", "sought" and the like, 0 for anything else (a process or
 * background card).
 */
export function goalStatementScore(bullets: readonly string[]): number {
  const text = bullets.join(" ");
  if (/\bgoals?\b/i.test(text)) return 2;
  if (/\b(aims?|aimed|targets?|objectives?|sought|set out|wanted|intended|purpose)\b/i.test(text)) return 1;
  return 0;
}

/** A switch hint picks a Seed holding at least this share of its words. */
export const SWITCH_HINT_SHARE = 0.5;

/**
 * 2026-09-30 (fourth, carried-old-selections): the goal the writer switches
 * to, among the Seeds on the page not picked. First (review P3-6) the one
 * holding the most of the fixture's `hint` words, the framing it switches
 * to, when it holds at least SWITCH_HINT_SHARE of them. Else the one that
 * most plainly states a goal, and among those the one that shares the
 * fewest words with the earlier pick, then page order. Else the next Seed
 * on the page, as before.
 */
export function goalSwitchChoice(
  items: readonly SeedItem[],
  earlier: readonly SeedItem[],
  hint?: string,
): { item: SeedItem; via: "hint" | "goal" | "next" } | null {
  const candidates = items.filter((item) => !item.selected);
  if (candidates.length === 0) return null;
  if (hint) {
    const best = candidates
      .map((item, index) => ({ item, index, share: contentWordOverlap(hint, item.bullets.join(" ")) }))
      .sort((a, b) => b.share - a.share || a.index - b.index)[0];
    if (best && best.share >= SWITCH_HINT_SHARE) return { item: best.item, via: "hint" };
  }
  const earlierWords = earlier.map((item) => item.bullets.join(" ")).join(" ");
  const ranked = candidates
    .map((item, index) => ({
      item,
      index,
      score: goalStatementScore(item.bullets),
      overlap: earlierWords ? contentWordOverlap(item.bullets.join(" "), earlierWords) : 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.overlap - b.overlap || a.index - b.index);
  return ranked[0] ? { item: ranked[0].item, via: "goal" } : { item: candidates[0]!, via: "next" };
}

/**
 * The experiments a writer picks by what they tested (2026-09-29, first):
 * among `items` (the picked ones count already), one experiment for each
 * picked uncertainty no picked experiment tested yet, then, with `extras`,
 * more in turn up to `n` picked in all. Without `extras` it never takes a
 * second experiment for an uncertainty (review P2-1): the slots stay free so
 * a regenerated page can still cover the others. An experiment that tested
 * no picked uncertainty is never chosen; with no experiment recording an
 * uncertainty at all, the first ones on the page are taken.
 */
export function experimentsCoveringUncertainties(
  items: readonly SeedItem[],
  uncertaintySeedIds: readonly string[],
  n: number,
  options: { extras?: boolean; rootOf?: UncertaintyRoot } = {},
): SeedItem[] {
  const extras = options.extras ?? true;
  const rootOf = options.rootOf ?? ((seedId: string) => seedId);
  const already = items.filter((item) => item.selected);
  const candidates = items.filter((item) => !item.selected);
  const room = Math.max(0, n - already.length);
  if (!items.some((item) => item.uncertaintySeedId !== null)) return candidates.slice(0, room);
  const testedRoot = (item: SeedItem) => (item.uncertaintySeedId === null ? null : rootOf(item.uncertaintySeedId));
  const queues = new Map(uncertaintySeedIds.map((id) => [id, candidates.filter((item) => testedRoot(item) === rootOf(id))]));
  const coveredRoots = new Set(already.map(testedRoot).filter((root): root is string => root !== null));
  const picks: SeedItem[] = [];
  for (const id of uncertaintySeedIds.filter((candidate) => !coveredRoots.has(rootOf(candidate)))) {
    const next = queues.get(id)?.shift();
    if (next && picks.length < room) picks.push(next);
  }
  if (!extras) return picks;
  while (picks.length < room) {
    let took = false;
    for (const id of uncertaintySeedIds) {
      const next = queues.get(id)?.shift();
      if (!next || picks.length >= room) continue;
      picks.push(next);
      took = true;
    }
    if (!took) break;
  }
  return picks;
}

/** How many picked uncertainties (a revision counts as its original) a set of picked experiments tested. */
export function testedUncertaintyCount(
  experiments: readonly SeedItem[],
  uncertaintySeedIds: ReadonlySet<string>,
  rootOf: UncertaintyRoot = (seedId) => seedId,
): number {
  const picked = new Set([...uncertaintySeedIds].map(rootOf));
  return new Set(
    experiments
      .map((item) => (item.uncertaintySeedId === null ? null : rootOf(item.uncertaintySeedId)))
      .filter((root): root is string => root !== null && picked.has(root)),
  ).size;
}

function commandId(fixtureId: string, label: string, counter: number): string {
  return `release-eval:${fixtureId}:${label}:${counter}:${Math.random().toString(36).slice(2, 10)}`.slice(0, 128);
}

/**
 * Drive one fixture end to end through the driver: create the project,
 * start Step by step, perform the scripted steps, sign off, wait for the
 * report and read everything back. Never throws; a failure is recorded in
 * the run log and the pack shows how far the run got.
 */
export async function runFixture(
  fixture: Fixture,
  driver: EvalDriver,
  options: { timeouts?: Timeouts; singleBaseline?: boolean; rateLimitBudget?: RateLimitBudget } = {},
): Promise<{ log: RunLog; collected: Collected | null }> {
  const timeouts = options.timeouts ?? DEFAULT_TIMEOUTS;
  const budget = options.rateLimitBudget ?? rateLimitBudget();
  const log = emptyRunLog(fixture.id, driver.now());
  const say = (line: string) => {
    const stamped = `${new Date(driver.now()).toISOString()} ${line}`;
    log.lines.push(stamped);
    driver.log(`[${fixture.id}] ${line}`);
  };
  let counter = 0;
  const next = () => (counter += 1);
  /** Every scripted action: a public mutation as the reviewer, waiting out
   * RATE_LIMITED refusals within the run's allowance. */
  const act = (name: string, args: Record<string, unknown>): Promise<unknown> =>
    waitOutRateLimits(name, () => driver.mutation(name, args), { sleep: driver.sleep, log: say }, budget);

  const waitFor = async <T>(label: string, limitMs: number, probe: () => Promise<T | null>): Promise<T> => {
    const deadline = driver.now() + limitMs;
    for (;;) {
      const value = await probe();
      if (value !== null) return value;
      if (driver.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
      await driver.sleep(timeouts.pollMs);
    }
  };

  let generationId = "";
  const outline = async () => (await driver.query("seeds:getOutline", { generationId })) as OutlineView;
  const subsection = async (role: PdSubsectionRoleId) =>
    (await driver.query("seeds:getSubsection", { generationId, roleId: role })) as SubsectionView;

  /** A decision mutation with the current version, retried on a stale one. */
  const decide = async (name: string, role: PdSubsectionRoleId, args: Record<string, unknown>): Promise<unknown> => {
    for (let attempt = 0; ; attempt += 1) {
      const { seedStageVersion } = await outline();
      try {
        return await act(name, { generationId, roleId: role, expectedSeedStageVersion: seedStageVersion, ...args });
      } catch (error) {
        if (error instanceof EvalCallError && error.code === "STALE_REVISION" && attempt < 4) continue;
        throw error;
      }
    }
  };

  const markViewed = async (role: PdSubsectionRoleId, batchId: string) => {
    try {
      await decide("seeds:markBatchViewed", role, { batchId });
    } catch (error) {
      say(`markBatchViewed ${role} refused: ${(error as Error).message}`);
    }
  };

  /** Wait until the Subsection has no pending attempt and shows a Batch
   * other than `previous`; retries a failed attempt up to three times. */
  const waitShown = async (role: PdSubsectionRoleId, previous: string | null): Promise<SubsectionView> => {
    let retries = 0;
    const view = await waitFor(`a Batch for ${role}`, timeouts.batchMs * 4, async () => {
      const current = await subsection(role);
      if (current.pendingBatchId) return null;
      if (current.shownBatchId && current.shownBatchId !== previous) return current;
      if (current.lastAttemptFailed || current.state === "failed") {
        if (retries >= 3) throw new Error(`${role}: three retries failed`);
        retries += 1;
        log.retries += 1;
        say(`${role}: attempt failed, Retry ${retries}`);
        await decide("seeds:retry", role, { commandId: commandId(fixture.id, `retry-${role}`, next()) });
        return null;
      }
      return null;
    });
    if (view.shownBatchId) await markViewed(role, view.shownBatchId);
    return view;
  };

  /** Seed work already pending for a role refuses a new attempt; wait it out. */
  const waitIdle = async (role: PdSubsectionRoleId): Promise<SubsectionView> =>
    await waitFor(`${role} to finish pending work`, timeouts.batchMs, async () => {
      const current = await subsection(role);
      return current.pendingBatchId ? null : current;
    });

  const shownItems = (view: SubsectionView) => view.items.filter((item) => item.batchId === view.shownBatchId);
  const activeIds = async (role: PdSubsectionRoleId) =>
    new Set((await subsection(role)).items.filter((item) => item.selected).map((item) => item.seedId));
  /** An uncertainty and its Feedback revisions count as one (review P2-2). */
  const uncertaintyRootOf = async (): Promise<UncertaintyRoot> =>
    revisionRoots((await subsection("active_uncertainties")).items);
  /** Picked experiments and the uncertainty each tested (2026-09-29, first). */
  const activeExperiments = async () =>
    new Map(
      (await subsection("experimentation")).items
        .filter((item) => item.selected)
        .map((item) => [item.seedId, item.uncertaintySeedId] as const),
    );

  const pickItems = async (role: PdSubsectionRoleId, pick: Pick, view: SubsectionView): Promise<SeedItem[]> => {
    const shown = shownItems(view);
    switch (pick.kind) {
      case "first":
        return shown.slice(0, 1);
      case "firstN":
        return shown.slice(0, pick.n);
      case "notSelected":
        return shown.filter((item) => !item.selected).slice(0, 1);
      case "selected":
        return view.items.filter((item) => item.selected);
      case "linkedAdvancements": {
        const uncertainties = await activeIds("active_uncertainties");
        const experiments = await activeExperiments();
        return linkedAdvancements(view.items.filter((item) => !item.selected), uncertainties, experiments, pick.n, await uncertaintyRootOf());
      }
    }
  };

  const setSelected = async (role: PdSubsectionRoleId, seedId: string, selected: boolean) => {
    await decide("seeds:select", role, { seedId, selected });
  };

  /** Approve with the server's current challenge; a background completion
   * that moved the version or the challenge in between is retried. */
  const approve = async (role: PdSubsectionRoleId, key?: string, options: { expectRefusal?: boolean } = {}): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await approveOnce(role, key, options);
      } catch (error) {
        const retryable =
          error instanceof EvalCallError &&
          (error.code === "STALE_REVISION" || (error.code === "INVALID_INPUT" && /challenge/i.test(error.message)));
        if (!retryable || attempt >= 4) throw error;
      }
    }
  };

  const approveOnce = async (role: PdSubsectionRoleId, key?: string, options: { expectRefusal?: boolean } = {}): Promise<void> => {
    const { seedStageVersion } = await outline();
    const review = (await driver.query("seeds:getApprovalReview", {
      generationId,
      roleId: role,
      expectedSeedStageVersion: seedStageVersion,
    })) as { approvalChallenge: Challenge; seedStageVersion: number };
    const challenge = review.approvalChallenge;
    // An approval sent to see the server refuse it (a pick that answers the
    // dropped uncertainty is refused before the challenge is compared) goes
    // out as it is.
    if (!options.expectRefusal) assertNoAcknowledgementNeeded(role, challenge);
    await act("seeds:approve", {
      generationId,
      roleId: role,
      expectedSeedStageVersion: review.seedStageVersion,
      approvalChallenge: challenge.approvalChallenge,
      acknowledgedCarriedSeedIds: challenge.carriedSeedIds,
      acknowledgedExclusionEntryIds: challenge.exclusionEntryIds,
    });
    log.approvals.push({
      roleId: role,
      at: driver.now(),
      ...(key ? { key } : {}),
      carriedSeedIds: [...challenge.carriedSeedIds],
      exclusionEntryIds: [...challenge.exclusionEntryIds],
      changedRoleIds: [...(challenge.changedRoleIds ?? [])],
    });
    say(
      `approved ${role}` +
        (challenge.carriedSeedIds.length ? ` (confirmed ${challenge.carriedSeedIds.length} carried)` : "") +
        (challenge.exclusionEntryIds.length ? ` (confirmed ${challenge.exclusionEntryIds.length} Claim Exclusion)` : ""),
    );
  };

  /** Approve; an unlinked advancement is repaired by regenerating (CAP-9). */
  const approveOrRepair = async (role: PdSubsectionRoleId) => {
    try {
      await approve(role);
    } catch (error) {
      if (!(error instanceof EvalCallError) || error.reason !== "UNLINKED_ADVANCEMENT") throw error;
      say(`${role}: unlinked advancement, regenerating`);
      await repairAdvancements();
      await approve(role);
    }
  };

  const repairAdvancements = async () => {
    const role = "specific_advancements" as const;
    for (let round = 0; round < 3; round += 1) {
      const before = await waitIdle(role);
      await decide("seeds:regenerate", role, { commandId: commandId(fixture.id, "regenerate", next()) });
      const view = await waitShown(role, before.shownBatchId);
      await dropUnlinked(view);
      const refreshed = await subsection(role);
      const picked = await pickItems(role, { kind: "linkedAdvancements", n: 2 }, refreshed);
      for (const item of picked) await setSelected(role, item.seedId, true);
      if ((await subsection(role)).items.some((item) => item.selected)) return;
    }
    throw new Error("specific_advancements: no linked advancement after three regenerations");
  };

  const dropUnlinked = async (view: SubsectionView) => {
    const uncertainties = await activeIds("active_uncertainties");
    const experiments = await activeExperiments();
    const rootOf = await uncertaintyRootOf();
    for (const item of view.items.filter((candidate) => candidate.selected)) {
      const linked = linkedAdvancements([item], uncertainties, experiments, 1, rootOf).length === 1;
      if (!linked) {
        await setSelected("specific_advancements", item.seedId, false);
        say(`untick unlinked advancement ${item.seedId}`);
      }
    }
  };

  /**
   * Picks experiments by what they tested (2026-09-29, first), regenerating
   * the step up to twice when the page covers too few picked uncertainties.
   * A Batch never vouches for picks it did not offer: earlier picks stay.
   */
  const pickCoveringExperiments = async (n: number, minUncertainties: number) => {
    const role = "experimentation" as const;
    const pool = async () => {
      const view = await subsection(role);
      return [...view.items.filter((item) => item.selected), ...shownItems(view).filter((item) => !item.selected)];
    };
    for (let round = 0; ; round += 1) {
      const uncertaintyView = await subsection("active_uncertainties");
      const uncertainties = uncertaintyView.items.filter((item) => item.selected).map((item) => item.seedId);
      const active = new Set(uncertainties);
      const rootOf = revisionRoots(uncertaintyView.items);
      // Review P2-1: one experiment per uncovered uncertainty only, so the
      // other slots stay free for a regenerated page to cover the rest.
      for (const item of experimentsCoveringUncertainties(await pool(), uncertainties, n, { extras: false, rootOf })) {
        await setSelected(role, item.seedId, true);
      }
      const covered = testedUncertaintyCount((await pool()).filter((item) => item.selected), active, rootOf);
      const needed = Math.min(minUncertainties, active.size);
      if (covered >= needed || round >= 2) {
        // Coverage met, or no more regenerations: fill the remaining slots.
        for (const item of experimentsCoveringUncertainties(await pool(), uncertainties, n, { rootOf })) {
          await setSelected(role, item.seedId, true);
        }
        if (covered < needed) say(`the experiments cover ${covered} of ${needed} picked uncertainties after two regenerations`);
        return;
      }
      say(`the experiments cover ${covered} of ${needed} picked uncertainties; regenerating`);
      const before = await waitIdle(role);
      await decide("seeds:regenerate", role, { commandId: commandId(fixture.id, "regenerate-experiments", next()) });
      await waitShown(role, before.shownBatchId);
    }
  };

  /** The approval challenge as the approve button reads it. */
  const reviewOf = async (role: PdSubsectionRoleId): Promise<Challenge> => {
    const { seedStageVersion } = await outline();
    return ((await driver.query("seeds:getApprovalReview", {
      generationId,
      roleId: role,
      expectedSeedStageVersion: seedStageVersion,
    })) as { approvalChallenge: Challenge }).approvalChallenge;
  };

  /**
   * 2026-09-30 (fourth): a result step after the drop. A pick that answers
   * the dropped uncertainty is named by the step and refused (the refusal
   * is expected and recorded); a pick whose words state a dropped result is
   * shown at approval for an acknowledgement (review re-check), which the
   * scripted writer does not give. It unticks both kinds, picks an idea that
   * answers only kept uncertainties and that neither names, and otherwise
   * regenerates up to twice; goal improvements takes a goal restatement
   * after one regeneration (review P3-5). `approveWhenClean` approves a step
   * that needed nothing (reapproveStale), as its plain approval did.
   */
  const resolveResults = async (role: AnswerRoleId, options: { approveWhenClean: boolean }) => {
    // 2026-09-30 (fifth): Hypothesis and Work plan name their picks with
    // their own notice kind.
    const namedBy = (view: SubsectionView) =>
      new Set(
        view.linkNotice?.kind === "results_for_dropped_uncertainty" || view.linkNotice?.kind === "plans_for_dropped_uncertainty"
          ? (view.linkNotice.seedIds ?? [])
          : [],
      );
    const first = await subsection(role);
    const notice = first.linkNotice?.kind ?? null;
    const firstLook = !(role in (log.droppedResultPicks ?? {}));
    if (firstLook) {
      log.linkNotices = { ...(log.linkNotices ?? {}), [role]: notice };
      say(`${role} link notice: ${notice ?? "none"}`);
    }
    const uncertainties = await activeIds("active_uncertainties");
    const rootOf = await uncertaintyRootOf();
    const picks = first.items.filter((item) => item.selected);
    const byLink = resultsForDroppedUncertainties(
      uncertainties,
      picks.map((item) => ({ seedId: item.seedId, answeredUncertaintySeedIds: item.answeredUncertaintySeedIds ?? [] })),
      rootOf,
    ).map((result) => result.seedId);
    const named = namedBy(first);
    const answering = picks.filter((item) => byLink.includes(item.seedId) || named.has(item.seedId));
    const acknowledging = picks.length ? (await reviewOf(role)).droppedResultSeedIds ?? [] : [];
    if (firstLook) {
      log.droppedResultPicks = { ...(log.droppedResultPicks ?? {}), [role]: answering.length };
      log.droppedResultAcknowledgements = { ...(log.droppedResultAcknowledgements ?? {}), [role]: acknowledging.length };
      if (acknowledging.length) say(`${role}: approval asks to acknowledge ${acknowledging.length} pick(s) that state a dropped result`);
    }
    if (answering.length === 0 && acknowledging.length === 0) {
      if (!options.approveWhenClean) {
        say(`${role}: no pick answers the dropped uncertainty or states its result`);
        return;
      }
      await approve(role);
      return;
    }
    if (answering.length) {
      const key = `droppedResults:${role}`;
      try {
        await approve(role, key, { expectRefusal: true });
        log.refusals.push({ roleId: role, key, code: null, reason: "NOT_REFUSED" });
        say(`${role}: approval was NOT refused`);
        return;
      } catch (error) {
        const refused = error as EvalCallError;
        log.refusals.push({ roleId: role, key, code: refused.code ?? null, reason: refused.reason ?? refused.message });
        say(`${role}: refused (${refused.reason ?? refused.message})`);
      }
    }
    const tried = new Set<string>();
    const flagged = async (view: SubsectionView) =>
      new Set([...namedBy(view), ...(view.items.some((item) => item.selected) ? (await reviewOf(role)).droppedResultSeedIds ?? [] : [])]);
    for (let round = 0; ; ) {
      const view = await subsection(role);
      const drop = await flagged(view);
      for (const item of view.items.filter((candidate) => candidate.selected && (drop.has(candidate.seedId) || answering.some((pick) => pick.seedId === candidate.seedId)))) {
        await setSelected(role, item.seedId, false);
        tried.add(item.seedId);
        say(`untick ${role} idea ${item.seedId}, which answers the dropped uncertainty or states its result`);
      }
      const current = await subsection(role);
      if (current.items.some((item) => item.selected) && (await flagged(current)).size === 0) break;
      const page = shownItems(current).filter((item) => !tried.has(item.seedId));
      const replacement = resultAnsweringKept(page, uncertainties, rootOf);
      if (replacement) {
        tried.add(replacement.seedId);
        await setSelected(role, replacement.seedId, true);
        say(`${role}: picked ${replacement.seedId}, which answers a kept uncertainty`);
        continue;
      }
      const restatement =
        role === "goal_improvements" && round >= 1
          ? page.find((item) => !item.selected && (item.answeredUncertaintySeedIds ?? []).length === 0)
          : undefined;
      if (restatement) {
        tried.add(restatement.seedId);
        await setSelected(role, restatement.seedId, true);
        say(`${role}: no idea answers a kept uncertainty after one regeneration; picked a goal restatement`);
        continue;
      }
      if (round >= 2) throw new Error(`${role}: no idea answers a kept uncertainty after two regenerations`);
      round += 1;
      say(`${role}: no idea on the page answers a kept uncertainty; regenerating`);
      const before = await waitIdle(role);
      await decide("seeds:regenerate", role, { commandId: commandId(fixture.id, `regenerate-results-${role}`, next()) });
      await waitShown(role, before.shownBatchId);
    }
    await approve(role);
  };

  const perform = async (step: Step): Promise<void> => {
    say(describeStep(step));
    switch (step.op) {
      case "open": {
        const before = await subsection(step.role);
        if (before.shownBatchId && !before.pendingBatchId) {
          await markViewed(step.role, before.shownBatchId);
          return;
        }
        await decide("seeds:open", step.role, { commandId: commandId(fixture.id, `open-${step.role}`, next()) });
        await waitShown(step.role, null);
        return;
      }
      case "select": {
        const view = await subsection(step.role);
        const picked = await pickItems(step.role, step.pick, view);
        if (!picked.length && step.pick.kind === "linkedAdvancements") {
          say("no advancement links to the active selections; regenerating");
          await repairAdvancements();
          return;
        }
        if (!picked.length) throw new Error(`${step.role}: nothing to select for ${step.pick.kind}`);
        for (const item of picked) await setSelected(step.role, item.seedId, true);
        return;
      }
      case "deselect": {
        const view = await subsection(step.role);
        for (const item of await pickItems(step.role, step.pick, view)) await setSelected(step.role, item.seedId, false);
        return;
      }
      case "switchSelection": {
        const view = await subsection(step.role);
        const earlier = view.items.filter((item) => item.selected);
        // 2026-09-30 (fourth): switching the goal framing takes another
        // Seed that states a goal (run 11 took a process card), else the
        // next Seed on the page, as before.
        let replacement: SeedItem | undefined;
        if (step.role === "goal_problem" || step.hint) {
          const choice = goalSwitchChoice(shownItems(view), earlier, step.hint);
          replacement = choice?.item;
          if (choice) {
            say(
              choice.via === "hint"
                ? `switching to the Seed closest to "${step.hint}": ${choice.item.seedId}`
                : choice.via === "goal"
                  ? `${step.hint ? `no Seed holds most of "${step.hint}"; ` : ""}switching to a Seed that states a goal: ${choice.item.seedId}`
                  : "no other Seed on the page states a goal; taking the next Seed",
            );
          }
        } else {
          replacement = shownItems(view).find((item) => !item.selected);
        }
        if (!replacement) throw new Error(`${step.role}: no other Seed to switch to`);
        await setSelected(step.role, replacement.seedId, true);
        for (const item of earlier) await setSelected(step.role, item.seedId, false);
        return;
      }
      case "selectSharedAdvancements": {
        const role = "specific_advancements" as const;
        for (let round = 0; ; round += 1) {
          const view = await subsection(role);
          const uncertainties = await activeIds("active_uncertainties");
          const experiments = await activeExperiments();
          const selected = view.items.filter((item) => item.selected);
          const candidates = linkedAdvancements(view.items, uncertainties, experiments, view.items.length, await uncertaintyRootOf());
          const groups = new Map<string, SeedItem[]>();
          for (const item of candidates) {
            groups.set(item.uncertaintySeedId as string, [...(groups.get(item.uncertaintySeedId as string) ?? []), item]);
          }
          const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
          if (best.length >= step.n || round >= 2) {
            const chosen = best.slice(0, step.n);
            if (!chosen.length) {
              await repairAdvancements();
              return;
            }
            for (const item of chosen) if (!item.selected) await setSelected(role, item.seedId, true);
            for (const item of selected) {
              if (!chosen.some((pick) => pick.seedId === item.seedId)) await setSelected(role, item.seedId, false);
            }
            if (best.length < step.n) say(`only ${best.length} advancement(s) share one uncertainty`);
            return;
          }
          say(`only ${best.length} advancement(s) share one uncertainty; regenerating`);
          const before = await waitIdle(role);
          await decide("seeds:regenerate", role, { commandId: commandId(fixture.id, "regenerate-shared", next()) });
          await waitShown(role, before.shownBatchId);
        }
      }
      case "selectCoveringExperiments": {
        await pickCoveringExperiments(step.n, step.minUncertainties);
        return;
      }
      case "deselectMostLinkedUncertainty": {
        const advancements = (await subsection("specific_advancements")).items.filter((item) => item.selected);
        const counts = new Map<string, number>();
        for (const item of advancements) {
          if (item.uncertaintySeedId) counts.set(item.uncertaintySeedId, (counts.get(item.uncertaintySeedId) ?? 0) + 1);
        }
        const active = await activeIds("active_uncertainties");
        // Review P3-4: the uncertainty the manifest describes, whatever it
        // leaves: when no kept uncertainty has an experiment, the writer
        // recovers as the step says (deselectExperimentsForDroppedUncertainty).
        const target = [...counts.entries()].filter(([id]) => active.has(id)).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!target) throw new Error("No selected advancement links to an active uncertainty");
        if (active.size < 2) throw new Error("Only one uncertainty is selected; nothing would remain");
        log.removedUncertaintySeedId = target;
        await setSelected("active_uncertainties", target, false);
        return;
      }
      case "recordLinkNotice": {
        const kind = (await subsection(step.role)).linkNotice?.kind ?? null;
        log.linkNotices = { ...(log.linkNotices ?? {}), [step.role]: kind };
        say(`${step.role} link notice: ${kind ?? "none"}`);
        return;
      }
      case "deselectExperimentsForDroppedUncertainty": {
        const uncertainties = await activeIds("active_uncertainties");
        const view = await subsection("experimentation");
        const picked = view.items.filter((item) => item.selected);
        const rootOf = await uncertaintyRootOf();
        const dropped = experimentsForDroppedUncertainties(
          uncertainties,
          picked.map((item) => ({ seedId: item.seedId, uncertaintySeedId: item.uncertaintySeedId })),
          rootOf,
        );
        for (const experiment of dropped) {
          await setSelected("experimentation", experiment.seedId, false);
          say(`untick experiment ${experiment.seedId}, which tested the dropped uncertainty`);
        }
        // With nothing left for a kept uncertainty, the writer follows the
        // step's advice and picks experiments for the uncertainties they kept.
        const left = (await subsection("experimentation")).items.filter((item) => item.selected);
        if (testedUncertaintyCount(left, uncertainties, rootOf) === 0) {
          say("no picked experiment tests a kept uncertainty; picking experiments for them");
          await pickCoveringExperiments(Math.max(1, dropped.length), 1);
        }
        return;
      }
      case "deselectUnlinkedAdvancements": {
        await dropUnlinked(await subsection("specific_advancements"));
        return;
      }
      case "resolveResultsForDroppedUncertainty": {
        await resolveResults(step.role, { approveWhenClean: false });
        return;
      }
      case "edit": {
        const view = await subsection(step.role);
        const target = view.items.find((item) => item.selected);
        if (!target) throw new Error(`${step.role}: no selected Seed to edit`);
        let bullets: string[];
        let exclusion: { entryId: string; text: string } | null = null;
        if (step.transform.kind === "appendSentence") {
          bullets = [appendSentence(target.bullets[0] ?? "", step.transform.sentence), ...target.bullets.slice(1, 2)];
        } else {
          const entries = (await driver.internal("seedPlanEval:briefExclusions", { generationId })) as Array<{
            entryId: string;
            text: string;
            exactExcerpt: string;
          }>;
          exclusion = chooseExclusion(entries, step.transform.hint);
          if (!exclusion) throw new Error("The Brief derived no Claim Exclusion to select against");
          bullets = [target.bullets[0] ?? "", exclusionBullet(exclusion.text)];
        }
        await decide("seeds:edit", step.role, { seedId: target.seedId, bullets });
        log.edits[step.key] = {
          roleId: step.role,
          seedId: target.seedId,
          bullets,
          ...(exclusion ? { exclusionEntryId: exclusion.entryId, exclusionText: exclusion.text } : {}),
        };
        return;
      }
      case "feedback": {
        const view = await waitIdle(step.role);
        const shown = shownItems(view);
        const target = step.target === "selected" ? view.items.find((item) => item.selected) : shown.find((item) => !item.selected);
        if (!target) throw new Error(`${step.role}: no Seed to give Feedback on`);
        const result = (await decide("seeds:giveFeedback", step.role, {
          seedId: target.seedId,
          instruction: step.instruction,
          commandId: commandId(fixture.id, `feedback-${step.key}`, next()),
        })) as { feedbackRequestId: string };
        log.feedback[step.key] = { roleId: step.role, requestId: result.feedbackRequestId, targetSeedId: target.seedId };
        const group = await waitFor(`Revised Seeds for ${step.key}`, timeouts.batchMs, async () => {
          const current = await subsection(step.role);
          if (current.pendingBatchId) return null;
          return current.feedbackGroups.find((candidate) => candidate.requestId === result.feedbackRequestId) ?? null;
        });
        if (group.batchId) await markViewed(step.role, group.batchId);
        say(`${step.key} Feedback returned ${group.revisedSeedIds.length} Revised Seed(s)`);
        if (!group.revisedSeedIds.length) throw new Error(`${step.key} Feedback returned no Revised Seed`);
        return;
      }
      case "selectRevised": {
        const request = log.feedback[step.key];
        const view = await subsection(step.role);
        const group = view.feedbackGroups.find((candidate) => candidate.requestId === request?.requestId);
        const revised = group?.revisedSeedIds[0];
        if (!request || !revised) throw new Error(`${step.role}: no Revised Seed for ${step.key}`);
        await setSelected(step.role, revised, true);
        if (step.deselectTarget) await setSelected(step.role, request.targetSeedId, false);
        return;
      }
      case "withdrawFeedback": {
        const request = log.feedback[step.key];
        if (!request) throw new Error(`No ${step.key} Feedback to withdraw`);
        await decide("seeds:withdrawFeedback", step.role, { feedbackRequestId: request.requestId });
        request.withdrawnAt = driver.now();
        return;
      }
      case "skip": {
        await decide("seeds:skip", step.role, {});
        return;
      }
      case "regenerate": {
        const before = await waitIdle(step.role);
        await decide("seeds:regenerate", step.role, { commandId: commandId(fixture.id, `regenerate-${step.role}`, next()) });
        await waitShown(step.role, before.shownBatchId);
        return;
      }
      case "approve": {
        if (step.expect === "unlinkedRefused" || step.expect === "droppedRefused") {
          try {
            await approve(step.role, step.key);
            log.refusals.push({ roleId: step.role, key: step.key, code: null, reason: "NOT_REFUSED" });
            say(`${step.role}: approval was NOT refused`);
          } catch (error) {
            const refused = error as EvalCallError;
            log.refusals.push({ roleId: step.role, key: step.key, code: refused.code ?? null, reason: refused.reason ?? refused.message });
            say(`${step.role}: refused (${refused.reason ?? refused.message})`);
          }
          return;
        }
        if (step.role === "specific_advancements") {
          await approveOrRepair(step.role);
        } else {
          await approve(step.role, step.key);
        }
        return;
      }
      case "reapproveStale": {
        for (const row of (await outline()).rows) {
          if (row.stale) {
            const view = await subsection(row.roleId);
            if (!view.items.some((item) => item.selected)) continue;
            if (row.roleId === "specific_advancements") await approveOrRepair(row.roleId);
            // 2026-09-30 (fourth, review re-check): a result step goes through
            // the same resolver, so a pick that answers or states a dropped
            // result is replaced, never approved.
            // 2026-09-30 (fifth): and so do Hypothesis and Work plan.
            else if (isAnswerRole(row.roleId)) await resolveResults(row.roleId, { approveWhenClean: true });
            else await approve(row.roleId);
          }
        }
        return;
      }
      case "signOff": {
        const ready = await waitFor("readiness and drafting inputs", timeouts.draftingInputsMs, async () => {
          const current = await outline();
          if (current.draftingInputs.status === "failed") {
            say("drafting inputs failed; Try again");
            await act("generations:retryDraftingInputs", { generationId });
            return null;
          }
          if (!current.readiness.ready) {
            if (current.draftingInputs.status === "ready") {
              throw new Error(`Not ready to sign off: ${current.readiness.blockingRoleIds.join(", ")}`);
            }
            return null;
          }
          return current.draftingInputs.status === "ready" ? current : null;
        });
        await act("generations:signOffSeedStage", { generationId, expectedSeedStageVersion: ready.seedStageVersion });
        say("signed off; waiting for the report");
        const done = await waitFor("the report", timeouts.reportMs, async () => {
          const state = (await driver.internal("seedPlanEval:progress", { generationId })) as {
            status: string;
            reportId: string | null;
          };
          if (state.status === "failed") throw new Error("Drafting failed after sign-off");
          return state.reportId ? state : null;
        });
        say(`report ${done.reportId} created`);
        return;
      }
    }
  };

  try {
    const transcripts = fixture.sources
      .filter((source) => source.kind === "transcript")
      .map((source) => ({ content: fixture.texts[source.file], label: source.label ?? source.file }));
    // projects.createProject returns { projectId, transcriptIds }.
    const created = (await act("projects:createProject", {
      title: releaseEvalProjectTitle(fixture.title),
      clientName: fixture.clientName,
      ...(fixture.industry ? { industry: fixture.industry } : {}),
      ...(fixture.interviewees?.length ? { interviewees: fixture.interviewees } : {}),
      transcripts,
    })) as { projectId?: unknown } | null;
    const projectId = typeof created?.projectId === "string" ? created.projectId : null;
    if (!projectId) throw new Error(`projects:createProject returned no projectId (${JSON.stringify(created)})`);
    log.projectId = projectId;
    say(`created project ${projectId}`);
    for (const source of fixture.sources.filter((candidate) => candidate.kind === "document")) {
      const fileName = source.fileName ?? source.file;
      await act("documents:uploadDocument", {
        projectId,
        fileName,
        fileType: fileName.endsWith(".md") ? "md" : "txt",
        content: fixture.texts[source.file],
        ...(source.category ? { category: source.category } : {}),
        extractionOutcome: "ok",
        intake: "pasted",
      });
      say(`added document ${fileName}`);
    }
    await act("generations:requestGeneration", { projectId, candidateMode: "iterative" });
    const latest = await waitFor("the generation", timeouts.pollMs * 30, async () =>
      (await driver.internal("seedPlanEval:latestGeneration", { projectId })) as { generationId: string } | null,
    );
    generationId = latest.generationId;
    log.generationId = generationId;
    say(`started Step by step generation ${generationId}`);
    await waitFor("the seed stage", timeouts.seedStageMs, async () => {
      const state = (await driver.internal("seedPlanEval:progress", { generationId })) as {
        status: string;
        seedSubsections: number;
        seedStageError: string | null;
      };
      if (state.status === "failed") throw new Error(`Generation failed before the seed stage (${state.seedStageError ?? "no detail"})`);
      return state.status === "awaiting_input" && state.seedSubsections === PD_SUBSECTIONS.length ? state : null;
    });
    say("seed stage open");
    for (const step of buildPlan(fixture)) await perform(step);

    if (options.singleBaseline) {
      await act("generations:requestGeneration", {
        projectId,
        candidateMode: "single",
        confirmRegeneration: true,
      });
      const baseline = await waitFor("the single-mode generation", timeouts.pollMs * 30, async () => {
        const found = (await driver.internal("seedPlanEval:latestGeneration", { projectId })) as { generationId: string } | null;
        return found && found.generationId !== generationId ? found : null;
      });
      const done = await waitFor("the single-mode report", timeouts.reportMs, async () => {
        const state = (await driver.internal("seedPlanEval:progress", { generationId: baseline.generationId })) as {
          status: string;
          requestedAt: number | null;
          reportGeneratedAt: number | null;
        };
        if (state.status === "failed") throw new Error("Single-mode baseline failed");
        return state.reportGeneratedAt !== null && state.requestedAt !== null ? state : null;
      });
      log.singleBaseline = {
        generationId: baseline.generationId,
        requestedAt: done.requestedAt as number,
        reportGeneratedAt: done.reportGeneratedAt as number,
      };
      say("single-mode baseline report created");
    }
  } catch (error) {
    log.error = error instanceof Error ? error.message : String(error);
    say(`stopped: ${log.error}`);
  }

  let collected: Collected | null = null;
  if (generationId) {
    try {
      collected = (await driver.internal("seedPlanEval:collect", { generationId })) as Collected;
    } catch (error) {
      say(`could not read the results: ${(error as Error).message}`);
    }
  }
  log.finishedAt = driver.now();
  return { log, collected };
}

// ─── What the eval reads back (seedPlanEval:collect) ────────────────────────

export type Collected = {
  project: { projectId: string; title: string };
  generation: {
    generationId: string;
    status: string;
    requestedAt: number | null;
    seedRequestsReserved: number;
    singleModelId: string | null;
    summaryVersionId: string | null;
    /**
     * 2026-10-02 (alert 7): the writer settings the generation ran under
     * (`generations.writerSettings`); null when none were recorded, absent in
     * results read back before it existed.
     */
    writerSettings?: null | {
      profileState: string;
      source: string;
      fileName: string | null;
      matchesProfile: boolean;
      savedProfileSuperseded: boolean;
      waiverAnalysis: string;
      truncated: boolean;
      addressedCategories: string[] | null;
    };
  };
  subsections: Array<{
    roleId: string;
    kind: string;
    state: string;
    currentContextRevision: string;
    approvedContextRevision: string | null;
    approvedWithConfirmation: boolean;
    exclusionAcknowledgedAt: number | null;
  }>;
  batches: Array<{
    batchId: string;
    roleId: string;
    operation: string;
    status: string;
    queuedAt: number;
    startedAt: number | null;
    completedAt: number | null;
    roleOpen: boolean;
    startedBy: string | null;
    requestsMade: number | null;
    seedsDropped: number | null;
    consumedContextRevision: string;
    feedbackRequestId: string | null;
    /** Why a failed Batch failed; absent in results from before 2026-09-29. */
    error?: string | null;
    errorDetail?: string | null;
    invalidAnswers?: Array<{
      seedsReturned: number;
      seedsValid: number;
      minimum: number;
      issues: Array<{ code: string; reason?: string; seeds: number }>;
    }>;
  }>;
  seeds: Array<{
    seedId: string;
    batchId: string;
    roleId: string;
    bullets: string[];
    support: string;
    revisionOfSeedId: string | null;
    feedbackRequestId: string | null;
    uncertaintySeedId: string | null;
    experimentSeedIds: string[];
    /** 2026-09-30 (fourth): absent in results read back before it existed. */
    answeredUncertaintySeedIds?: string[];
    /** 2026-09-30 (fourth, final check): ticked at some point; absent in older results. */
    everTicked?: boolean;
  }>;
  feedback: Array<{
    feedbackRequestId: string;
    roleId: string;
    targetSeedId: string;
    instruction: string;
    status: string;
    withdrawnAt: number | null;
    batchId: string | null;
  }>;
  batchContext: Array<{
    batchId: string;
    roleId: string;
    kind: string;
    sourceRoleId: string;
    seedId: string | null;
    feedbackRequestId: string | null;
  }>;
  events: Array<{
    kind: string;
    at: number;
    roleId: string | null;
    actor: "user" | "system";
    batchId: string | null;
    seedId: string | null;
    feedbackRequestId: string | null;
    confirmed: boolean | null;
  }>;
  summary: null | {
    summaryVersionId: string;
    version: number;
    skippedRoleIds: string[];
    /** 2026-09-30 (first): the dropped uncertainties frozen at sign-off; absent in older results. */
    droppedUncertaintySeedIds?: string[];
    /**
     * 2026-09-30 (second, review P3-2): the frozen rows themselves, so the
     * suite reads a dropped uncertainty's own figures from what the product
     * reads; absent in older results.
     */
    droppedUncertainties?: Array<{
      seedId: string;
      wording: string[];
      experiments: Array<{ seedId: string; wording: string[] }>;
      advancements: Array<{ seedId: string; wording: string[] }>;
      notChecked: boolean;
    }>;
    signedOffAt: number;
    items: Array<{
      itemId: string;
      roleId: string;
      kind: string;
      order: number;
      seedId: string;
      bullets: string[];
      support: string;
      tags: string[];
      uncertaintySeedId: string | null;
      experimentSeedIds: string[];
      /** 2026-09-30 (fourth): absent in results read back before it existed. */
      answeredUncertaintySeedIds?: string[];
      confirmedExclusion: boolean;
      edited: boolean | null;
    }>;
  };
  complianceNotes: Array<{
    section: string;
    paragraphIndex: number | null;
    source: string;
    instruction: string;
    outcome: string;
    tier: string;
    reason: string;
    repaired: boolean;
    planRef: null | {
      itemId: string | null;
      skippedRoleId: string | null;
      /** 2026-09-30 (first): absent in results read back before it existed. */
      droppedSeedId?: string | null;
      ruleId?: string | null;
      mergedItemIds: string[];
    };
  }>;
  report: null | { reportId: string; generatedAt: number; sections: { s242: string; s244: string; s246: string } };
  briefEntries: Array<{ entryId: string; group: string; text: string; reason: string | null }>;
  usage: Array<{ callSite: string; model: string; costUsd: number; inputTokens: number; outputTokens: number }>;
  truncated: string[];
};

// ─── Automatic checks ───────────────────────────────────────────────────────

export type CheckStatus = "pass" | "fail" | "info";
export type Check = { id: string; label: string; status: CheckStatus; evidence: string };

const check = (id: string, label: string, ok: boolean, evidence: string): Check => ({
  id,
  label,
  status: ok ? "pass" : "fail",
  evidence,
});
const info = (id: string, label: string, evidence: string): Check => ({ id, label, status: "info", evidence });

const draftedText = (c: Collected) => (c.report ? `${c.report.sections.s242}\n${c.report.sections.s244}\n${c.report.sections.s246}` : "");
const sectionOf = (roleId: string): "s242" | "s244" | "s246" => (roleDef(roleId)?.section ?? "s242") as "s242" | "s244" | "s246";
const quote = (text: string, max = 160) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return `"${clean.length > max ? `${clean.slice(0, max - 3)}...` : clean}"`;
};

/** Where a term first appears in a text, as a short excerpt for evidence. */
export function excerptAround(text: string, term: string, radius = 70): string | null {
  const at = text.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return null;
  return quote(text.slice(Math.max(0, at - radius), at + term.length + radius), radius * 2 + term.length + 8);
}

/** Share of an exclusion's content words that appear in a text. */
export function contentWordOverlap(phrase: string, text: string): number {
  const stop = new Set(["the", "a", "an", "of", "to", "and", "or", "for", "in", "on", "our", "we", "was", "is", "it", "its", "this", "that", "with", "as", "by", "not", "be", "work"]);
  const words = [...new Set(phrase.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((word) => word.length > 2 && !stop.has(word));
  if (!words.length) return 0;
  const haystack = text.toLowerCase();
  return words.filter((word) => haystack.includes(word)).length / words.length;
}

/**
 * 2026-09-30 (first): the figures with a unit in a text, normalised. Since
 * 2026-09-30 (second) the reading lives in shared/planFigures.ts, which the
 * product's LEAVE OUT figure check uses too.
 */
export { figuresOf };

/** One paragraph of a Line that holds a dropped uncertainty's words or figures. */
export type DroppedHit = { section: "242" | "244" | "246"; paragraph: number; overlap: number; figures: string[]; text: string };

/** Paragraphs sharing at least this share of the dropped uncertainty's content words count as a hit. */
export const DROPPED_WORDS_HIT_SHARE = 0.3;

/**
 * 2026-09-30 (first): every paragraph of every Line that shares at least
 * DROPPED_WORDS_HIT_SHARE of the dropped uncertainty's content words, or
 * holds a distinctive figure of it. Since (second, review P3-2) its figures
 * come from droppedUncertaintyFigures, the product's rule: its wording and
 * the experiments and advancements that recorded it, against every
 * signed-off item (skipped steps aside).
 */
export function droppedUncertaintyHits(args: {
  sections: { s242: string; s244: string; s246: string };
  droppedWording: readonly string[];
  references: ReadonlyArray<{ wording: readonly string[] }>;
  planWording: ReadonlyArray<readonly string[]>;
}): { figures: string[]; hits: DroppedHit[] } {
  const droppedWords = args.droppedWording.join(" ");
  const figures = droppedUncertaintyFigures({
    wording: args.droppedWording,
    references: args.references,
    planWording: args.planWording,
  });
  const hits: DroppedHit[] = [];
  for (const section of ["242", "244", "246"] as const) {
    const paragraphs = args.sections[`s${section}`].split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
    paragraphs.forEach((text, index) => {
      const overlap = droppedWords ? contentWordOverlap(droppedWords, text) : 0;
      const present = figuresOf(text);
      const matched = figures.filter((figure) => present.includes(figure));
      if (overlap >= DROPPED_WORDS_HIT_SHARE || matched.length > 0) {
        hits.push({ section, paragraph: index + 1, overlap, figures: matched, text });
      }
    });
  }
  return { figures, hits };
}

function commonChecks(fixture: FixtureManifest, c: Collected, log: RunLog): Check[] {
  const checks: Check[] = [];
  checks.push(check("run-completed", "The scripted session finished without an error", log.error === null, log.error ?? "every step ran"));
  checks.push(
    check(
      "report-created",
      "Sign-off led to a created report through the existing creation path",
      c.generation.status === "completed" && c.report !== null,
      `generation ${c.generation.status}; report ${c.report?.reportId ?? "missing"}`,
    ),
  );
  const sections = c.report?.sections;
  checks.push(
    check(
      "three-sections",
      "All three Sections were drafted",
      !!sections && [sections.s242, sections.s244, sections.s246].every((text) => text.trim().length > 0 && !text.includes("[NOT GENERATED]")),
      sections ? `242: ${wordCount(sections.s242)} words, 244: ${wordCount(sections.s244)} words, 246: ${wordCount(sections.s246)} words` : "no report",
    ),
  );
  const items = c.summary?.items ?? [];
  const coveredIds = new Set(c.complianceNotes.map((note) => note.planRef?.itemId).filter(Boolean));
  const uncovered = items.filter((item) => !coveredIds.has(item.itemId));
  checks.push(
    check(
      "coverage-listed",
      "The Compliance Note lists every Seed Selection as covered or not",
      !!c.summary && uncovered.length === 0,
      c.summary ? `${items.length - uncovered.length} of ${items.length} plan items have a coverage row${uncovered.length ? `; missing: ${uncovered.map((item) => item.roleId).join(", ")}` : ""}` : "no signed-off Summary",
    ),
  );
  const notCovered = c.complianceNotes.filter((note) => note.planRef?.itemId && note.outcome !== "applied" && note.tier !== "conflict");
  checks.push(
    check(
      "coverage-applied",
      "Every plan item is recorded as covered (conflicts aside)",
      !!c.summary && notCovered.length === 0,
      notCovered.length ? groupedReasons(notCovered) : "all coverage rows applied",
    ),
  );
  // The model Self-check is what records plan coverage; when it fails, every
  // coverage row above says "did not complete", so name the cause plainly.
  // Since 2026-09-28 a label or plan check it gave no verdict for is "Not
  // checked" on its own row; a Section where every one is not checked did
  // not run the check in any useful sense either.
  const selfCheckFailures = c.complianceNotes.filter((note) => note.instruction === "Model Self-check" && note.outcome !== "applied");
  // 2026-09-28 (run 4): the coverage-only check of a repaired Section's final
  // text records why it failed on its own row. The first check did run, so it
  // is named here without failing this check; its plan rows are "Not checked".
  const finalCoverageFailures = c.complianceNotes.filter((note) => note.instruction === "Final coverage Self-check" && note.outcome !== "applied");
  const notChecked = notCheckedCounts(c);
  const nothingChecked = notChecked.filter((row) => row.total > 0 && row.labels + row.planChecks === row.total);
  const partlyChecked = notChecked.filter((row) => row.labels + row.planChecks > 0 && !nothingChecked.includes(row));
  checks.push(
    check(
      "self-check-ran",
      "The model Self-check ran on every Section",
      selfCheckFailures.length === 0 && nothingChecked.length === 0,
      [
        ...selfCheckFailures.map((note) => `${note.section}: ${quote(note.reason, 120)}`),
        ...nothingChecked.map((row) => `${row.section}: every label and plan check is "Not checked" (${row.total})`),
        ...partlyChecked.map((row) => `${row.section}: ${notCheckedText(row)}`),
        ...finalCoverageFailures.map((note) => `${note.section}: ${quote(note.reason, 240)}`),
      ].join("; ") || "no Self-check failure recorded",
    ),
  );
  const lockedBreaches = c.complianceNotes.filter((note) => note.tier === "locked" && note.outcome !== "applied");
  checks.push(
    check(
      "locked-rules",
      "Every Locked Rule held (CRA line and word limits)",
      lockedBreaches.length === 0,
      lockedBreaches.length ? lockedBreaches.map((note) => `${note.section}: ${quote(note.reason, 120)}`).join("; ") : "no Locked Rule breach recorded",
    ),
  );
  const skipped = c.summary?.skippedRoleIds ?? [];
  const skipRows = skipped.map((roleId) => c.complianceNotes.find((note) => note.planRef?.skippedRoleId === roleId));
  checks.push(
    check(
      "skips-listed",
      "The Compliance Note lists every Skip as honoured or not",
      skipRows.every(Boolean),
      skipped.length ? skipped.map((roleId, i) => `${roleId}: ${skipRows[i] ? skipRows[i]!.outcome : "missing"}`).join("; ") : "no Skips",
    ),
  );
  // 2026-09-29 (first, run 7): a failed Batch is never a black box: each
  // one's error, detail and rejected answers as counts by rule and reason.
  const failedBatches = c.batches.filter((batch) => batch.status === "failed");
  checks.push(
    info(
      "failed-batches",
      "Failed Seed Batches and why (informational)",
      failedBatches.length
        ? failedBatches.map(describeFailedBatch).join("; ")
        : "no Seed Batch failed",
    ),
  );
  // 2026-09-30 (first, review P3-5): informational for every fixture. The
  // LEAVE OUT and Rule B rows are the checking model's own verdicts; the
  // judges remain the proof.
  checks.push(
    info(
      "leave-out-repairs-246",
      "Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model)",
      leaveOutRepairEvidence(c),
    ),
  );
  // 2026-09-30 (second, Rule C): informational for every fixture. Line
  // 244's work check is the checking model's own verdict; the judges remain
  // the proof.
  checks.push(
    info(
      "work-answers-242",
      "Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model)",
      workAnswers242Evidence(c),
    ),
  );
  // 2026-09-30 (third): informational for every fixture. The source-talk
  // row reruns the Self-check's own detector on the final text; the targets
  // row is the checking model's own verdict. The judges remain the proof.
  checks.push(
    info(
      "source-talk",
      "Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector)",
      sourceTalkEvidence(c),
    ),
  );
  checks.push(
    info(
      "results-against-targets",
      "Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model)",
      resultsAgainstTargetsEvidence(c),
    ),
  );
  // 2026-10-04 (second): informational for every fixture. Each Line's facts
  // row is the checking model's own verdict against the sources the draft
  // was written from; the judges, who read the fixture's sources, remain the
  // proof.
  checks.push(
    info(
      "facts-match-sources",
      "Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model)",
      factsMatchSourcesEvidence(c),
    ),
  );
  const requests = seedRequestCount(c);
  checks.push(
    info(
      "seed-requests",
      "Seed-stage requests (informational; notice at 40, never refused)",
      `${requests.metered} metered calls (${requests.seeds} Batch, ${requests.feedback} Feedback), ${requests.reserved} reserved; notice ${requests.reserved >= 40 ? "shown" : "not shown"}; ${log.retries} Retry`,
    ),
  );
  void fixture;
  return checks;
}

/**
 * 2026-09-30 (first, review P3-5): Line 246's LEAVE OUT and Rule B rows with
 * their outcome and whether a repair fixed them or was set aside, and the
 * COVER rows not applied after such a repair was used.
 */
export function leaveOutRepairEvidence(c: Collected): string {
  const rows = c.complianceNotes.filter((note) => note.section === "246" && note.planRef);
  // 2026-09-30 (third): Rule B by its own id; the targets check has its own row.
  const special = rows.filter((note) => note.planRef?.droppedSeedId || note.planRef?.ruleId === ANSWERS_242_RULE_ID);
  if (special.length === 0) return "no LEAVE OUT or Rule B row in Line 246";
  const described = special.map((note) => {
    const name = note.planRef?.ruleId ? "Rule B" : `left out ${note.planRef?.droppedSeedId}`;
    const repair = note.repaired ? ", repaired" : note.reason.includes("repair not used") ? ", repair not used" : "";
    return `${name}: ${note.outcome}${repair}`;
  });
  const repairUsed = special.some((note) => note.repaired);
  const coverLost = repairUsed
    ? rows.filter((note) => note.planRef?.itemId && note.tier !== "conflict" && note.outcome !== "applied")
    : [];
  const keptDraft = special.some((note) => note.reason.includes("no longer covers the signed-off item"));
  return `${described.join("; ")}; COVER rows not applied after such a repair: ${
    coverLost.length ? coverLost.map((note) => `${note.planRef?.itemId} (${quote(note.reason, 80)})`).join(", ") : "none"
  }${keptDraft ? "; a repair that lost a COVER item was set aside" : ""}`;
}

/**
 * 2026-09-30 (second, Rule C): Line 244's work check row with its outcome,
 * whether a repair fixed it or was set aside, its reason, and the Line 244
 * COVER rows not applied whenever its fix went to the repair (review P3-3:
 * repaired, set aside, or still not applied at a paragraph after the repair).
 */
export function workAnswers242Evidence(c: Collected): string {
  const rows = c.complianceNotes.filter((note) => note.section === "244" && note.planRef);
  const rule = rows.find((note) => note.planRef?.ruleId === "work_answers_242");
  if (!rule) return "no Rule C row in Line 244";
  const repair = rule.repaired ? ", repaired" : rule.reason.includes("repair not used") ? ", repair not used" : "";
  const fixInRepair = rule.repaired || rule.reason.includes("repair not used") ||
    (rule.outcome !== "applied" && rule.paragraphIndex !== null);
  const coverLost = fixInRepair
    ? rows.filter((note) => note.planRef?.itemId && note.tier !== "conflict" && note.outcome !== "applied")
    : [];
  return `Rule C: ${rule.outcome}${repair} (${quote(rule.reason, 120)}); COVER rows not applied after such a repair: ${
    coverLost.length ? coverLost.map((note) => `${note.planRef?.itemId} (${quote(note.reason, 80)})`).join(", ") : "none"
  }`;
}

/** 2026-09-30 (second): how a LEAVE OUT row the figure backstop recorded applied begins. */
export const LEAVE_OUT_FIGURE_BACKSTOP_PREFIX = "The flagged content is a signed-off item:";
// Since the Greptile round the product never records such a row; results
// read back from earlier runs may hold one, and the gate below reads them.

const ANSWERS_242_RULE_ID = "advancements_answer_242";
const TARGETS_RULE_ID = "results_against_targets";
const FACTS_RULE_ID = "facts_match_sources";
/** The Compliance Note instruction of the deterministic source-talk row. */
const SOURCE_TALK_ROW = "State facts without naming their source";

/** A row's outcome and whether a repair fixed it or was not used. */
function rowState(note: Collected["complianceNotes"][number]): string {
  const repair = note.repaired ? ", repaired" : note.reason.includes("repair not used") ? ", repair not used" : "";
  return `${note.outcome}${repair}`;
}

/**
 * 2026-09-30 (third): per Line, the phrases of the final text that name a
 * source (the Self-check's own detector, with the signed-off wording and
 * the Glossary Terms as the project's subject), then that Line's row.
 */
export function sourceTalkEvidence(c: Collected): string {
  if (!c.report) return "no report";
  // Review P2-4: the product's own subject rule (sourceTalkSubject).
  const skipped = c.summary?.skippedRoleIds ?? [];
  const subjectText = sourceTalkSubject({
    planWording: (c.summary?.items ?? []).filter((item) => !skipped.includes(item.roleId)).map((item) => item.bullets),
    glossaryTerms: c.briefEntries.filter((entry) => entry.group === "glossaryTerm").map((entry) => entry.text),
  });
  return (["242", "244", "246"] as const).map((section) => {
    const paragraphs = c.report!.sections[`s${section}`].split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
    const hits = paragraphs.flatMap((text, index) =>
      findSourceTalk(text, { subjectText }).map((hit) => `P${index + 1} "${hit.phrase}"`));
    const row = c.complianceNotes.find((note) => note.section === section && note.instruction === SOURCE_TALK_ROW);
    return `${section}: ${hits.length ? hits.join(", ") : "none"} (${row ? `row ${rowState(row)}` : "no row"})`;
  }).join("; ");
}

/** 2026-09-30 (third): Lines 244 and 246's targets rows, with their reasons. */
export function resultsAgainstTargetsEvidence(c: Collected): string {
  return (["244", "246"] as const).map((section) => {
    const row = c.complianceNotes.find((note) => note.section === section && note.planRef?.ruleId === TARGETS_RULE_ID);
    return `${section}: ${row ? `${rowState(row)} (${quote(row.reason, 100)})` : "no row"}`;
  }).join("; ");
}

/** 2026-10-04 (second): each Line's facts row, with its reason. */
export function factsMatchSourcesEvidence(c: Collected): string {
  return (["242", "244", "246"] as const).map((section) => {
    const row = c.complianceNotes.find((note) => note.section === section && note.planRef?.ruleId === FACTS_RULE_ID);
    return `${section}: ${row ? `${rowState(row)} (${quote(row.reason, 160)})` : "no row"}`;
  }).join("; ");
}

/** One failed Batch in a line: role, error, detail and each answer's counts. */
export function describeFailedBatch(batch: Collected["batches"][number]): string {
  const answers = (batch.invalidAnswers ?? []).map(
    (answer, index) =>
      `answer ${index + 1}: ${answer.seedsValid} of ${answer.seedsReturned} valid, needed ${answer.minimum}` +
      (answer.issues.length
        ? ` (${answer.issues.map((issue) => `${issue.code}${issue.reason ? ` ${issue.reason}` : ""} x${issue.seeds}`).join(", ")})`
        : ""),
  );
  return [`${batch.roleId} ${batch.operation}: ${batch.error ?? "failed"}${batch.errorDetail ? ` / ${batch.errorDetail}` : ""}`, ...answers].join(", ");
}

const NOT_CHECKED_PREFIX = "Not checked:";

export type NotCheckedCount = {
  section: string;
  /** Ordinary labels (Storyline, Confidence Map, Glossary, instructions) not checked. */
  labels: number;
  /** Plan items and Skips not checked. */
  planChecks: number;
  /** Every label and plan check row the Self-check was asked about. */
  total: number;
};

/**
 * Per Section, the Compliance Note rows the Self-check gave no verdict for
 * (2026-09-28). Label rows are the model rows other than consistency
 * findings and Storyline question notes; plan rows carry a plan reference.
 */
export function notCheckedCounts(c: Collected): NotCheckedCount[] {
  const sections = [...new Set(c.complianceNotes.map((note) => note.section))].sort();
  return sections.map((section) => {
    const rows = c.complianceNotes.filter((note) => note.section === section);
    const labelRows = rows.filter(
      (note) =>
        !note.planRef &&
        note.source === "model" &&
        !note.instruction.startsWith("Consistency pass") &&
        !note.reason.startsWith("Storyline question"),
    );
    const planRows = rows.filter((note) => note.planRef);
    const notChecked = (note: { reason: string }) => note.reason.startsWith(NOT_CHECKED_PREFIX);
    return {
      section,
      labels: labelRows.filter(notChecked).length,
      planChecks: planRows.filter(notChecked).length,
      total: labelRows.length + planRows.length,
    };
  });
}

function notCheckedText(row: NotCheckedCount): string {
  return `${row.labels} ${row.labels === 1 ? "label" : "labels"} and ${row.planChecks} plan ${row.planChecks === 1 ? "check" : "checks"} "Not checked" of ${row.total}`;
}

function caseChecks(fixture: FixtureManifest, c: Collected, log: RunLog): Check[] {
  const p = fixture.params as Record<string, unknown>;
  const items = c.summary?.items ?? [];
  const text = draftedText(c);
  const checks: Check[] = [];
  switch (fixture.semanticCase) {
    case "carried_old_selections": {
      const params = p as CaseParams["carried_old_selections"];
      const edit = log.edits.editedTerm;
      const editedItem = items.find((item) => item.seedId === edit?.seedId);
      checks.push(
        check(
          "edited-term-in-plan",
          "The edited Seed is in the plan, marked edited and writer-asserted",
          !!editedItem && has(editedItem.bullets.join(" "), params.editedTerm) && editedItem.support === "writer_asserted",
          editedItem ? `${quote(editedItem.bullets.join(" "))} (${editedItem.support}${editedItem.edited ? ", edited" : ""})` : "edited Seed not in the plan",
        ),
      );
      const section = c.report?.sections[sectionOf(edit?.roleId ?? "company_context")] ?? "";
      checks.push(
        check(
          "edited-term-drafted",
          `The edited term "${params.editedTerm}" appears in the drafted Section`,
          has(section, params.editedTerm),
          excerptAround(section, params.editedTerm) ?? "term not found in the Section",
        ),
      );
      const carried = log.approvals.find((approval) => approval.key === "carried");
      const role = params.regenerateRole;
      const approveEvent = [...c.events].reverse().find((event) => event.kind === "approve" && event.roleId === role);
      checks.push(
        check(
          "carried-confirmed",
          "Approving the regenerated Subsection required Confirm and approve for the carried selections",
          !!carried && carried.carriedSeedIds.length > 0 && approveEvent?.confirmed === true,
          carried ? `${carried.carriedSeedIds.length} carried Seed(s) acknowledged; changed Subsections: ${carried.changedRoleIds.join(", ") || "none listed"}; approve event confirmed=${approveEvent?.confirmed}` : "no carried approval recorded",
        ),
      );
      const regenerated = c.batches.filter((batch) => batch.roleId === role && batch.operation === "regenerate" && batch.status !== "failed");
      const carriedInPlan = (carried?.carriedSeedIds ?? []).filter((seedId) => items.some((item) => item.seedId === seedId));
      const carriedFromFresh = carriedInPlan.filter((seedId) => regenerated.some((batch) => c.seeds.find((seed) => seed.seedId === seedId)?.batchId === batch.batchId));
      checks.push(
        check(
          "carried-kept",
          "The carried selections stay in the signed-off plan and none of them came from the fresh Batch",
          carriedInPlan.length > 0 && carriedFromFresh.length === 0 && regenerated.length > 0,
          `${carriedInPlan.length} carried Seed(s) in the plan; ${regenerated.length} fresh Batch(es); ${carriedFromFresh.length} carried Seed(s) from a fresh Batch`,
        ),
      );
      const opened = c.events.filter((event) => event.kind === "staleOpened").length;
      const disposed = c.events.filter((event) => event.kind === "staleDisposed").length;
      checks.push(
        check(
          "stale-episodes",
          "Changing the goal opened stale episodes and every one was disposed before sign-off",
          opened > 0 && disposed >= opened,
          `${opened} opened, ${disposed} disposed`,
        ),
      );
      checks.push(writerAssertedCoverage(c, editedItem?.itemId ?? null));
      break;
    }
    case "skipped_role_supported": {
      const params = p as CaseParams["skipped_role_supported"];
      const role = params.skipRole;
      checks.push(
        check(
          "skip-in-plan",
          "The signed-off plan carries the Skip and no selection for the role",
          !!c.summary && c.summary.skippedRoleIds.includes(role) && !items.some((item) => item.roleId === role),
          c.summary ? `skipped: ${c.summary.skippedRoleIds.join(", ") || "none"}` : "no Summary",
        ),
      );
      const shown = c.batches.filter((batch) => batch.roleId === role && batch.status !== "failed");
      const seeds = c.seeds.filter((seed) => shown.some((batch) => batch.batchId === seed.batchId));
      const supported = seeds.filter((seed) => seed.support === "source_supported");
      checks.push(
        check(
          "role-supported",
          "The skipped role was supported: its Batch offered cited Seeds before the Skip",
          supported.length > 0,
          `${seeds.length} Seed(s) offered, ${supported.length} cited${seeds[0] ? `; first: ${quote(seeds[0].bullets.join(" "), 120)}` : ""}`,
        ),
      );
      const briefMentions = c.briefEntries.filter((entry) => has(entry.text, params.priorYearMarker));
      checks.push(
        info(
          "brief-mentions",
          `Brief entries that mention "${params.priorYearMarker}"`,
          briefMentions.length ? briefMentions.map((entry) => `${entry.group}: ${quote(entry.text, 100)}`).join("; ") : "none (the Seeds above still show source support)",
        ),
      );
      const row = c.complianceNotes.find((note) => note.planRef?.skippedRoleId === role);
      checks.push(
        check(
          "skip-honoured",
          "The Compliance Note records the Skip as honoured",
          row?.outcome === "applied",
          row ? `${row.instruction}: ${row.outcome}; ${quote(row.reason, 120)}` : "no Skip row",
        ),
      );
      const s244 = c.report?.sections.s244 ?? "";
      checks.push(
        check(
          "skip-not-drafted",
          `Heuristic: the prior-year marker "${params.priorYearMarker}" is absent from Section 244`,
          !has(s244, params.priorYearMarker),
          excerptAround(s244, params.priorYearMarker) ?? "absent",
        ),
      );
      break;
    }
    case "withdrawn_feedback": {
      const params = p as CaseParams["withdrawn_feedback"];
      const withdrawn = c.feedback.find((request) => request.feedbackRequestId === log.feedback.withdrawn?.requestId);
      const kept = c.feedback.find((request) => request.feedbackRequestId === log.feedback.kept?.requestId);
      checks.push(
        check(
          "feedback-withdrawn",
          "The correcting Feedback was withdrawn and the other stayed active",
          withdrawn?.status === "withdrawn" && kept?.status === "active",
          `withdrawn request: ${withdrawn?.status ?? "missing"}; kept request: ${kept?.status ?? "missing"}`,
        ),
      );
      const withdrawnAt = withdrawn?.withdrawnAt ?? Infinity;
      const later = c.batches.filter((batch) => batch.queuedAt > withdrawnAt);
      const leaked = c.batchContext.filter(
        (row) => row.feedbackRequestId === withdrawn?.feedbackRequestId && later.some((batch) => batch.batchId === row.batchId),
      );
      checks.push(
        check(
          "withdrawn-never-sent",
          "No Batch dispatched after the withdrawal carried the withdrawn instruction",
          !!withdrawn && later.length > 0 && leaked.length === 0,
          `${later.length} later Batch(es); ${leaked.length} carried it`,
        ),
      );
      const leakedSeeds = c.seeds.filter((seed) => later.some((batch) => batch.batchId === seed.batchId) && has(seed.bullets.join(" "), params.withdrawnTerm));
      const leakedItems = items.filter((item) => has(item.bullets.join(" "), params.withdrawnTerm));
      checks.push(
        check(
          "withdrawn-term-absent",
          `"${params.withdrawnTerm}" is absent from later Seeds, the plan and the drafted Sections`,
          leakedSeeds.length === 0 && leakedItems.length === 0 && !has(text, params.withdrawnTerm),
          `${leakedSeeds.length} later Seed(s), ${leakedItems.length} plan item(s); report: ${excerptAround(text, params.withdrawnTerm) ?? "absent"}`,
        ),
      );
      const nineBatches = c.batches.filter((batch) => batch.roleId === "experimentation");
      const nineCarries = c.batchContext.filter(
        (row) => row.feedbackRequestId === kept?.feedbackRequestId && nineBatches.some((batch) => batch.batchId === row.batchId),
      );
      checks.push(
        check(
          "kept-feedback-reaches-9",
          "The active Feedback on Subsection 1 is in Subsection 9's Decision Set",
          nineBatches.length > 0 && nineCarries.length > 0,
          `${nineCarries.length} context row(s) across ${nineBatches.length} Subsection 9 Batch(es)`,
        ),
      );
      const nineSeeds = c.seeds.filter((seed) => nineBatches.some((batch) => batch.batchId === seed.batchId));
      const usesKept = nineSeeds.filter((seed) => has(seed.bullets.join(" "), params.keptTerm)).length;
      const usesReplaced = nineSeeds.filter((seed) => has(seed.bullets.join(" "), params.replacedTerm)).length;
      checks.push(
        check(
          "kept-feedback-respected-9",
          `Heuristic: Subsection 9 Seeds say "${params.keptTerm}", not "${params.replacedTerm}"`,
          usesReplaced === 0 && usesKept > 0,
          `${usesKept} of ${nineSeeds.length} Seed(s) use the requested term; ${usesReplaced} use the replaced one`,
        ),
      );
      break;
    }
    case "exclusion_conflict": {
      const params = p as CaseParams["exclusion_conflict"];
      const exclusions = c.briefEntries.filter((entry) => entry.group === "claimExclusion");
      checks.push(
        check(
          "brief-exclusions",
          "The Brief derived at least one Claim Exclusion",
          exclusions.length > 0,
          exclusions.length ? exclusions.map((entry) => `${quote(entry.text, 90)} (${entry.reason ?? "no reason"})`).join("; ") : "none",
        ),
      );
      const edit = log.edits.exclusion;
      const approval = log.approvals.find((candidate) => candidate.key === "exclusion");
      const row = c.subsections.find((subsection) => subsection.roleId === params.exclusionRole);
      checks.push(
        check(
          "exclusion-warned",
          "Approve warned about the Claim Exclusion and the confirmation was recorded",
          !!approval && approval.exclusionEntryIds.includes(edit?.exclusionEntryId ?? "") && row?.exclusionAcknowledgedAt !== null,
          approval ? `acknowledged ${approval.exclusionEntryIds.length} exclusion(s); recorded at ${row?.exclusionAcknowledgedAt ?? "never"}` : "no exclusion approval recorded",
        ),
      );
      const item = items.find((candidate) => candidate.seedId === edit?.seedId);
      checks.push(
        check(
          "exclusion-in-plan",
          "The matching selection is signed off with the confirmed exclusion",
          item?.confirmedExclusion === true,
          item ? quote(item.bullets.join(" ")) : "matching selection not in the plan",
        ),
      );
      const conflicts = c.complianceNotes.filter((note) => note.tier === "conflict");
      checks.push(
        check(
          "conflict-recorded",
          "The Compliance Note records the conflict (tier conflict) and did not repair it",
          conflicts.length > 0 && conflicts.every((note) => !note.repaired),
          conflicts.length ? conflicts.map((note) => `${note.section}: ${quote(note.instruction, 90)}`).join("; ") : "no conflict row",
        ),
      );
      const section = c.report?.sections[sectionOf(params.exclusionRole)] ?? "";
      const overlap = edit?.exclusionText ? contentWordOverlap(edit.exclusionText, section) : 0;
      checks.push(
        check(
          "exclusion-drafted",
          "Heuristic: the conflicting selection was drafted, not removed",
          overlap >= 0.6,
          `${Math.round(overlap * 100)} percent of the exclusion's content words appear in Section ${sectionOf(params.exclusionRole).slice(1)}`,
        ),
      );
      const asserted = items.find((candidate) => candidate.seedId === log.edits.writerAsserted?.seedId);
      checks.push(
        check(
          "writer-asserted-in-plan",
          "The writer-asserted item is in the plan as writer-asserted",
          asserted?.support === "writer_asserted" && has(asserted.bullets.join(" "), params.writerAssertedTerm),
          asserted ? `${quote(asserted.bullets.join(" "))} (${asserted.support})` : "missing",
        ),
      );
      checks.push(writerAssertedCoverage(c, asserted?.itemId ?? null));
      const assertedSection = c.report?.sections[sectionOf(params.writerAssertedRole)] ?? "";
      checks.push(
        info(
          "writer-asserted-drafted",
          `Where "${params.writerAssertedTerm}" appears in the drafted Section`,
          excerptAround(assertedSection, params.writerAssertedTerm) ?? "absent (judge whether the note was honoured)",
        ),
      );
      break;
    }
    case "changed_advancement_links": {
      const refusal = log.refusals.find((candidate) => candidate.key === "unlinked");
      checks.push(
        check(
          "unlinked-refused",
          "After the uncertainty changed, approving the old advancements was refused as unlinked",
          refusal?.reason === "UNLINKED_ADVANCEMENT",
          refusal ? `${refusal.code ?? "no code"} / ${refusal.reason ?? "no reason"}` : "no approval attempt recorded",
        ),
      );
      const uncertaintySeeds = new Set(items.filter((item) => item.roleId === "active_uncertainties").map((item) => item.seedId));
      const experimentSeeds = new Set(items.filter((item) => item.roleId === "experimentation").map((item) => item.seedId));
      const advancements = items.filter((item) => item.roleId === "specific_advancements");
      const badLinks = advancements.filter(
        (item) =>
          !item.uncertaintySeedId ||
          !uncertaintySeeds.has(item.uncertaintySeedId) ||
          item.experimentSeedIds.length === 0 ||
          !item.experimentSeedIds.every((id) => experimentSeeds.has(id)),
      );
      checks.push(
        check(
          "links-valid",
          "Every signed-off advancement links to exactly one active uncertainty and at least one active experiment",
          advancements.length > 0 && badLinks.length === 0,
          `${advancements.length} advancement(s); ${badLinks.length} with a link outside the plan`,
        ),
      );
      const removed = log.removedUncertaintySeedId;
      checks.push(
        check(
          "removed-uncertainty-gone",
          "The dropped uncertainty is out of the plan and no advancement links to it",
          !!removed && !uncertaintySeeds.has(removed) && !advancements.some((item) => item.uncertaintySeedId === removed),
          removed ? `dropped ${removed}` : "no uncertainty was dropped",
        ),
      );
      // 2026-09-29 (first): the plan itself shows each advancement's
      // uncertainty is one the plan still holds and that every experiment
      // it links tested that uncertainty; an experiment recording no
      // uncertainty cannot show it, so it fails here.
      const testedBy = new Map(items.filter((item) => item.roleId === "experimentation").map((item) => [item.seedId, item.uncertaintySeedId]));
      const notFollowing = advancements.flatMap((item) => {
        if (!item.uncertaintySeedId || !uncertaintySeeds.has(item.uncertaintySeedId)) return [`${quote(item.bullets.join(" "), 60)} names an uncertainty the plan does not hold`];
        const other = item.experimentSeedIds.filter((id) => testedBy.get(id) !== item.uncertaintySeedId);
        return other.length ? [`${quote(item.bullets.join(" "), 60)} links ${other.length} experiment(s) that did not record testing its uncertainty`] : [];
      });
      checks.push(
        check(
          "advancements-follow-experiments",
          "Every signed-off advancement's uncertainty is one the plan still holds, and every experiment it links tested that uncertainty",
          advancements.length > 0 && notFollowing.length === 0,
          notFollowing.length ? notFollowing.join("; ") : `${advancements.length} advancement(s), each following the uncertainty its experiments tested`,
        ),
      );
      const experimentItems = items.filter((item) => item.roleId === "experimentation");
      const strayExperiments = experimentItems.filter((item) => !item.uncertaintySeedId || !uncertaintySeeds.has(item.uncertaintySeedId));
      checks.push(
        check(
          "experiments-hold-uncertainties",
          "Every signed-off experiment tested an uncertainty the plan still holds",
          experimentItems.length > 0 && strayExperiments.length === 0,
          `${experimentItems.length} experiment(s); ${strayExperiments.length} with no recorded uncertainty or one the plan dropped${strayExperiments.length ? `: ${strayExperiments.map((item) => quote(item.bullets.join(" "), 60)).join(", ")}` : ""}`,
        ),
      );
      const notices = log.linkNotices ?? {};
      checks.push(
        check(
          "dropped-experiments-named",
          "Before approval, Experimentation / Iterations named the experiments that tested the dropped uncertainty",
          notices.experimentation === "experiments_for_dropped_uncertainty",
          `notice: ${notices.experimentation ?? "none read"}`,
        ),
      );
      checks.push(
        check(
          "unlinked-advancements-named",
          "Before approval, Specific technological advancements said its advancements could not be linked",
          notices.specific_advancements === "unlinked_advancements" || notices.specific_advancements === "no_linkable_experiment",
          `notice: ${notices.specific_advancements ?? "none read"}`,
        ),
      );
      const droppedRefusal = log.refusals.find((candidate) => candidate.key === "droppedExperiments");
      checks.push(
        check(
          "dropped-experiments-refused",
          "After the uncertainty was dropped, approving the experiments that tested it was refused",
          droppedRefusal?.reason === "EXPERIMENT_FOR_DROPPED_UNCERTAINTY",
          droppedRefusal ? `${droppedRefusal.code ?? "no code"} / ${droppedRefusal.reason ?? "no reason"}` : "no approval attempt recorded",
        ),
      );
      checks.push(...resultLinkChecks(c, log, uncertaintySeeds));
      checks.push(...planLinkChecks(c, log, uncertaintySeeds));
      // A hint for the judge, not a verdict: the drafted text cannot be
      // tied to an uncertainty mechanically, so show the Line 246 paragraph
      // that shares the most words with the dropped uncertainty, then
      // (2026-09-30, first) every paragraph of every Line that shares its
      // words or holds a distinctive figure of it or its experiments (run
      // 10's hint named Line 246 P2 and missed P3 and Line 244 P4).
      const droppedWords = c.seeds.find((seed) => seed.seedId === removed)?.bullets.join(" ") ?? "";
      const paragraphs = (c.report?.sections.s246 ?? "").split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean);
      const closest = paragraphs
        .map((text, index) => ({ index, text, overlap: contentWordOverlap(droppedWords, text) }))
        .sort((a, b) => b.overlap - a.overlap)[0];
      // Review P3-2: the product's input rule. The frozen row gives the
      // dropped wording and the experiments and advancements that recorded
      // it; results read back before it existed fall back to the Seeds.
      const frozenDropped = c.summary?.droppedUncertainties?.find((entry) => entry.seedId === removed);
      const skippedRoles = new Set(c.summary?.skippedRoleIds ?? []);
      const scan = c.report && droppedWords
        ? droppedUncertaintyHits({
            sections: c.report.sections,
            droppedWording: frozenDropped?.wording ?? c.seeds.find((seed) => seed.seedId === removed)?.bullets ?? [],
            references: frozenDropped
              ? [...frozenDropped.experiments, ...frozenDropped.advancements]
              : c.seeds
                  .filter((seed) =>
                    (seed.roleId === "experimentation" || seed.roleId === "specific_advancements") &&
                    seed.uncertaintySeedId === removed)
                  .map((seed) => ({ wording: seed.bullets })),
            planWording: items.filter((item) => !skippedRoles.has(item.roleId)).map((item) => item.bullets),
          })
        : null;
      const scanText = scan
        ? `; distinctive figures: ${scan.figures.join(", ") || "none"}; ${
            scan.hits.length
              ? `paragraphs with a hit: ${scan.hits
                  .map((hit) => `Line ${hit.section} P${hit.paragraph} (${Math.round(hit.overlap * 100)} percent of its words${hit.figures.length ? `; ${hit.figures.join(", ")}` : ""}): ${quote(hit.text, 120)}`)
                  .join("; ")}`
              : "no paragraph of any Line has a hit"
          }`
        : "";
      checks.push(
        info(
          "dropped-uncertainty-drafted",
          "Where the dropped uncertainty's words and its experiments' figures appear, in every Line (a hint for the judge)",
          !droppedWords
            ? "the dropped uncertainty's wording was not read back"
            : closest
              ? `paragraph ${closest.index + 1} shares ${Math.round(closest.overlap * 100)} percent of its content words: ${quote(closest.text, 200)}${scanText}`
              : "Line 246 was not drafted",
        ),
      );
      // 2026-09-30 (first): the Compliance Note records, per Line, whether
      // the dropped uncertainty was left out, and whether every Line 246
      // advancement answers a Line 242 uncertainty.
      const leftOutRows = (["242", "244", "246"] as const).map((section) => ({
        section,
        row: c.complianceNotes.find((note) => note.section === section && !!removed && note.planRef?.droppedSeedId === removed),
      }));
      // Review P3-1: a row the product's figure check recorded applied
      // passes only when the suite's own whole-Line scan finds no
      // distinctive figure of the dropped uncertainty in that Line.
      const scanFigureHits = (section: "242" | "244" | "246") =>
        (scan?.hits ?? []).filter((hit) => hit.section === section && hit.figures.length > 0);
      const byBackstop = (row: (typeof leftOutRows)[number]["row"]) =>
        row?.outcome === "applied" && row.reason.startsWith(LEAVE_OUT_FIGURE_BACKSTOP_PREFIX);
      const rowPasses = ({ section, row }: (typeof leftOutRows)[number]) =>
        row?.outcome === "applied" && (!byBackstop(row) || (scan !== null && scanFigureHits(section).length === 0));
      checks.push(
        check(
          "dropped-uncertainty-left-out",
          "Every Line records the dropped uncertainty as left out",
          !!removed && leftOutRows.every(rowPasses),
          !removed
            ? "no uncertainty was dropped"
            : `${leftOutRows
                .map(({ section, row }) => `${section}: ${row
                  ? row.outcome === "applied"
                    ? byBackstop(row)
                      ? scan === null
                        ? `applied by the figure check, not confirmed: the suite could not scan the Lines (${quote(row.reason, 160)})`
                        : scanFigureHits(section).length > 0
                          ? `applied by the figure check, but the suite's scan finds ${scanFigureHits(section)
                              .map((hit) => `${hit.figures.join(", ")} in P${hit.paragraph}`)
                              .join("; ")} (${quote(row.reason, 160)})`
                          : `applied by the figure check (${quote(row.reason, 160)})`
                      : "applied"
                    : row.reason.includes(LEAVE_OUT_FIGURE_NOTE_PREFIX)
                      // Greptile round: the product's figure note never
                      // changes a verdict; it is shown whole as a lead for
                      // the judge, and the row still fails.
                      ? `${row.outcome} (${quote(row.reason.slice(0, row.reason.indexOf(LEAVE_OUT_FIGURE_NOTE_PREFIX)).trim(), 100)}) ${row.reason.slice(row.reason.indexOf(LEAVE_OUT_FIGURE_NOTE_PREFIX))}`
                      : `${row.outcome} (${quote(row.reason, 100)})`
                  : "no row"}`)
                .join("; ")}${c.summary?.droppedUncertaintySeedIds ? `; frozen at sign-off: ${c.summary.droppedUncertaintySeedIds.join(", ") || "none"}` : ""}`,
        ),
      );
      const answersRow = c.complianceNotes.find((note) => note.section === "246" && note.planRef?.ruleId === "advancements_answer_242");
      checks.push(
        check(
          "advancements-answer-242",
          "Line 246 records every advancement as answering a Line 242 uncertainty",
          answersRow?.outcome === "applied",
          answersRow ? `${answersRow.outcome}: ${quote(answersRow.reason, 120)}` : "no Line 246 row for this check",
        ),
      );
      const byUncertainty = new Map<string, string[]>();
      for (const item of advancements) {
        if (item.uncertaintySeedId) byUncertainty.set(item.uncertaintySeedId, [...(byUncertainty.get(item.uncertaintySeedId) ?? []), item.itemId]);
      }
      const shared = [...byUncertainty.values()].find((ids) => ids.length >= 2) ?? [];
      const mergeRow = c.complianceNotes.find(
        (note) => note.planRef && shared.length >= 2 && shared.every((id) => note.planRef!.mergedItemIds.includes(id)),
      );
      checks.push(
        check(
          "merge-named",
          "Two advancements sharing an uncertainty are drafted as one and the Compliance Note names the merge",
          shared.length >= 2 && !!mergeRow,
          shared.length >= 2 ? (mergeRow ? `merged ${mergeRow.planRef!.mergedItemIds.length} items in Section ${mergeRow.section}` : "no Compliance Note row names the merge") : "no two signed-off advancements share an uncertainty",
        ),
      );
      break;
    }
    case "writer_settings_document": {
      checks.push(...settingsChecks(fixture, c));
      break;
    }
  }
  return checks;
}

/**
 * 2026-09-30 (fourth): Advancement to science and goal improvements record
 * the uncertainties they answer. Where a pick answered the dropped
 * uncertainty, the step named it and approval was refused (not applicable,
 * and shown as information, when no pick did); and every signed-off item
 * answers only uncertainties the plan holds, Advancement to science at least
 * one (a goal improvements item may restate the goal and answer none).
 */
function resultLinkChecks(c: Collected, log: RunLog, planUncertainties: ReadonlySet<string>): Check[] {
  const checks: Check[] = [];
  const recorded = log.droppedResultPicks;
  const needed = RESULT_ROLE_IDS.filter((role) => (recorded?.[role] ?? 0) > 0);
  const title = (role: string) => roleDef(role)?.title ?? role;
  const notApplicable = recorded
    ? "not applicable: no picked Advancement to science or goal improvements idea answered the dropped uncertainty"
    : "not recorded (a run from before the 2026-09-30 fourth amendment)";
  if (needed.length === 0) {
    checks.push(info("dropped-results-named", "Before approval, each step whose pick answered the dropped uncertainty said so", notApplicable));
    checks.push(info("dropped-results-refused", "After the uncertainty was dropped, approving a result that answered it was refused", notApplicable));
  } else {
    const notices = log.linkNotices ?? {};
    checks.push(
      check(
        "dropped-results-named",
        "Before approval, each step whose pick answered the dropped uncertainty said so",
        needed.every((role) => notices[role] === "results_for_dropped_uncertainty"),
        needed.map((role) => `${title(role)}: notice ${notices[role] ?? "none read"}`).join("; "),
      ),
    );
    const refusals = needed.map((role) => ({ role, refusal: log.refusals.find((candidate) => candidate.key === `droppedResults:${role}`) }));
    checks.push(
      check(
        "dropped-results-refused",
        "After the uncertainty was dropped, approving a result that answered it was refused",
        refusals.every(({ refusal }) => refusal?.reason === "RESULT_FOR_DROPPED_UNCERTAINTY"),
        refusals
          .map(({ role, refusal }) => `${title(role)}: ${refusal ? `${refusal.code ?? "no code"} / ${refusal.reason ?? "no reason"}` : "no approval attempt recorded"}`)
          .join("; "),
      ),
    );
  }
  const acknowledged = log.droppedResultAcknowledgements;
  checks.push(
    info(
      "dropped-results-acknowledged",
      "Picks whose words stated a dropped result, which approval asked the writer to acknowledge (the scripted writer replaced them)",
      acknowledged
        ? RESULT_ROLE_IDS.map((role) => `${title(role)}: ${acknowledged[role] ?? 0}`).join("; ")
        : "not recorded (a run from before the review re-check)",
    ),
  );
  const items = (c.summary?.items ?? []).filter((item) => isResultRole(item.roleId));
  const problems = items.flatMap((item) => {
    const answered = item.answeredUncertaintySeedIds ?? [];
    if (item.roleId === "overall_advancement" && answered.length === 0) {
      return [`${quote(item.bullets.join(" "), 60)} records no uncertainty it answers`];
    }
    const outside = answered.filter((seedId) => !planUncertainties.has(seedId));
    return outside.length ? [`${quote(item.bullets.join(" "), 60)} answers ${outside.length} uncertainty the plan does not hold`] : [];
  });
  const restatements = items.filter((item) => item.roleId === "goal_improvements" && (item.answeredUncertaintySeedIds ?? []).length === 0).length;
  checks.push(droppedFiguresCheck(c, log));
  checks.push(
    check(
      "results-answer-kept-uncertainties",
      "Every signed-off Advancement to science and goal improvements item answers an uncertainty the plan still holds",
      items.some((item) => item.roleId === "overall_advancement") && problems.length === 0,
      problems.length
        ? problems.join("; ")
        : `${items.length} item(s), each answering only uncertainties the plan holds${restatements ? `; ${restatements} goal improvements item(s) restate the goal and answer none` : ""}`,
    ),
  );
  return checks;
}

/**
 * 2026-09-30 (fourth, review P2-1): a link can be wrong, so the words are
 * read too. Fails when a signed-off Advancement to science or goal
 * improvements item states a figure of a dropped uncertainty's results, read
 * by the product's rule (droppedUncertaintyFigures in shared/planFigures.ts,
 * as loadDroppedResultFigures reads it): the figures of the run's Seeds that
 * recorded it and that the writer ticked at some point (final check P3-1;
 * for results read back before that was exported, its frozen related Seeds),
 * not of its own wording, that no signed-off item of an earlier step states.
 * The two result steps never vouch for each other.
 */
export function droppedFiguresCheck(c: Collected, log: RunLog): Check {
  const label = "No signed-off Advancement to science or goal improvements item states a figure only the dropped uncertainty's work gave";
  const items = c.summary?.items ?? [];
  const frozen = c.summary?.droppedUncertainties;
  const removed = log.removedUncertaintySeedId;
  const droppedIds = frozen?.length ? frozen.map((entry) => entry.seedId) : removed ? [removed] : [];
  if (droppedIds.length === 0) return info("results-state-no-dropped-figures", label, "no uncertainty was dropped");
  const tickedKnown = c.seeds.length > 0 && c.seeds.every((seed) => seed.everTicked !== undefined);
  const dropped = droppedIds.map((seedId) => ({
    seedId,
    references: tickedKnown || !frozen?.length
      ? c.seeds
          .filter((seed) => seed.uncertaintySeedId === seedId || (seed.answeredUncertaintySeedIds ?? []).includes(seedId))
          .filter((seed) => !tickedKnown || seed.everTicked === true)
          .map((seed) => ({ wording: seed.bullets }))
      : (() => {
          const entry = frozen.find((candidate) => candidate.seedId === seedId)!;
          return [...entry.experiments, ...entry.advancements];
        })(),
  }));
  const orderOf = (roleId: string) => roleDef(roleId)?.order ?? 0;
  const hits = items
    .filter((item) => isResultRole(item.roleId))
    .flatMap((item) => {
      // Only earlier steps vouch, as in the product (final check P2).
      const planWording = items
        .filter((other) => !isResultRole(other.roleId) && orderOf(other.roleId) < orderOf(item.roleId))
        .map((other) => other.bullets);
      const own = new Set(dropped.flatMap((entry) => droppedUncertaintyFigures({ wording: [], references: entry.references, planWording })));
      const figures = figuresOf(item.bullets.join(" ")).filter((figure) => own.has(figure));
      return figures.length ? [`${quote(item.bullets.join(" "), 60)} states ${figures.join(", ")}`] : [];
    });
  const source = tickedKnown ? "the run's Seeds the writer ticked" : frozen?.length ? "the frozen Summary" : "the run's Seeds";
  return check(
    "results-state-no-dropped-figures",
    label,
    hits.length === 0,
    hits.length ? hits.join("; ") : `${dropped.length} dropped uncertainty(ies) read from ${source}; no item states one of their results' figures`,
  );
}

/**
 * 2026-09-30 (fifth): Hypothesis and Work plan record the uncertainties they
 * test or plan work for. Where a pick recorded the dropped uncertainty,
 * approving it was refused (information when no pick did, or for results
 * from before); and every signed-off Hypothesis and Work plan item records
 * at least one uncertainty, each one the plan still holds (run 12's
 * Hypothesis item 8 recorded none and tested the dropped one).
 */
function planLinkChecks(c: Collected, log: RunLog, planUncertainties: ReadonlySet<string>): Check[] {
  const checks: Check[] = [];
  const recorded = log.droppedResultPicks;
  const needed = PLAN_ROLE_IDS.filter((role) => (recorded?.[role] ?? 0) > 0);
  const title = (role: string) => roleDef(role)?.title ?? role;
  const label = "After the uncertainty was dropped, approving a Hypothesis or Work plan pick that tested it was refused";
  if (needed.length === 0) {
    checks.push(
      info(
        "dropped-plans-refused",
        label,
        recorded && PLAN_ROLE_IDS.some((role) => role in recorded)
          ? "not applicable: no picked Hypothesis or Work plan idea recorded the dropped uncertainty"
          : "not recorded (a run from before the 2026-09-30 fifth amendment)",
      ),
    );
  } else {
    const refusals = needed.map((role) => ({ role, refusal: log.refusals.find((candidate) => candidate.key === `droppedResults:${role}`) }));
    checks.push(
      check(
        "dropped-plans-refused",
        label,
        refusals.every(({ refusal }) => refusal?.reason === "PLAN_FOR_DROPPED_UNCERTAINTY"),
        refusals
          .map(({ role, refusal }) => `${title(role)}: ${refusal ? `${refusal.code ?? "no code"} / ${refusal.reason ?? "no reason"}` : "no approval attempt recorded"}`)
          .join("; "),
      ),
    );
  }
  const items = (c.summary?.items ?? []).filter((item) => isPlanRole(item.roleId));
  const problems = items.flatMap((item) => {
    const answered = item.answeredUncertaintySeedIds ?? [];
    if (answered.length === 0) return [`${quote(item.bullets.join(" "), 60)} records no uncertainty`];
    const outside = answered.filter((seedId) => !planUncertainties.has(seedId));
    return outside.length ? [`${quote(item.bullets.join(" "), 60)} records ${outside.length} uncertainty the plan does not hold`] : [];
  });
  checks.push(
    check(
      "plans-hold-kept-uncertainties",
      "Every signed-off Hypothesis and Work plan item records only uncertainties the plan still holds",
      problems.length === 0,
      problems.length ? problems.join("; ") : `${items.length} item(s), each recording only uncertainties the plan holds`,
    ),
  );
  return checks;
}

// ─── The writer's settings document (2026-10-02, alert 7) ──────────────────

export const SETTINGS_LINES: readonly SettingsLine[] = ["242", "244", "246"];
const lineKey = (line: SettingsLine) => `s${line}` as const;

/**
 * Review P2-1: the one matcher for the settings rules' terms, synonyms,
 * banned phrases and exclusion markers. Whole words in any case; a space,
 * a run of whitespace or a hyphen between words; the last word singular or
 * with s or es. So "DFTs", "substrate temperatures", "edge-wrap" and
 * "dry-film thickness" count, and "outgassing defect rate" uses
 * "outgassing defects". A word ending in ss, us or is keeps its s.
 */
export function settingsTermPattern(phrase: string): RegExp {
  const words = phrase.trim().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return /(?!)/g;
  const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const last = words[words.length - 1]!;
  const stem = last.length > 3 && /[^sui]s$/i.test(last) ? last.slice(0, -1) : last;
  return new RegExp(`\\b${[...words.slice(0, -1).map(escape), `${escape(stem)}(?:s|es)?`].join("[\\s-]+")}\\b`, "gi");
}

/** Every surface form a banned entry matches: the phrase and its listed forms. */
export function bannedForms(entry: { phrase: string; forms?: string[] }): string[] {
  return [entry.phrase, ...(entry.forms ?? [])].map((form) => (form ?? "").trim()).filter(Boolean);
}

/** One place a phrase appears: the phrase, its paragraph (from 1) and a short excerpt. */
export type SettingsHit = { phrase: string; paragraph: number; excerpt: string };

const paragraphsOf = (text: string) => text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);

/** A sentence end: . ! or ?, any closing quotes or brackets (curly ones too), then whitespace. */
const SENTENCE_END = /[.!?]["'’”)\]]*\s+/g;

/** The sentence of a paragraph that holds the span starting at `at`. */
function sentenceAround(paragraph: string, at: number, length: number): string {
  let start = 0;
  for (const match of paragraph.slice(0, at).matchAll(SENTENCE_END)) start = (match.index ?? 0) + match[0].length;
  const after = paragraph.slice(at + length);
  const end = [...after.matchAll(SENTENCE_END)][0];
  return paragraph.slice(start, end ? at + length + (end.index ?? 0) + 1 : paragraph.length);
}

type HitPattern = {
  label?: string;
  pattern: RegExp;
  /** Review P2-2: false skips a match, given the sentence it sits in. */
  counts?: (sentence: string) => boolean;
};

/** Every match of the patterns, per paragraph; a pattern with no label reports the words it matched. */
function hitsOf(text: string, patterns: readonly HitPattern[]): SettingsHit[] {
  const hits: SettingsHit[] = [];
  paragraphsOf(text).forEach((paragraph, index) => {
    for (const { label, pattern, counts } of patterns) {
      for (const match of paragraph.matchAll(pattern)) {
        const at = match.index ?? 0;
        if (counts && !counts(sentenceAround(paragraph, at, match[0].length))) continue;
        hits.push({
          phrase: label ?? match[0].toLowerCase(),
          paragraph: index + 1,
          excerpt: quote(paragraph.slice(Math.max(0, at - 50), at + match[0].length + 50), 130),
        });
      }
    }
  });
  return hits;
}

/**
 * Hits of each phrase (the settings matcher). With `unlessWith`, a match in
 * a sentence that also holds that term does not count (review P2-2: the
 * settings document allows "pinholes" beside "outgassing defects").
 */
export function phraseHits(text: string, phrases: readonly string[], options: { unlessWith?: string } = {}): SettingsHit[] {
  const unlessWith = options.unlessWith?.trim();
  return hitsOf(
    text,
    phrases
      .filter((phrase) => phrase.trim())
      .map((phrase) => ({
        label: phrase,
        pattern: settingsTermPattern(phrase),
        ...(unlessWith ? { counts: (sentence: string) => !found(sentence, unlessWith) } : {}),
      })),
  );
}

/**
 * First person: "we", "our", "ours" and "ourselves" in any case, "us" in
 * lower case only, so "US" is not one.
 */
export function firstPersonHits(text: string): SettingsHit[] {
  return hitsOf(text, [{ pattern: /\b(?:we|ours?|ourselves)\b/gi }, { pattern: /\bus\b/g }]);
}

/** Hits grouped by phrase: where each appears, with its first excerpt. */
function describeHits(hits: readonly SettingsHit[]): string {
  const groups = new Map<string, SettingsHit[]>();
  for (const hit of hits) groups.set(hit.phrase, [...(groups.get(hit.phrase) ?? []), hit]);
  return [...groups.entries()]
    .map(([phrase, group]) => `"${phrase}" in ${[...new Set(group.map((hit) => `P${hit.paragraph}`))].join(" and ")} (${group[0]!.excerpt})`)
    .join(", ");
}

/**
 * Where the opening words start a sentence of the text: the paragraph (from
 * 1) and whether they open it. Null when no sentence starts with them. A
 * sentence starts a paragraph, follows a line break, follows . ! or ? (and
 * any closing quotes or brackets, curly ones too) and whitespace, or
 * follows a closing bracket and whitespace, as after a [GAP: ...] marker
 * (review P3-1). The words themselves are matched exactly, any case.
 */
export function openingAt(text: string, opening: string): { paragraph: number; opensParagraph: boolean } | null {
  if (!opening.trim()) return null;
  const pattern = new RegExp(
    `(?:^|\\n\\s*|[.!?]["'\\u2019\\u201d)\\]]*\\s+|\\]\\s+)${bannedTermPattern(opening.trim()).source}`,
    "i",
  );
  const paragraphs = paragraphsOf(text);
  for (let index = 0; index < paragraphs.length; index += 1) {
    const match = pattern.exec(paragraphs[index]!);
    if (match) return { paragraph: index + 1, opensParagraph: match.index === 0 };
  }
  return null;
}

export type SettingsRuleKind = "term" | "banned" | "opening" | "cap" | "exclusion" | "style";

export type SettingsRuleResult = {
  id: string;
  kind: SettingsRuleKind;
  /** Each Line the rule applies to: kept or broken, with the evidence. */
  lines: Partial<Record<SettingsLine, { broken: boolean; evidence: string }>>;
  /** Report-wide: broken in a Line, or (a required term) never used. */
  broken: boolean;
  /** A report-wide break no single Line shows ("never used in any Line"). */
  note: string | null;
  /** Why the rule is not counted in this run (review P3-6), or null. */
  notApplicable: string | null;
};

export type SettingsRuleOptions = {
  /** Lines whose House Rule openers the org enforces, so a settings opening there cannot apply. */
  orgEnforcedOpenerLines?: readonly SettingsLine[];
};

/** Review P3-6: why an opening is not counted when the org enforces the House Rule openers. */
export const OPENERS_ENFORCED_NOTE = "not applicable: the org enforces the House Rule opening clauses";

/**
 * Every explicit rule of the settings document, judged on the drafted
 * Lines. Deterministic: the settings matcher, sentence starts and the
 * product's own word count. A required term breaks in a Line that uses one
 * of its synonyms (with `allowedWithTerm`, not in a sentence that also uses
 * the term), and report-wide also when no Line uses it; an opening and a
 * word cap apply to their own Line only; the exclusions are a heuristic
 * (any marker counts as a mention).
 */
export function settingsRuleResults(
  params: SettingsParams,
  sections: { s242: string; s244: string; s246: string },
  options: SettingsRuleOptions = {},
): SettingsRuleResult[] {
  const results: SettingsRuleResult[] = [];
  const add = (id: string, kind: SettingsRuleKind, lines: SettingsRuleResult["lines"], note: string | null = null) => {
    results.push({ id, kind, lines, broken: Object.values(lines).some((line) => line?.broken) || note !== null, note, notApplicable: null });
  };
  const everyLine = (judge: (text: string) => { broken: boolean; evidence: string }) =>
    Object.fromEntries(SETTINGS_LINES.map((line) => [line, judge(sections[lineKey(line)])])) as SettingsRuleResult["lines"];

  for (const { term, synonyms, allowedWithTerm } of params.requiredTerms) {
    let used = false;
    const lines = everyLine((text) => {
      const hits = phraseHits(text, synonyms, allowedWithTerm ? { unlessWith: term } : {});
      const uses = found(text, term);
      used ||= uses;
      return hits.length ? { broken: true, evidence: describeHits(hits) } : { broken: false, evidence: uses ? "term used" : "not mentioned" };
    });
    add(`term "${term}"`, "term", lines, used ? null : "never used in any Line");
  }
  for (const entry of params.bannedPhrases) {
    add(`banned "${entry.phrase}"`, "banned", everyLine((text) => {
      const hits = phraseHits(text, bannedForms(entry));
      return { broken: hits.length > 0, evidence: hits.length ? describeHits(hits) : "absent" };
    }));
  }
  for (const entry of params.requiredOpenings) {
    const id = `opening "${entry.opening}" (${entry.statement})`;
    if (options.orgEnforcedOpenerLines?.includes(entry.section)) {
      results.push({ id, kind: "opening", lines: {}, broken: false, note: null, notApplicable: OPENERS_ENFORCED_NOTE });
      continue;
    }
    const at = openingAt(sections[lineKey(entry.section)], entry.opening);
    add(id, "opening", {
      [entry.section]: at
        ? { broken: false, evidence: at.opensParagraph ? `opens P${at.paragraph}` : `opens a sentence in P${at.paragraph}` }
        : { broken: true, evidence: "no sentence opens with these words" },
    });
  }
  for (const line of SETTINGS_LINES) {
    const cap = params.wordCaps[line];
    const words = sectionMetrics(sections[lineKey(line)], lineKey(line)).words;
    add(`word cap Line ${line}`, "cap", { [line]: { broken: words > cap, evidence: `${words} of ${cap} words` } });
  }
  for (const entry of params.exclusions) {
    add(`exclusion "${entry.name}"`, "exclusion", everyLine((text) => {
      const hits = phraseHits(text, entry.markers);
      return { broken: hits.length > 0, evidence: hits.length ? describeHits(hits) : "not mentioned" };
    }));
  }
  add("style: no first person", "style", everyLine((text) => {
    const hits = firstPersonHits(text);
    return { broken: hits.length > 0, evidence: hits.length ? describeHits(hits) : "none" };
  }));
  return results;
}

/** The House Rule rows of one category, by Line, as the Compliance Note recorded them. */
const houseRuleRows = (c: Collected, label: string) =>
  c.complianceNotes.filter((note) => note.instruction === `House Rule category: ${label}`);

/**
 * Review P3-6: the Lines where the org enforces the House Rule openers
 * (tier org_enforced and applied; an org mode of off is org_enforced too,
 * but not applied, and leaves the writer's openings free).
 */
export function orgEnforcedOpenerLines(c: Collected): SettingsLine[] {
  return SETTINGS_LINES.filter((line) =>
    houseRuleRows(c, "opening clauses").some((note) => note.section === line && note.tier === "org_enforced" && note.outcome === "applied"));
}

/** The settings rules judged on a run's report, or null without one. */
export function settingsResultsFor(params: SettingsParams, c: Collected): SettingsRuleResult[] | null {
  return c.report ? settingsRuleResults(params, c.report.sections, { orgEnforcedOpenerLines: orgEnforcedOpenerLines(c) }) : null;
}

export type SettingsBrokenCount = {
  line: SettingsLine | "overall";
  broken: number;
  total: number;
  /** How many of the broken rules are the exclusion heuristic (review P3-2). */
  heuristic: number;
  ids: string[];
};

/**
 * Per Line, the rules that apply there and how many broke; then the report
 * as a whole. A rule that is not applicable in this run is not counted.
 */
export function settingsBrokenCounts(results: readonly SettingsRuleResult[]): SettingsBrokenCount[] {
  const counted = results.filter((result) => result.notApplicable === null);
  const row = (line: SettingsBrokenCount["line"], total: number, broken: readonly SettingsRuleResult[]): SettingsBrokenCount => ({
    line,
    broken: broken.length,
    total,
    heuristic: broken.filter((result) => result.kind === "exclusion").length,
    ids: broken.map((result) => result.id),
  });
  return [
    ...SETTINGS_LINES.map((line) => {
      const applicable = counted.filter((result) => result.lines[line]);
      return row(line, applicable.length, applicable.filter((result) => result.lines[line]!.broken));
    }),
    row("overall", counted.length, counted.filter((result) => result.broken)),
  ];
}

/**
 * "Line 242: 3 of 18 (1 from the heuristic; ...); ...; overall: 4 of 20
 * (...)", with or without the rule names.
 */
export function settingsBrokenText(results: readonly SettingsRuleResult[], options: { ids?: boolean } = {}): string {
  const ids = options.ids ?? true;
  return settingsBrokenCounts(results)
    .map((row) => {
      const extra = [row.heuristic ? `${row.heuristic} from the heuristic` : null, ids && row.ids.length ? row.ids.join(", ") : null].filter(Boolean);
      return `${row.line === "overall" ? "overall" : `Line ${row.line}`}: ${row.broken} of ${row.total}${extra.length ? ` (${extra.join("; ")})` : ""}`;
    })
    .join("; ");
}

/** One kind of rule across the Lines: whether every rule held, and what broke where. */
function settingsKindEvidence(results: readonly SettingsRuleResult[], kind: SettingsRuleKind, showKept: boolean): { ok: boolean; evidence: string } {
  const rows = results.filter((result) => result.kind === kind);
  const parts = SETTINGS_LINES.flatMap((line) => {
    const applicable = rows.filter((result) => result.lines[line]);
    if (!applicable.length) return [];
    const shown = showKept ? applicable : applicable.filter((result) => result.lines[line]!.broken);
    return [`${line}: ${shown.length ? shown.map((result) => `${result.id} ${result.lines[line]!.broken ? "broken" : "kept"}, ${result.lines[line]!.evidence}`).join("; ") : "none broken"}`];
  });
  const notes = rows.filter((result) => result.note).map((result) => `${result.id} ${result.note}`);
  const skipped = rows.filter((result) => result.notApplicable).map((result) => `${result.id} ${result.notApplicable}`);
  return { ok: rows.every((result) => !result.broken), evidence: [...parts, ...notes, ...skipped].join(". ") };
}

const SETTINGS_ROW = /\bsettings document\b|\bwriter profile\b|\bwriter settings\b/i;
/** A House Rule category row that says nothing beyond "no waiver"; counted, not listed. */
const NO_WAIVER_REASON = "House Rule applied (no Writer Profile waiver)";

/**
 * Per Line, the Compliance Note rows that mention the settings document or
 * the Writer Profile, so the judges see what the product believed it
 * applied: the Writer Profile row, its waivers, the row that checks the
 * document's text (its instruction holds the settings title) and the cap
 * rows the product extracted from it. Plain "no waiver" category rows are
 * counted, not listed.
 */
export function settingsComplianceRows(c: Collected, params: SettingsParams): string {
  const title = (params.settingsTitle ?? "").trim();
  const mentions = (note: Collected["complianceNotes"][number]) => {
    const line = note.section as SettingsLine;
    return (
      SETTINGS_ROW.test(note.instruction) ||
      SETTINGS_ROW.test(note.reason) ||
      (title !== "" && has(note.instruction, title)) ||
      (SETTINGS_LINES.includes(line) && bannedTermPattern(`${params.wordCaps[line]} words`).test(note.instruction))
    );
  };
  return SETTINGS_LINES.map((line) => {
    const rows = c.complianceNotes.filter((note) => note.section === line && mentions(note));
    const quiet = rows.filter((note) => note.reason === NO_WAIVER_REASON);
    const parts = rows
      .filter((note) => note.reason !== NO_WAIVER_REASON)
      .map((note) => `${quote(note.instruction, 70)} ${rowState(note)}${note.tier !== "none" ? ` (${note.tier})` : ""}: ${quote(note.reason, 110)}`);
    if (quiet.length) parts.push(`${quiet.length} House Rule ${quiet.length === 1 ? "category" : "categories"} applied with no Writer Profile waiver`);
    return `${line}: ${parts.length ? parts.join(", ") : "no row"}`;
  }).join("; ");
}

/** Review P3-6: one House Rule category's outcome per Line, identical rows grouped. */
function houseRuleOutcome(c: Collected, label: string): string {
  const groups = new Map<string, string[]>();
  for (const note of houseRuleRows(c, label)) {
    const key = `${note.outcome}, ${note.tier} (${quote(note.reason, 90)})`;
    groups.set(key, [...(groups.get(key) ?? []), note.section]);
  }
  return `${label} ${groups.size ? [...groups.entries()].map(([key, lines]) => `${key} in ${lines.join(", ")}`).join(", ") : "no row"}`;
}

/**
 * Whether the product detected the settings document in Writer's Notes and
 * applied it. Its saved Writer Profile counts when the generation recorded
 * it as equal to the document (review P3-7). Results read back before the
 * writer settings were exported are shown as information, from the Writer
 * Profile rows.
 */
function settingsAppliedCheck(fixture: FixtureManifest, params: SettingsParams, c: Collected): Check {
  const id = "settings-document-applied";
  const label = "The settings document in Writer's Notes was detected and applied as the Writer Profile";
  const fileName = fixture.sources.find((source) => source.file === params.settingsFile)?.fileName ?? params.settingsFile;
  const rows = SETTINGS_LINES.map((line) => {
    const row = c.complianceNotes.find((note) => note.section === line && note.instruction === "Writer Profile");
    return `${line} ${row ? `${row.outcome} (${quote(row.reason, 120)})` : "no row"}`;
  }).join(", ");
  const houseRules = `House Rule outcomes: ${houseRuleOutcome(c, "opening clauses")}; ${houseRuleOutcome(c, "repetition caps")}`;
  const settings = c.generation.writerSettings;
  if (settings === undefined) {
    return info(id, label, `writer settings not read back (results from before 2026-10-02); Writer Profile rows: ${rows}; ${houseRules}`);
  }
  if (settings === null) return check(id, label, false, `no writer settings recorded; Writer Profile rows: ${rows}; ${houseRules}`);
  const ok =
    settings.profileState === "applied" &&
    ((settings.source === "writer_notes" && settings.fileName === fileName) || (settings.source === "profile" && settings.matchesProfile));
  return check(
    id,
    label,
    ok,
    `source ${settings.source}${settings.fileName ? ` (${settings.fileName})` : ""}, profile ${settings.profileState}, waiver analysis ${settings.waiverAnalysis}, House Rule categories it addresses: ${
      settings.addressedCategories?.length ? settings.addressedCategories.join(", ") : "none"
    }${settings.truncated ? ", truncated" : ""}${settings.savedProfileSuperseded ? ", the saved Writer Profile was superseded" : ""}${
      settings.matchesProfile ? ", equal to the saved Writer Profile" : ""
    }; Writer Profile rows: ${rows}; ${houseRules}`,
  );
}

const SETTINGS_KIND_CHECKS: ReadonlyArray<{ id: string; label: string; kind: SettingsRuleKind; showKept: boolean }> = [
  { id: "settings-terms", label: "Each required term from the settings document is used, and none of its synonyms appears in any Line", kind: "term", showKept: false },
  { id: "settings-banned", label: "No banned word or phrase from the settings document appears in any Line", kind: "banned", showKept: false },
  { id: "settings-openings", label: "Each required opening from the settings document starts a sentence in its Line", kind: "opening", showKept: true },
  { id: "settings-word-caps", label: "Each Line is within the settings document's word cap (below the CRA cap)", kind: "cap", showKept: true },
  { id: "settings-exclusions", label: "Heuristic: no Line mentions work the settings document excludes from the claim", kind: "exclusion", showKept: false },
  { id: "settings-style", label: "No Line uses the first person, as the settings document's style rule asks", kind: "style", showKept: false },
];

/** 2026-10-02 (alert 7): how well the draft follows the writer's settings document. */
function settingsChecks(fixture: FixtureManifest, c: Collected): Check[] {
  const params = fixture.params as unknown as SettingsParams;
  const checks: Check[] = [settingsAppliedCheck(fixture, params, c)];
  const results = settingsResultsFor(params, c);
  for (const { id, label, kind, showKept } of SETTINGS_KIND_CHECKS) {
    const judged = results ? settingsKindEvidence(results, kind, showKept) : { ok: false, evidence: "no report" };
    checks.push(check(id, label, judged.ok, judged.evidence));
  }
  checks.push(
    info(
      "settings-rules-broken",
      "Settings rules broken, per Line and overall (informational; the pack lists every rule per Line)",
      results ? `settings rules broken: ${settingsBrokenText(results)}` : "no report",
    ),
  );
  checks.push(
    info(
      "settings-compliance-rows",
      "Compliance Note rows that mention the settings document or the Writer Profile, per Line (what the product believed it applied; informational)",
      settingsComplianceRows(c, params),
    ),
  );
  checks.push(settingsRowsHonestCheck(params, c));
  return checks;
}

/**
 * 2026-10-04 (first): the Self-check row for the settings document's text
 * (its instruction holds the settings title) never reads as applied while a
 * cap row the product measured on the same Line (the Locked row, or the
 * settings document's word cap row) is not met. The run of 2026-10-04 wrote
 * "word cap ok" beside "exceeds: 602/520 words"; the judges had to find it.
 */
export function settingsRowsHonestCheck(params: SettingsParams, c: Collected): Check {
  const id = "settings-rows-honest";
  const label =
    "No Self-check row says the settings document was followed while a measured cap of its Line was not met";
  const title = (params.settingsTitle ?? "").trim();
  const lines = SETTINGS_LINES.map((line) => {
    const rows = c.complianceNotes.filter((note) => note.section === line);
    const failedCaps = rows.filter(
      (note) =>
        note.source === "deterministic" &&
        note.outcome !== "applied" &&
        (note.tier === "locked" || bannedTermPattern(`${params.wordCaps[line]} words`).test(note.instruction)),
    );
    const settingsRows = rows.filter((note) => note.source === "model" && has(note.instruction, title));
    const vouching = failedCaps.length > 0 ? settingsRows.filter((note) => note.outcome === "applied") : [];
    const state = failedCaps.length > 0 ? "a measured cap not met" : "measured caps met";
    const said = settingsRows.length === 0
      ? "no settings document row"
      : settingsRows.map((note) => `settings document row ${note.outcome}: ${quote(note.reason, 110)}`).join(", ");
    return { line, broken: vouching.length > 0, evidence: `${line}: ${state}; ${said}` };
  });
  return check(id, label, lines.every((line) => !line.broken), lines.map((line) => line.evidence).join("; "));
}

/** The pack's per-rule table for a settings fixture: every rule, every Line. */
export function renderSettingsRules(results: readonly SettingsRuleResult[]): string[] {
  return [
    "## Settings document rules, per Line",
    "",
    `Every explicit rule of the writer's settings document, checked on the drafted Lines. Settings rules broken: ${settingsBrokenText(results, { ids: false })}. The exclusion rows are a heuristic: a marker in a Line counts as a mention.`,
    "",
    "| Rule | Line 242 | Line 244 | Line 246 |",
    "| --- | --- | --- | --- |",
    ...results.map((result) => {
      const cells = SETTINGS_LINES.map((line) => {
        const judged = result.lines[line];
        return judged ? `${judged.broken ? "broken" : "kept"}: ${judged.evidence}` : "not applicable";
      });
      const marks = [result.note, result.notApplicable].filter(Boolean);
      return `| ${cell(`${result.id}${marks.length ? ` (${marks.join("; ")})` : ""}`)} | ${cells.map(cell).join(" | ")} |`;
    }),
    "",
  ];
}

/** Identical reasons collapse to one entry with a count. */
function groupedReasons(notes: ReadonlyArray<{ section: string; reason: string }>): string {
  const groups = new Map<string, { sections: Set<string>; count: number }>();
  for (const note of notes) {
    const group = groups.get(note.reason) ?? { sections: new Set<string>(), count: 0 };
    group.sections.add(note.section);
    group.count += 1;
    groups.set(note.reason, group);
  }
  return [...groups.entries()]
    .map(([reason, group]) => `${group.count} row(s) in ${[...group.sections].join(", ")}: ${quote(reason, 100)}`)
    .join("; ");
}

function writerAssertedCoverage(c: Collected, itemId: string | null): Check {
  const row = itemId ? c.complianceNotes.find((note) => note.planRef?.itemId === itemId) : undefined;
  return check(
    "writer-asserted-covered",
    "The writer-asserted item has a coverage row (drafted as a Writer's Note)",
    !!row,
    row ? `${row.outcome}: ${quote(row.reason, 120)}` : "no coverage row",
  );
}

export function runChecks(fixture: FixtureManifest, collected: Collected | null, log: RunLog): Check[] {
  if (!collected) {
    return [check("run-completed", "The scripted session finished without an error", false, log.error ?? "no results were read back")];
  }
  return [...commonChecks(fixture, collected, log), ...caseChecks(fixture, collected, log)];
}

// ─── CAP-14 numbers ─────────────────────────────────────────────────────────

export type Distribution = { count: number; medianMs: number | null; p95Ms: number | null };

/** Median (mean of the middle two) and nearest-rank p95. */
export function distribution(values: readonly number[]): Distribution {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, medianMs: null, p95Ms: null };
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
  return { count: sorted.length, medianMs: median, p95Ms: p95 };
}

export type LatencySamples = {
  dispatchToResultMs: number[];
  foregroundToFirstRenderMs: number[];
  signOffToReportMs: number[];
  singleModeRequestToReportMs: number[];
};

/**
 * The same definitions as the learning-health reader
 * (convex/lib/seedLearningHealth.ts): a completed or failed Batch's event
 * time minus its queue time; a first view of a Batch the writer opened
 * (not the server's first Batch) minus its queue time; the first report at
 * or after sign-off minus the sign-off time.
 */
export function latencySamples(c: Collected, log?: RunLog): LatencySamples {
  const batch = (id: string | null) => c.batches.find((candidate) => candidate.batchId === id);
  const samples: LatencySamples = {
    dispatchToResultMs: [],
    foregroundToFirstRenderMs: [],
    signOffToReportMs: [],
    singleModeRequestToReportMs: [],
  };
  const viewed = new Set<string>();
  for (const event of c.events) {
    const row = batch(event.batchId);
    if (!row) continue;
    if (event.kind === "batchCompleted" || event.kind === "batchFailed") samples.dispatchToResultMs.push(event.at - row.queuedAt);
    if (event.kind === "batchViewed" && !viewed.has(row.batchId)) {
      viewed.add(row.batchId);
      if (row.roleOpen && row.startedBy !== "server") samples.foregroundToFirstRenderMs.push(event.at - row.queuedAt);
    }
  }
  const signOff = c.events.find((event) => event.kind === "signOff");
  if (signOff && c.report && c.report.generatedAt >= signOff.at) samples.signOffToReportMs.push(c.report.generatedAt - signOff.at);
  if (log?.singleBaseline) samples.singleModeRequestToReportMs.push(log.singleBaseline.reportGeneratedAt - log.singleBaseline.requestedAt);
  return samples;
}

export function mergeSamples(all: readonly LatencySamples[]): LatencySamples {
  return {
    dispatchToResultMs: all.flatMap((s) => s.dispatchToResultMs),
    foregroundToFirstRenderMs: all.flatMap((s) => s.foregroundToFirstRenderMs),
    signOffToReportMs: all.flatMap((s) => s.signOffToReportMs),
    singleModeRequestToReportMs: all.flatMap((s) => s.singleModeRequestToReportMs),
  };
}

/** CAP-14 placeholders, reported against, never changed here. */
export const LATENCY_PLACEHOLDERS = { medianMs: 12_000, p95Ms: 30_000 };

export function seedRequestCount(c: Collected) {
  const seeds = c.usage.filter((row) => row.callSite.startsWith("generation:seeds:")).length;
  const feedback = c.usage.filter((row) => row.callSite.startsWith("generation:seedFeedback:")).length;
  return { seeds, feedback, metered: seeds + feedback, reserved: c.generation.seedRequestsReserved };
}

export function usageCost(c: Collected) {
  const seedStage = c.usage.filter((row) => /^generation:(seeds|seedFeedback):/.test(row.callSite));
  const sum = (rows: typeof c.usage) => rows.reduce((total, row) => total + (Number.isFinite(row.costUsd) ? row.costUsd : 0), 0);
  const models = [...new Set(c.usage.map((row) => row.model))].sort();
  return { totalUsd: sum(c.usage), seedStageUsd: sum(seedStage), otherUsd: sum(c.usage) - sum(seedStage), rows: c.usage.length, models };
}

// ─── The judging pack ───────────────────────────────────────────────────────

export type FixtureResult = {
  fixture: FixtureManifest;
  log: RunLog;
  collected: Collected | null;
  checks: Check[];
};

export type PackContext = { date: string; deployment: string; commit: string; reviewer: string };

const seconds = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
const usd = (value: number) => `$${value.toFixed(2)}`;
const cell = (text: string) => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

function renderPlan(c: Collected, log: RunLog): string[] {
  const lines: string[] = [];
  const items = c.summary?.items ?? [];
  const carried = new Set(log.approvals.flatMap((approval) => approval.carriedSeedIds));
  const byId = new Map(c.seeds.map((seed) => [seed.seedId, seed]));
  const label = (seedId: string | null) => {
    if (!seedId) return "none";
    const item = items.find((candidate) => candidate.seedId === seedId);
    const seed = byId.get(seedId);
    return quote((item?.bullets ?? seed?.bullets ?? [seedId]).join(" "), 70);
  };
  for (const role of PD_SUBSECTIONS) {
    const state = c.subsections.find((row) => row.roleId === role.roleId)?.state ?? "unknown";
    const skipped = c.summary?.skippedRoleIds.includes(role.roleId);
    lines.push(`### ${role.order}. ${role.title} (Section ${role.section.slice(1)}, ${role.kind}): ${skipped ? "skipped" : state}`, "");
    const roleItems = items.filter((item) => item.roleId === role.roleId).sort((a, b) => a.order - b.order);
    if (skipped) lines.push("- Skipped by the writer. The drafter must not cover this role.");
    for (const item of roleItems) {
      const marks = [
        item.edited ? "edited" : null,
        item.support === "writer_asserted" ? "writer-asserted" : "cited",
        carried.has(item.seedId) ? "carried from an older context" : null,
        item.confirmedExclusion ? "Claim Exclusion confirmed" : null,
        byId.get(item.seedId)?.revisionOfSeedId ? "Revised Seed" : null,
      ].filter(Boolean);
      lines.push(`- ${item.bullets.join(" / ")} _(${marks.join(", ")})_`);
      if (item.roleId === "experimentation" && item.uncertaintySeedId) {
        lines.push(`  - Tested: uncertainty ${label(item.uncertaintySeedId)}`);
      } else if (item.uncertaintySeedId || item.experimentSeedIds.length) {
        lines.push(`  - Links: uncertainty ${label(item.uncertaintySeedId)}; experiments ${item.experimentSeedIds.map(label).join(", ") || "none"}`);
      }
    }
    if (!skipped && !roleItems.length) lines.push("- (no selection in the signed-off plan)");
    lines.push("");
  }
  return lines;
}

export function renderFixturePack(result: FixtureResult, context: PackContext): string {
  const { fixture, log, collected: c, checks } = result;
  const caseInfo = SEMANTIC_CASES[fixture.semanticCase];
  // 2026-10-02: a case CAP-13 does not name carries its own basis.
  const basis = "basis" in caseInfo ? caseInfo.basis : "CAP-13";
  const lines: string[] = [
    `# ${releaseEvalProjectTitle(fixture.title)}`,
    "",
    `Semantic case: **${caseInfo.title}** (${basis}: "${caseInfo.spec}")${caseInfo.also.length ? `. Also checks: ${caseInfo.also.join("; ")}.` : "."}`,
    "",
    `Run ${context.date} on \`${context.deployment}\` at commit \`${context.commit}\`, acting as ${context.reviewer}. Project \`${log.projectId ?? "none"}\`, generation \`${log.generationId ?? "none"}\`.`,
    "",
    "## What this fixture tests",
    "",
    fixture.purpose,
    "",
    ...(fixture.notes?.length ? ["Fixture notes:", "", ...fixture.notes.map((note) => `- ${note}`), ""] : []),
    "## Judgment (reviewing manager)",
    "",
    "Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.",
    "",
    ...fixture.judgmentQuestions.map((question, i) => `${i + 1}. ${question}\n   - Answer: `),
    "",
    "- Verdict (pass or fail): ",
    "- Judged by: ",
    "- Date: ",
    "- Notes: ",
    "",
    "## Automatic checks",
    "",
    `${checks.filter((item) => item.status === "pass").length} passed, ${checks.filter((item) => item.status === "fail").length} failed. A heuristic check is a hint for the judge, not a verdict.`,
    "",
    "| Check | Result | Evidence |",
    "| --- | --- | --- |",
    ...checks.map((item) => `| ${cell(item.label)} | ${item.status} | ${cell(item.evidence)} |`),
    "",
  ];
  if (c?.report && fixture.semanticCase === "writer_settings_document") {
    lines.push(...renderSettingsRules(settingsResultsFor(fixture.params as unknown as SettingsParams, c) ?? []));
  }
  if (c) {
    lines.push("## Signed-off plan", "", ...renderPlan(c, log));
    lines.push("## Drafted Sections", "");
    if (c.report) {
      for (const [key, title] of [
        ["s242", "Line 242"],
        ["s244", "Line 244"],
        ["s246", "Line 246"],
      ] as const) {
        lines.push(`### ${title}`, "", c.report.sections[key].trim() || "(empty)", "");
      }
    } else {
      lines.push("No report was created.", "");
    }
    lines.push("## Compliance Note", "", "| Section | Instruction | Outcome | Tier | Merged items | Reason |", "| --- | --- | --- | --- | --- | --- |");
    for (const note of c.complianceNotes) {
      lines.push(
        `| ${note.section} | ${cell(note.instruction)} | ${note.outcome} | ${note.tier} | ${note.planRef && note.planRef.mergedItemIds.length > 1 ? note.planRef.mergedItemIds.length : ""} | ${cell(note.reason)} |`,
      );
    }
    const notChecked = notCheckedCounts(c);
    lines.push(
      "",
      "## Not checked by the Self-check",
      "",
      "Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.",
      "",
      ...(notChecked.length
        ? notChecked.map((row) => `- Line ${row.section}: ${notCheckedText(row)}.`)
        : ["- No Compliance Note rows."]),
    );
    const samples = latencySamples(c, log);
    const requests = seedRequestCount(c);
    const cost = usageCost(c);
    const d = distribution(samples.dispatchToResultMs);
    const f = distribution(samples.foregroundToFirstRenderMs);
    lines.push(
      "",
      "## Seed-stage numbers",
      "",
      `- Requests: ${requests.metered} metered (${requests.seeds} Batch, ${requests.feedback} Feedback); ${requests.reserved} reserved; notice at 40 ${requests.reserved >= 40 ? "shown" : "not shown"}.`,
      `- Dispatch to validated result: median ${seconds(d.medianMs)}, p95 ${seconds(d.p95Ms)} over ${d.count} Batch(es).`,
      `- Foreground dispatch to first render (script-observed): median ${seconds(f.medianMs)}, p95 ${seconds(f.p95Ms)} over ${f.count}.`,
      `- Sign-off to report created: ${seconds(samples.signOffToReportMs[0] ?? null)}.`,
      ...(samples.singleModeRequestToReportMs.length ? [`- Single-mode baseline, request to report: ${seconds(samples.singleModeRequestToReportMs[0])}.`] : []),
      `- Cost from aiUsage: ${usd(cost.totalUsd)} in all (${usd(cost.seedStageUsd)} seed stage, ${usd(cost.otherUsd)} Brief, drafting and checks) over ${cost.rows} calls on ${cost.models.join(", ") || "no model"}.`,
    );
    if (c.truncated.length) lines.push(`- Reads truncated: ${c.truncated.join(", ")}.`);
  }
  lines.push("", "## Run log", "", "```", ...log.lines, "```", "");
  return lines.join("\n");
}

export function renderSummary(results: readonly FixtureResult[], context: PackContext): string {
  const samples = mergeSamples(results.filter((r) => r.collected).map((r) => latencySamples(r.collected as Collected, r.log)));
  const d = distribution(samples.dispatchToResultMs);
  const f = distribution(samples.foregroundToFirstRenderMs);
  const s = distribution(samples.signOffToReportMs);
  const b = distribution(samples.singleModeRequestToReportMs);
  const within = (value: number | null, limit: number) => (value === null ? "not measured" : value <= limit ? "within" : "over");
  const costs = results.filter((r) => r.collected).map((r) => usageCost(r.collected as Collected));
  const total = costs.reduce((sum, cost) => sum + cost.totalUsd, 0);
  const seedStage = costs.reduce((sum, cost) => sum + cost.seedStageUsd, 0);
  const lines = [
    `# Step by step release suite, ${context.date}`,
    "",
    `Deployment \`${context.deployment}\`, commit \`${context.commit}\`, acting as ${context.reviewer}. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.`,
    "",
    "| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => {
      const passed = r.checks.filter((item) => item.status === "pass").length;
      const failed = r.checks.filter((item) => item.status === "fail").length;
      const requests = r.collected ? seedRequestCount(r.collected).reserved : 0;
      return `| [${r.fixture.id}](${r.fixture.id}.md) | ${SEMANTIC_CASES[r.fixture.semanticCase].title} | ${passed} pass, ${failed} fail | ${requests} |  |  |`;
    }),
    "",
    // 2026-10-02 (alert 7): the settings score, tracked run to run.
    ...results
      .filter((r) => r.fixture.semanticCase === "writer_settings_document")
      .map((r) =>
        `Settings rules broken (${r.fixture.id}): ${
          r.collected?.report
            ? settingsBrokenText(settingsResultsFor(r.fixture.params as unknown as SettingsParams, r.collected) ?? [], { ids: false })
            : "no report"
        }.\n`,
      ),
    "## CAP-14 numbers (placeholders are reported against, never changed here)",
    "",
    `- Dispatch to validated result: median ${seconds(d.medianMs)} (placeholder 12 s: ${within(d.medianMs, LATENCY_PLACEHOLDERS.medianMs)}), p95 ${seconds(d.p95Ms)} (placeholder 30 s: ${within(d.p95Ms, LATENCY_PLACEHOLDERS.p95Ms)}), over ${d.count} Batches.`,
    `- Foreground dispatch to first render: median ${seconds(f.medianMs)}, p95 ${seconds(f.p95Ms)} over ${f.count} (unthresholded; script-observed, so it includes the script's polling).`,
    `- Sign-off to report created: median ${seconds(s.medianMs)}, p95 ${seconds(s.p95Ms)} over ${s.count}.`,
    b.count
      ? `- Single-mode request to report created (same projects and model): median ${seconds(b.medianMs)} over ${b.count}. CAP-14 asks sign-off to report to stay within single-mode drafting time plus the consistency pass.`
      : "- Single-mode baseline not measured (run with --single-baseline).",
    `- Seed-stage requests per generation: ${results.map((r) => (r.collected ? seedRequestCount(r.collected).reserved : 0)).join(", ")} (notice at 40; counter-metric median at most 20, p95 under 40).`,
    `- Cost from aiUsage: ${usd(total)} in all, ${usd(seedStage)} of it in the seed stage.`,
    "",
    "Raw data for every fixture is in `results.json`.",
    "",
  ];
  return lines.join("\n");
}

/** Reserve a fresh pack folder: never overwrite earlier evidence. */
export function reservePackDir(root: string, date: string): string {
  mkdirSync(root, { recursive: true });
  for (let n = 1; n < 1000; n += 1) {
    const dir = path.join(root, n === 1 ? date : `${date}-run${n}`);
    try {
      mkdirSync(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`No free pack folder under ${root}`);
}

/**
 * Rebuild a pack from an earlier run's results.json with today's checks and
 * rendering, without any Convex or model call. The fixture manifests come
 * from the current fixtures folder when they still exist.
 */
export function rerenderResults(
  saved: { context: PackContext; results: FixtureResult[] },
  fixtures: readonly FixtureManifest[],
): { context: PackContext; results: FixtureResult[] } {
  return {
    context: saved.context,
    results: saved.results.map((result) => {
      const fixture = fixtures.find((candidate) => candidate.id === result.fixture.id) ?? result.fixture;
      const { dir: _dir, texts: _texts, ...manifest } = fixture as Fixture;
      void _dir;
      void _texts;
      return { ...result, fixture: manifest, checks: runChecks(manifest, result.collected, result.log) };
    }),
  };
}

export function writePack(dir: string, results: readonly FixtureResult[], context: PackContext): string[] {
  const written: string[] = [];
  for (const result of results) {
    const file = path.join(dir, `${result.fixture.id}.md`);
    writeFileSync(file, renderFixturePack(result, context));
    written.push(file);
  }
  const summary = path.join(dir, "summary.md");
  writeFileSync(summary, renderSummary(results, context));
  written.push(summary);
  const raw = path.join(dir, "results.json");
  writeFileSync(raw, `${JSON.stringify({ context, results }, null, 2)}\n`);
  written.push(raw);
  return written;
}
