// Is an Anthropic key's account held to the history check for newer Claude
// models (docs/product-domain.md, 2026-10-23)? Chat rebuilds its context
// every turn, so on a held account it would fail after moving to Sonnet 5.5.
//
// Mints a thinking block on claude-sonnet-5-5, then replays it after editing
// the system prompt, as chat does when its context changes. Without the beta
// header, a 400 means the account is held; a 200 means it is not. Four small
// requests, about $0.01. The key is read from ANTHROPIC_API_KEY and never
// printed. Run with the deployment's key, for example:
//
//   ANTHROPIC_API_KEY="$(npx convex env get ANTHROPIC_API_KEY --prod)" node scripts/anthropic-history-check.mjs
//
// A CONVEX_DEPLOY_KEY in .env.local pins the CLI to that deployment and
// ignores --prod, so run the key lookup where it reaches production.
import Anthropic from "@anthropic-ai/sdk";

const model = process.argv[2] ?? "claude-sonnet-5-5";
if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  console.error("Set ANTHROPIC_API_KEY to the deployment's key.");
  process.exit(2);
}
const client = new Anthropic();
const question = {
  role: "user",
  content:
    "A train leaves at 9:40 and the trip takes 2 h 55 min with a 25 min stop counted separately. " +
    "Another leaves at 10:05 and takes 3 h 10 min with no stop. Which arrives first and by how many minutes? Answer in one line.",
};
const base = { model, max_tokens: 4000, thinking: { type: "adaptive" }, output_config: { effort: "high" } };
const systemA = "Context version A: project files list 1.";
const systemB = "Context version B: project files list 2.";

const minted = await client.messages.create({ ...base, system: systemA, messages: [question] });
if (!minted.content.some((block) => block.type === "thinking" || block.type === "redacted_thinking")) {
  console.log("Inconclusive: the first answer had no thinking block. Run it again.");
  process.exit(1);
}
const history = [question, { role: "assistant", content: minted.content }, { role: "user", content: "Say it again in five words." }];
await client.messages.create({ ...base, system: systemA, messages: history });
console.log("Unchanged history replayed: accepted.");
let held = false;
try {
  await client.messages.create({ ...base, system: systemB, messages: history });
  console.log("Edited history replayed without the beta header: accepted. The account is not held to the check.");
} catch (error) {
  if (!(error instanceof Anthropic.BadRequestError)) throw error;
  held = true;
  console.log(`Edited history replayed without the beta header: refused (${error.status}). The account is held to the check.`);
}
if (!held) {
  const flagged = await client.beta.messages.create({
    ...base,
    betas: ["thinking-binding-controls-2026-08-01"],
    system: systemB,
    messages: history,
  });
  console.log(`With the beta header only, the edit is listed as: ${JSON.stringify(flagged.input_transformations ?? null)}`);
}
console.log(held ? "Result: HELD. Do not move chat to Sonnet 5.5 on this key yet." : "Result: NOT HELD. Chat keeps working after the move.");
process.exit(held ? 1 : 0);
