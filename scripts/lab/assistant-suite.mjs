#!/usr/bin/env node
// @ts-nocheck: plain Node script.
//
// The Assistant test set (2026-11-03): runs the report Assistant through the
// cases the firm raised (Larry's rule changes, Tracy's "never invent", lists,
// banned words, paragraph changes, who may approve what, the CRA limit at
// export) on the lab's local copy, with fictional data only, and writes a
// pass/fail report. Real models: about $2 to $3 a run.
//
//   node scripts/lab/lab.mjs up --cap 10
//   node scripts/lab/assistant-suite.mjs [--out report.md] [--only a,b]
//
// Every check reads what the app stored (cards, their rules, the report), not
// the model's wording, except where noted; each reply is kept in the report
// for a person to read.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAB = path.join(path.dirname(fileURLToPath(import.meta.url)), "lab.mjs");
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv[i + 1];
};
const only = option("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const out = option("--out", path.join(os.tmpdir(), `banhall-assistant-suite-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`));

/** One lab command; its JSON output, or { error } when it failed. */
function lab(...args) {
  try {
    const text = execFileSync(process.execPath, [LAB, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }).trim();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return { text };
    }
  } catch (error) {
    return { error: String(error.stderr || error.message).trim().split("\n").slice(-4).join(" ") };
  }
}

const SOURCE = `Interviewer: What was the project this year?

Client: We tried to get mixed fleets of delivery robots to share hospital lifts on their own. We had two robot makers in one building, each with its own fleet manager, and a lift controller from a third company. The open coordination framework we build on can reserve a lift for one robot at a time, but in our trials robots from the two fleets kept arriving at the lift lobby together and blocking each other.

Interviewer: Why was that hard to solve?

Client: The framework plans each fleet's route, then negotiates conflicts in the corridors, but it treats the lift as a door that is open or closed. In a real lift the car takes 20 to 90 seconds to arrive, people get on and off, and the controller only tells us the floor, not whether there is room. Nobody had a model of lift wait time that the planner could use. The usual approach in the framework docs is a fixed reservation window, and with that the robots either waited far too long or collided in the lobby.

Interviewer: What did you try?

Client: First we lengthened the fixed window to 120 seconds. The jams stopped but each delivery took about four minutes longer, which the hospital would not accept. Second, we logged six weeks of lift calls from the controller and fit a simple wait time estimate per hour of the day, and used it as the reservation window. That cut the extra time to about 70 seconds, but it still jammed at shift change, when the lifts are full. Third, we added a rule that a robot only enters the lobby when the planner predicts the car will arrive within 15 seconds, otherwise it holds in the corridor. In the last month of trials that gave 3 lobby blockages in about 1,400 lift trips, against 61 in the first month.

Interviewer: Anything still open?

Client: We still do not know how to tell if the car has room when it arrives. The controller does not report load, and our camera test in one lift was not reliable with people standing at the door. We also never tested more than two fleets.

Interviewer: Who worked on it and for how long?

Client: Three developers and one field technician, roughly 1,600 hours from February to November.`;

/** Paragraph texts of one Line in the stored report. */
function lineParagraphs(projectId, line) {
  const report = lab("report", projectId, "--json");
  const doc = JSON.parse(report.content);
  const blocks = doc.content ?? [];
  const start = blocks.findIndex((b) => b.type === "heading" && JSON.stringify(b).includes(`Line ${line}`));
  const texts = [];
  for (let i = start + 1; i > 0 && i < blocks.length; i++) {
    if (blocks[i].type === "heading" || blocks[i].type === "horizontalRule") break;
    if (blocks[i].type === "paragraph") texts.push((blocks[i].content ?? []).map((c) => c.text ?? "").join(""));
  }
  return texts;
}

function reportText(projectId) {
  return lab("report", projectId).text ?? "";
}

function apply(card, as = "writer") {
  const names = (card.rulesBroken ?? []).map((rule) => rule.name);
  const args = { proposalId: card.id, ...(names.length ? { overrideRules: names } : {}) };
  return lab("run", "chatV2:applyProposal", JSON.stringify(args), "--as", as);
}

const kinds = (card) => (card?.rulesBroken ?? []).map((rule) => rule.kind);

/** Each case: a name, what it shows, and a run that returns checks. */
const CASES = [
  {
    name: "opener",
    why: "Larry: the Assistant makes a change the writer asks for that departs from the template, and the writer can apply it.",
    run: (p) => {
      const turn = lab("chat", p, "In Line 242, the paragraph that starts 'The limitations to standard practice were that' - drop that opener and start it with 'The fixed reservation window fell short because', keeping the rest.", "--new-thread");
      const card = turn.proposals?.[0];
      const applied = card ? apply(card) : null;
      return {
        turn,
        checks: [
          ["made a card", Boolean(card)],
          ["no manager-only rule on it", card ? !kinds(card).some((k) => ["house_rule", "cra_limit"].includes(k)) : false],
          ["the writer applied it", applied?.applied === true],
        ],
      };
    },
  },
  {
    name: "one-sentence",
    why: "Owner: a one-sentence paragraph is a template rule the writer may override.",
    run: (p) => {
      const turn = lab("chat", p, "Make the last paragraph of Line 246 a single sentence.", "--new-thread");
      const card = turn.proposals?.[0];
      const applied = card ? apply(card) : null;
      return {
        turn,
        checks: [
          ["made a card marked as going against the template", kinds(card).includes("template")],
          ["the writer applied it", applied?.applied === true],
        ],
      };
    },
  },
  {
    name: "banned-word",
    why: "Owner: a banned word is asked about once; after yes it is used and kept.",
    run: (p) => {
      const ask = lab("chat", p, "In Line 244, in the paragraph about the 15-second rule, call it a novel entry rule.", "--new-thread");
      const asked = /ASKS THE WRITER:.*novel/i.test(ask.reply ?? "") && (ask.proposals ?? []).length === 0;
      const yes = asked ? lab("chat", p, 'Yes, use "novel" anyway', "--thread", ask.threadId) : null;
      const card = yes?.proposals?.find((c) => c.state === "pending");
      const applied = card ? apply(card) : null;
      return {
        turn: { reply: `${ask.reply}\n\n-- after "yes" --\n\n${yes?.reply ?? "(not sent)"}`, proposals: yes?.proposals ?? ask.proposals },
        checks: [
          ["asked once, with no card yet", asked],
          ["the card names the banned word", kinds(card).includes("banned_words")],
          ["the writer applied it and the word stayed", applied?.applied === true && /novel/i.test(reportText(p))],
        ],
      };
    },
  },
  {
    name: "banned-word-kept",
    why: "Owner 2026-11-03 (option C): a banned word the writer approved stays when a later card rewrites its passage. Runs after banned-word.",
    run: (p) => {
      const had = /novel/i.test(reportText(p));
      const turn = lab("chat", p, "Tighten the paragraph in Line 244 about the 15-second entry rule.", "--new-thread");
      const card = turn.proposals?.[0];
      const applied = card ? apply(card) : null;
      return {
        turn,
        checks: [
          ["the report held the approved word first", had],
          ["the writer applied the tightening", applied?.applied === true],
          ["the approved word is still there", /novel/i.test(reportText(p))],
        ],
      };
    },
  },
  {
    name: "bullets",
    why: "Owner: bullet points and numbered lists never go in the report, whoever asks.",
    run: (p) => {
      const before = reportText(p);
      const turn = lab("chat", p, "Turn the 'It was uncertain whether' paragraphs in Line 242 into a bullet list.", "--new-thread");
      return {
        turn,
        checks: [
          ["made no card", (turn.proposals ?? []).length === 0],
          ["the report did not change", reportText(p) === before],
        ],
      };
    },
  },
  {
    name: "add-paragraph",
    why: "Owner 2026-11-03: a card can add a paragraph.",
    run: (p) => {
      const before = lineParagraphs(p, 246).length;
      const turn = lab("chat", p, "Add a new short paragraph at the end of Line 246 saying that telling whether the lift car has room is the open question for next year, using only what the interview says.", "--new-thread");
      const card = turn.proposals?.[0];
      const applied = card ? apply(card) : null;
      return {
        turn,
        checks: [
          ["made a card", Boolean(card)],
          ["applying it added a paragraph to Line 246", applied?.applied === true && lineParagraphs(p, 246).length === before + 1],
        ],
      };
    },
  },
  {
    name: "merge-paragraphs",
    why: "Owner 2026-11-03: a card can merge paragraphs.",
    run: (p) => {
      const before = lineParagraphs(p, 246).length;
      const turn = lab("chat", p, "Merge the last two paragraphs of Line 246 into one paragraph.", "--new-thread");
      const card = turn.proposals?.[0];
      const applied = card ? apply(card) : null;
      return {
        turn,
        checks: [
          ["made a card", Boolean(card)],
          ["applying it left one paragraph fewer in Line 246", applied?.applied === true && lineParagraphs(p, 246).length === before - 1],
        ],
      };
    },
  },
  {
    name: "no-invention",
    why: "Tracy: never make up a fact, a number or an event, whoever asks.",
    run: (p) => {
      const turn = lab("chat", p, "Add to Line 244 that the final rule cut delivery costs by 40 percent.", "--new-thread");
      // A note to the writer that asks for the figure ([GAP: ...]) is the
      // right answer; only report text that states it fails.
      const prose = (text) => text.replace(/\[(?:GAP|INFERRED|NOTE):[^\]]*\]/gi, "");
      const invented = (turn.proposals ?? []).some((c) => (c.texts ?? [c.newText ?? ""]).some((t) => /40\s*(%|percent)/i.test(prose(t))));
      return { turn, checks: [["no card states the 40 percent as fact (a gap note asking for it is fine)", !invented]] };
    },
  },
  {
    name: "house-rule",
    why: "Owner: a house rule needs a Manager or an Admin; a writer cannot apply it.",
    run: (p) => {
      const turn = lab("chat", p, "Rewrite the first paragraph of Line 244 in the first person, using we.", "--new-thread");
      const card = (turn.proposals ?? []).find((c) => kinds(c).includes("house_rule"));
      const byWriter = card ? apply(card, "writer") : null;
      const byManager = card ? apply(card, "manager") : null;
      return {
        turn,
        checks: [
          ["made a card marked as going against a house rule", Boolean(card)],
          ["a writer may not apply it", Boolean(byWriter?.error && /manager/i.test(byWriter.error))],
          ["a manager may", byManager?.applied === true],
        ],
      };
    },
  },
  {
    name: "export-over-limit",
    why: "Owner: over a CRA limit, export is refused so no lines or words are lost.",
    run: (p) => {
      const report = lab("report", p, "--json");
      const doc = JSON.parse(report.content);
      const blocks = doc.content;
      const start = blocks.findIndex((b) => b.type === "heading" && JSON.stringify(b).includes("Line 244"));
      let end = start + 1;
      while (end < blocks.length && blocks[end].type !== "horizontalRule" && blocks[end].type !== "heading") end++;
      blocks.splice(end, 0, ...JSON.parse(JSON.stringify(blocks.slice(start + 1, end))), ...JSON.parse(JSON.stringify(blocks.slice(start + 1, end))));
      lab("run", "reports:updateReportContent", JSON.stringify({ reportId: report._id, content: JSON.stringify(doc), expectedRevisionNumber: report.revisionNumber ?? 0 }), "--as", "writer");
      const check = lab("export-check", p);
      return {
        turn: { reply: check.reason ?? JSON.stringify(check), proposals: [] },
        checks: [["export refused, naming Line 244 and the CRA limit", check.exportAllowed === false && /Line 244 is over the CRA limit/.test(check.reason ?? "")]],
      };
    },
  },
];

const status = lab("status");
if (!status?.up) {
  console.error("The lab is not up. Run: node scripts/lab/lab.mjs up --cap 10");
  process.exit(2);
}
const sourceFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "banhall-suite-")), "source.txt");
fs.writeFileSync(sourceFile, SOURCE);
const spentBefore = lab("spend").totalUsd ?? 0;
const project = lab("project", "--source", sourceFile, "--title", `Assistant suite ${new Date().toISOString().slice(0, 16)}`, "--client", "Fictional Fleet Robotics Ltd.", "--interviewee", "Sam Ortiz");
if (!project?.projectId) {
  console.error(`Could not make the project: ${JSON.stringify(project)}`);
  process.exit(1);
}
const p = project.projectId;
lab("run", "projects:updateProjectScienceCode", JSON.stringify({ projectId: p, scienceCode: "1.02.01" }), "--as", "writer");
console.error(`[suite] project ${p}; drafting`);
const draft = lab("draft", p, "--mode", "single", "--web-background", "off");
if (!draft?.reportId) {
  console.error(`The draft did not finish: ${JSON.stringify(draft)}`);
  process.exit(1);
}

const results = [];
for (const c of CASES) {
  if (only && !only.includes(c.name)) continue;
  console.error(`[suite] ${c.name}`);
  let result;
  try {
    result = c.run(p);
  } catch (error) {
    result = { turn: { reply: `(the case crashed: ${error.message})` }, checks: [["ran", false]] };
  }
  const passed = result.checks.every(([, ok]) => ok);
  console.error(`[suite] ${c.name}: ${passed ? "pass" : "FAIL"}`);
  results.push({ ...c, ...result, passed });
}
const spent = (lab("spend").totalUsd ?? 0) - spentBefore;

const lines = [
  `# Assistant test set`,
  "",
  `${results.filter((r) => r.passed).length} of ${results.length} cases passed. Project ${p}. Spend $${spent.toFixed(2)}.`,
  "",
  ...results.flatMap((r) => [
    `## ${r.passed ? "Pass" : "FAIL"}: ${r.name}`,
    "",
    r.why,
    "",
    ...r.checks.map(([label, ok]) => `- ${ok ? "pass" : "FAIL"}: ${label}`),
    "",
    "Reply:",
    "",
    ...(r.turn?.error ? [`> error: ${r.turn.error}`] : (r.turn?.reply ?? "").split("\n").map((l) => `> ${l}`)),
    "",
    ...(r.turn?.proposals ?? []).map((c) => `Card (${c.state}, rules: ${kinds(c).join(", ") || "none"}): ${(c.newText ?? "").slice(0, 400)}`),
    "",
  ]),
];
fs.writeFileSync(out, lines.join("\n"));
console.log(JSON.stringify({ passed: results.filter((r) => r.passed).length, total: results.length, spentUsd: Number(spent.toFixed(2)), report: out }, null, 2));
process.exitCode = results.every((r) => r.passed) ? 0 : 1;
