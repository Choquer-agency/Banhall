// The browser scenarios of the report chat live test (scripts/chat-live).
// Each one opens its own page in the signed-in session, checks what a writer
// would see, and throws with a plain reason when something is wrong.
import fs from "node:fs";
import { chromium } from "playwright";

const DEVIATION_REQUEST = "List the deviations in this report, then fix them one Line at a time.";

// The Assistant stays mounted when closed; the page marks its dialog inert.
async function assistantOpen(page) {
  const dialog = page.locator("[role=dialog][aria-label='AI assistant']").first();
  return (await dialog.count()) > 0 && (await dialog.evaluate((el) => !el.inert));
}

async function openPanel(page, ctx) {
  await page.goto(`${ctx.base}/project/${ctx.projectId}`);
  await page.locator("button[aria-label^='Assistant']").first().waitFor({ timeout: 60_000 });
  if (!(await assistantOpen(page))) {
    await page.locator("button[aria-label^='Assistant']").first().click();
  }
  await page.locator("textarea").first().waitFor({ timeout: 30_000 });
}

async function newConversation(page) {
  await page.getByRole("button", { name: /Conversation menu/i }).first().click();
  await page.getByRole("menuitem", { name: /New conversation/i }).first().click();
  await page.waitForTimeout(800);
}

async function send(page, text) {
  await page.locator("textarea").first().fill(text);
  await page.keyboard.press("Enter");
}

const busy = async (page) => (await page.getByRole("button", { name: /^Stop/ }).count()) > 0;

async function waitIdle(page, maxMs = 300_000) {
  const started = Date.now();
  await page.waitForTimeout(5000);
  let quiet = 0;
  while (Date.now() - started < maxMs) {
    quiet = (await busy(page)) ? 0 : quiet + 1;
    if (quiet >= 3) return;
    await page.waitForTimeout(5000);
  }
  throw new Error(`still replying after ${Math.round(maxMs / 1000)} s`);
}

const transcript = async (page) => (await page.locator("[role=log]").innerText()).replace(/\s+/g, " ");
const reportText = (page) => page.evaluate(() => document.querySelector(".ProseMirror")?.innerText ?? "");
const currentThread = (ctx) => ctx.run("chatV2:listThreads", { reportId: ctx.reportId }, ctx.me.authId)[0];
const backendLog = (ctx) => fs.readFileSync(ctx.backendLog, "utf8");

function expect(condition, reason) {
  if (!condition) throw new Error(reason);
}

// Automation scrolls a clipped item into view before it clicks; a person
// cannot. A menu item must be on top at its own centre, as drawn.
async function expectClickable(locator, what) {
  await locator.waitFor({ timeout: 10_000 });
  const onTop = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return Boolean(hit && el.contains(hit));
  });
  expect(onTop, `${what} is hidden from a person (clipped or covered)`);
}

const SCENARIOS = [
  {
    name: "panel-basics",
    async run(page, ctx) {
      await openPanel(page, ctx);
      await newConversation(page);
      const starter = page.getByRole("button", { name: "Tighten the uncertainty framing in Line 242" });
      expect(await starter.count(), "no Line 242 starter");
      await starter.click();
      expect((await page.locator("textarea").first().inputValue()) === "Tighten the uncertainty framing in Line 242", "a starter did not fill the composer");
      expect(!(await busy(page)), "a starter sent a message");
      await page.locator("textarea").first().fill("");
      await page.getByRole("button", { name: "Message options" }).click();
      const items = await page.locator("[role=menuitemcheckbox], [role=menuitem]").evaluateAll((els) =>
        els.map((e) => `${e.getAttribute("aria-checked")}|${e.innerText.trim()}`)
      );
      await page.keyboard.press("Escape");
      expect(items.includes("false|Use Brain examples for this message"), "Brain option missing or on");
      expect(items.includes("true|Search the web in this conversation"), "web search is not on by default");
      // Owner, 2026-10-21: no "Web search on" label in the chat.
      expect((await page.getByText("Web search on", { exact: true }).count()) === 0, "the chat shows a web search label");
      expect(items.some((i) => i.endsWith("|Read a file in full")), "no Read a file in full");
      return "starters fill the composer; Brain off, web on with no label, Read a file in full";
    },
  },
  {
    name: "deviation-chain",
    async run(page, ctx) {
      await openPanel(page, ctx);
      await newConversation(page);
      await send(page, DEVIATION_REQUEST);
      const labels = new Set();
      const started = Date.now();
      let quiet = 0;
      while (Date.now() - started < 15 * 60_000) {
        await page.waitForTimeout(10_000);
        labels.add(await page.locator("button[aria-label^='Assistant']").first().getAttribute("aria-label"));
        quiet = (await busy(page)) ? 0 : quiet + 1;
        if (quiet >= 3) break;
      }
      expect(quiet >= 3, "the job was still running after 15 minutes");
      const text = await transcript(page);
      const cards = await page.getByRole("button", { name: "Apply", exact: true }).count();
      const chips = await page.locator("[data-auto-continue-chip]").count();
      const turns = ctx.run("chatV2:listTurns", { threadId: currentThread(ctx).agentThreadId, startOrder: 0, endOrder: 9999 }, ctx.me.authId);
      const automatic = turns.filter((t) => t.origin === "auto_continue").length;
      const last = turns.at(-1);
      expect(cards > 0, "no card was proposed");
      expect(/Completion Report/.test(text), "no Completion Report on the cards");
      expect([...labels].some((l) => /writing a reply/.test(l ?? "")), "the launcher never showed the reply running");
      expect(!/couldn.t finish|took too long/i.test(text), "a reply failed");
      // The job either continued on its own (turns the server started), or
      // finished in one reply with no Continue offer left open.
      expect(
        automatic > 0 || (last?.status === "completed" && !last.continuation && !last.autoContinueSkipped),
        "the job neither continued on its own nor finished"
      );
      expect(automatic === 0 || chips > 0, "the job continued, but the writer saw no link to it");
      return `${cards} cards, ${automatic} automatic turns, ${chips} links shown, ${Math.round((Date.now() - started) / 1000)} s`;
    },
  },
  {
    name: "apply-undo",
    async run(page, ctx) {
      await openPanel(page, ctx);
      const before = await reportText(page);
      await page.getByRole("button", { name: "Apply", exact: true }).last().click();
      await page.waitForTimeout(4000);
      expect((await reportText(page)) !== before, "Apply did not change the report");
      await page.getByRole("button", { name: "Undo", exact: true }).last().click();
      await page.waitForTimeout(4000);
      expect((await reportText(page)) === before, "Undo did not restore the report exactly");
      return "applied, then undone to the exact text";
    },
  },
  {
    name: "feedback",
    async run(page, ctx) {
      await openPanel(page, ctx);
      await page.getByRole("button", { name: "Mark response not helpful" }).last().click();
      await page.waitForTimeout(1500);
      for (const reason of ["Wrong", "Didn't follow my request", "Made something up", "Too long", "Other"]) {
        expect(await page.getByRole("button", { name: reason, exact: true }).count(), `no "${reason}" reason`);
      }
      await page.getByRole("button", { name: "Too long", exact: true }).last().click();
      await page.waitForTimeout(1500);
      const said = await page.locator("[aria-live=polite]").evaluateAll((els) => els.map((e) => e.innerText.trim()));
      expect(said.includes("Feedback recorded. You can change it."), "the vote was not announced");
      await page.getByRole("button", { name: "Mark response helpful" }).last().click();
      await page.waitForTimeout(1500);
      expect((await page.getByRole("button", { name: "Too long", exact: true }).count()) === 0, "reasons stayed after a helpful vote");
      return "reasons shown, vote announced, vote changed";
    },
  },
  {
    name: "copy",
    async run(page, ctx) {
      await openPanel(page, ctx);
      await page.getByRole("button", { name: "Copy", exact: true }).last().click();
      await page.waitForTimeout(1000);
      const clip = await page.evaluate(async () => {
        const out = {};
        for (const item of await navigator.clipboard.read()) for (const type of item.types) out[type] = await (await item.getType(type)).text();
        return out;
      });
      expect(clip["text/html"] && clip["text/plain"], "Copy did not write both rich and plain text");
      expect(!/\*\*/.test(clip["text/plain"]), "Copy pasted raw markdown");
      expect(!/<script|<style|onclick|style=/i.test(clip["text/html"]), "copied HTML kept unsafe markup");
      return "rich and plain text, no markdown or unsafe markup";
    },
  },
  {
    name: "edit-switcher",
    async run(page, ctx) {
      // Its own conversation, so no other reply is running in it.
      await openPanel(page, ctx);
      await newConversation(page);
      await send(page, "In one sentence, what is Line 242 about?");
      await waitIdle(page);
      await page.locator("[role=log]").getByText("In one sentence, what is Line 242 about?").first().hover();
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      const box = page.getByRole("textbox", { name: "Edit your message" });
      await box.fill("In one sentence, what is Line 246 about? Then say whether I asked you anything else earlier in this conversation.");
      await page.locator("[data-message-editor]").getByRole("button", { name: "Send", exact: true }).click();
      await waitIdle(page);
      const counts = await page.getByText(/^\d+ \/ \d+$/).evaluateAll((els) => els.map((e) => e.innerText.trim()));
      expect(counts.includes("2 / 2"), `no 2 / 2 switcher (${counts.join(", ")})`);
      expect(await page.getByText("Edited by you").count(), "no author line on the edit");
      // The first question is not on this path, so the reply has no reason to name its Line.
      // Read from the end of the question: a reply may repeat its last words.
      const marker = "earlier in this conversation.";
      const shown = await transcript(page);
      expect(shown.includes(marker), "the edited question is not shown");
      const reply = shown.slice(shown.indexOf(marker) + marker.length);
      expect(!/\b242\b/.test(reply), "the edited reply still saw the original question");
      await page.getByRole("button", { name: "Previous response" }).first().click();
      await page.waitForTimeout(3000);
      const back = await page.getByText(/^\d+ \/ \d+$/).evaluateAll((els) => els.map((e) => e.innerText.trim()));
      expect(back.includes("1 / 2"), "switching back did not show 1 / 2");
      return "2 / 2 with Edited by you; back to 1 / 2";
    },
  },
  {
    name: "pinned-file",
    async run(page, ctx) {
      await openPanel(page, ctx);
      await newConversation(page);
      await page.getByRole("button", { name: "Message options" }).click();
      await page.getByRole("menuitem", { name: "Read a file in full" }).click();
      await page.getByRole("checkbox", { name: "chat-live-log.pdf" }).click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
      expect(await page.locator("[data-pinned-chip]").count(), "no pinned chip");
      await send(page, "In one sentence, what is the pinned file about?");
      await waitIdle(page);
      const text = await transcript(page);
      expect(/chat-live-log\.pdf/.test(text), "the message does not show the pinned file");
      expect(/calibration|trial|pressure|drift/i.test(text), "the reply does not reflect the pinned file");
      return "pinned, shown on the message, used in the reply";
    },
  },
  {
    name: "view-image",
    async run(page, ctx) {
      const viewsBefore = (backendLog(ctx).match(/chat file view/g) ?? []).length;
      await openPanel(page, ctx);
      await newConversation(page);
      await send(page, "Look at the image chat-live-chart.png in the project files. Which bar is tallest, and what colour is it? One sentence.");
      await waitIdle(page);
      const text = await transcript(page);
      const viewsAfter = (backendLog(ctx).match(/chat file view/g) ?? []).length;
      expect(viewsAfter > viewsBefore, "the image was not viewed");
      expect(/blue/i.test(text.slice(-400)), "the reply did not describe the chart (blue middle bar)");
      return "viewed the image and described it";
    },
  },
  {
    name: "web-sources",
    async run(page, ctx) {
      await openPanel(page, ctx);
      await newConversation(page);
      await send(page, "Using a web search, how does the CRA define experimental development for SR&ED? Two sentences, cite your sources.");
      await waitIdle(page);
      expect(!/PROVIDER_NOT_CONFIGURED/.test(backendLog(ctx)), "web search was not configured in the Node action");
      const html = await page.locator("[role=log]").innerHTML();
      expect(/data-streamdown-citation/.test(html), "no citation pills");
      expect(/Sources/.test(await transcript(page)), "no Sources row");
      const links = await page.locator("[role=log] a[href^='http']").evaluateAll((els) =>
        els.map((e) => `${e.getAttribute("rel")}|${e.getAttribute("referrerpolicy")}|${e.getAttribute("target")}`)
      );
      expect(links.length && links.every((l) => l === "noopener noreferrer|no-referrer|_blank"), "source links are not safe");
      return `${links.length} source link(s), citations shown`;
    },
  },
  {
    name: "conversation-actions",
    async run(page, ctx) {
      await openPanel(page, ctx);
      const thread = currentThread(ctx);
      await page.getByRole("button", { name: /Conversation menu/i }).first().click();
      await page.getByRole("menuitem", { name: /Conversation actions/i }).first().hover();
      await expectClickable(page.getByRole("menuitem", { name: "Rename", exact: true }).first(), "Rename");
      await page.getByRole("menuitem", { name: "Rename", exact: true }).first().click();
      const field = page.getByRole("textbox", { name: "Conversation name" });
      await field.fill("Live test conversation");
      await field.press("Enter");
      await page.waitForTimeout(1500);
      expect(currentThread(ctx).title === "Live test conversation", "rename did not save");
      await page.getByRole("button", { name: /Conversation menu/i }).first().click();
      await page.getByRole("menuitem", { name: /Conversation actions/i }).first().hover();
      await expectClickable(page.getByRole("menuitem", { name: "Archive", exact: true }).first(), "Archive");
      await page.getByRole("menuitem", { name: "Archive", exact: true }).first().click();
      await page.waitForTimeout(1500);
      expect(ctx.run("chatV2:threadStatus", { threadId: thread.agentThreadId }, ctx.me.authId) === "archived", "archive did not take");
      ctx.run("chatV2:restoreThread", { threadId: thread.agentThreadId }, ctx.me.authId);
      expect(ctx.run("chatV2:threadStatus", { threadId: thread.agentThreadId }, ctx.me.authId) === "open", "restore did not take");
      return "renamed, archived, restored";
    },
  },
  {
    name: "stop-someone-else",
    async run(page, ctx) {
      if (!ctx.other) return "skipped: no other writer in the snapshot";
      // The other writer starts a new conversation, which this new page opens as the newest.
      const sent = ctx.run("chatV2:sendMessage", { reportId: ctx.reportId, content: "Write a detailed critique of every paragraph in Line 244.", newThread: true }, ctx.other.authId);
      await openPanel(page, ctx);
      expect(currentThread(ctx).agentThreadId === sent.threadId, "the other writer's conversation is not the newest");
      await page.getByRole("button", { name: /^Stop/ }).first().waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: /^Stop/ }).first().click();
      const dialog = page.getByRole("alertdialog");
      const text = (await dialog.innerText()).replace(/\s+/g, " ");
      expect(/^Stop .+'s reply\?/.test(text) || /^Stop this reply\?/.test(text), `unexpected dialog: ${text.slice(0, 80)}`);
      expect((await page.evaluate(() => document.activeElement?.innerText?.trim())) === "Keep going", "Keep going is not focused");
      await dialog.getByRole("button", { name: "Stop reply" }).click();
      await page.waitForTimeout(4000);
      const turns = ctx.run("chatV2:listTurns", { threadId: sent.threadId, startOrder: 0, endOrder: 9999 }, ctx.me.authId);
      expect(turns.at(-1).status === "aborted", "the other writer's reply was not stopped");
      return "asked first, then stopped";
    },
  },
  {
    name: "regenerate-after-stop",
    async run(page, ctx) {
      await openPanel(page, ctx);
      await newConversation(page);
      await send(page, "Write a long, detailed critique of every paragraph in Line 246.");
      await page.waitForTimeout(10_000);
      await page.getByRole("button", { name: /^Stop/ }).first().click();
      await page.waitForTimeout(4000);
      expect((await page.getByRole("alertdialog").count()) === 0, "stopping your own reply asked for confirmation");
      await page.getByRole("button", { name: "Regenerate", exact: true }).last().click();
      await page.waitForTimeout(6000);
      const counts = await page.getByText(/^\d+ \/ \d+$/).evaluateAll((els) => els.map((e) => e.innerText.trim()));
      if (await busy(page)) await page.getByRole("button", { name: /^Stop/ }).first().click();
      expect(counts.some((c) => /^2 \/ \d+$/.test(c)), "Regenerate after Stop made no alternative");
      return "stopped, regenerated as an alternative";
    },
  },
  {
    name: "reply-ready",
    async run(page, ctx) {
      await openPanel(page, ctx);
      await page.waitForTimeout(3000);
      await page.locator("button[aria-label^='Assistant']").first().click();
      // A new conversation started outside this page, so nothing else runs in it.
      ctx.run("chatV2:sendMessage", { reportId: ctx.reportId, content: "In one short sentence, what is Line 242 about?", newThread: true }, ctx.me.authId);
      let label = "";
      for (let i = 0; i < 24 && !/ready/.test(label); i++) {
        await page.waitForTimeout(5000);
        label = (await page.locator("button[aria-label^='Assistant']").first().getAttribute("aria-label")) ?? "";
      }
      expect(/your reply is ready/.test(label), `the launcher never said the reply is ready (${label})`);
      await page.locator("button[aria-label^='Assistant']").first().click();
      await page.waitForTimeout(2000);
      expect((await page.locator("button[aria-label^='Assistant']").first().getAttribute("aria-label")) === "Assistant", "the dot stayed after opening");
      return "ready signal shown with the panel closed, cleared on open";
    },
  },
  {
    name: "vet",
    async run(page, ctx) {
      await openPanel(page, ctx);
      await page.locator(".ProseMirror p").nth(1).click({ clickCount: 3 });
      const vet = page.getByRole("button", { name: /Vet against public sources/ });
      expect(await vet.count(), "no Vet button for a selection");
      await vet.first().click();
      await page.waitForTimeout(1500);
      expect(await page.getByText(/^Vet:/).count(), "no Vet pill in the composer");
      expect((await page.locator("textarea").first().getAttribute("placeholder")) === "Anything to focus on? (optional)", "wrong Vet placeholder");
      return "button and pill shown (not sent)";
    },
  },
  {
    name: "esc-keeps-options",
    async run(page, ctx) {
      // A new, unsaved conversation: nothing is running, so the options are enabled.
      await openPanel(page, ctx);
      await newConversation(page);
      const toggleBrain = async () => {
        await page.getByRole("button", { name: "Message options" }).click();
        await page.getByRole("menuitemcheckbox", { name: "Use Brain examples for this message" }).click();
        await page.waitForTimeout(300);
        if (await page.getByRole("menu").count()) await page.keyboard.press("Escape");
        await page.evaluate(() => document.activeElement?.blur());
      };
      await toggleBrain();
      expect(await page.locator("[data-assistant-draft]").count(), "Brain on did not count as a pending choice");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1500);
      expect(await assistantOpen(page), "Esc closed the Assistant while Brain was on");
      // The negative control: with Brain off and nothing typed, Esc closes it.
      await toggleBrain();
      await page.keyboard.press("Escape");
      let open = true;
      for (let i = 0; i < 10 && open; i++) {
        await page.waitForTimeout(500);
        open = await assistantOpen(page);
      }
      expect(!open, "Esc did not close the Assistant with nothing pending");
      return "Esc keeps the Assistant open while Brain is on, and closes it otherwise";
    },
  },
  {
    name: "admin-delete",
    async run(page, ctx) {
      // A conversation whose reply has finished, past the 10 s wait after its action ended.
      const sent = ctx.run("chatV2:sendMessage", { reportId: ctx.reportId, content: "Reply with one short sentence about Line 246.", newThread: true }, ctx.me.authId);
      for (let i = 0; i < 36; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const turns = ctx.run("chatV2:listTurns", { threadId: sent.threadId, startOrder: 0, endOrder: 9999 }, ctx.me.authId);
        if (turns.length && turns.every((t) => !["queued", "running"].includes(t.status))) break;
      }
      await new Promise((r) => setTimeout(r, 12_000));
      const title = ctx.run("chatV2:listThreads", { reportId: ctx.reportId }, ctx.me.authId).find((t) => t.agentThreadId === sent.threadId)?.title;
      await openPanel(page, ctx);
      await page.getByRole("button", { name: /Conversation menu/i }).first().click();
      await page.getByRole("menuitem", { name: /Conversation actions/i }).first().hover();
      await expectClickable(page.getByRole("menuitem", { name: "Delete permanently" }).first(), "Delete permanently");
      await page.getByRole("menuitem", { name: "Delete permanently" }).first().click();
      const dialog = page.getByRole("alertdialog");
      const text = await dialog.innerText();
      expect(/Delete this conversation for everyone\? This can't be undone\./.test(text), "wrong delete dialog");
      expect(title && text.includes(title.slice(0, 30)), "the dialog names a different conversation");
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      let status = "";
      for (let i = 0; i < 12 && status !== "missing"; i++) {
        await page.waitForTimeout(5000);
        status = ctx.run("chatV2:threadStatus", { threadId: sent.threadId }, ctx.me.authId);
      }
      expect(status === "missing", `conversation status after delete: ${status}`);
      return "deleted through its dialog";
    },
  },
];

export async function runScenarios(ctx) {
  // The run handles signals and cleans up; Playwright's own handlers would
  // exit the process before that finishes.
  const browser = await chromium.launch({ headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  ctx.onBrowser?.(browser);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ctx.base });
  const results = [];
  try {
    const login = await context.newPage();
    await login.goto(`${ctx.base}/login`);
    await login.getByLabel("Email").fill(ctx.email);
    await login.locator("#password").fill(ctx.password);
    await login.getByRole("button", { name: "Sign in" }).click();
    await login.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    await login.close();
    results.push({ name: "sign-in", ok: true, detail: "signed in through the login page" });
    // A fresh worktree's dev server bundles dependencies as pages first ask
    // for them, and answers requests made before a rebundle with 504
    // "Outdated Optimize Dep". Open the report, the Assistant and its menu
    // until a load is clean, so no scenario sees that dev-only error.
    const warm = await context.newPage();
    for (let attempt = 0; attempt < 4; attempt++) {
      let outdated = false;
      const onResponse = (r) => { if (r.status() === 504) outdated = true; };
      warm.on("response", onResponse);
      await openPanel(warm, ctx).catch(() => {});
      await warm.getByRole("button", { name: "Message options" }).click({ timeout: 10_000 }).catch(() => {});
      await warm.keyboard.press("Escape");
      await warm.waitForTimeout(3000);
      warm.off("response", onResponse);
      if (!outdated) break;
    }
    await warm.close();
    for (const scenario of SCENARIOS) {
      if (ctx.only && !ctx.only.includes(scenario.name)) continue;
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const url = m.location()?.url ?? "";
        // Google's favicon service answers 404, with its default globe image
        // as the body, for a source site that has no icon. The writer still
        // sees an icon; only the browser console notes the status.
        if (/^https:\/\/(www\.google\.com\/s2\/favicons|t\d\.gstatic\.com\/faviconV2)\?/.test(url)) return;
        errors.push(`${m.text().slice(0, 160)}${url ? ` (${url.slice(0, 120)})` : ""}`);
      });
      try {
        const detail = await scenario.run(page, ctx);
        if (errors.length) throw new Error(`console errors: ${errors.slice(0, 3).join(" | ")}`);
        results.push({ name: scenario.name, ok: true, detail });
      } catch (error) {
        await page.screenshot({ path: `${ctx.shots}/${scenario.name}-failed.png` }).catch(() => {});
        results.push({ name: scenario.name, ok: false, detail: error instanceof Error ? error.message.split("\n")[0] : String(error) });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
