#!/usr/bin/env node
// @ts-nocheck: plain Node script.
//
// MCP server (stdio) for the Banhall lab. Each tool runs scripts/lab/lab.mjs,
// so an agent sees exactly what a person sees in a terminal. Add it with:
//   claude mcp add banhall-lab -- node <repo>/scripts/lab/mcp.mjs
//   codex mcp add banhall-lab -- node <repo>/scripts/lab/mcp.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const LAB = path.join(path.dirname(fileURLToPath(import.meta.url)), "lab.mjs");
const as = { type: "string", enum: ["admin", "manager", "writer"], description: "Which lab login acts. Default writer." };
const projectId = { type: "string", description: "A lab project id." };

const TOOLS = [
  { name: "lab_status", description: "Whether the lab is up, its URL, logins, spend and cap.", schema: {}, args: () => ["status"] },
  {
    name: "lab_up",
    description: "Start the lab: a blank private local copy of the app (no client data) with admin, manager and writer logins. Takes a few minutes.",
    schema: { target: { type: "string", description: "Git ref to run. Default HEAD." }, capUsd: { type: "number", description: "AI spend cap in dollars. Default 10." } },
    args: (a) => ["up", ...(a.target ? ["--target", a.target] : []), ...(a.capUsd ? ["--cap", String(a.capUsd)] : [])],
  },
  { name: "lab_down", description: "Stop the lab and delete it.", schema: {}, args: () => ["down"] },
  { name: "lab_spend", description: "AI spend on the lab so far, by call site and model.", schema: {}, args: () => ["spend"] },
  {
    name: "lab_run",
    description: "Run any Convex function on the lab, as a lab login (or internal, CLI level, when `as` is omitted).",
    schema: { fn: { type: "string", description: "e.g. projects:listProjects" }, args: { type: "object", description: "Function arguments." }, as: { ...as, description: "Login to act as; omit for internal functions." } },
    required: ["fn"],
    args: (a) => ["run", a.fn, JSON.stringify(a.args ?? {}), ...(a.as ? ["--as", a.as] : [])],
  },
  {
    name: "lab_query",
    description: "A read-only inline Convex query on the lab, e.g. \"return await ctx.db.query('projects').take(5)\".",
    schema: { code: { type: "string" } },
    required: ["code"],
    args: (a) => ["query", a.code],
  },
  {
    name: "lab_project",
    description: "Create a fictional evaluation project from source text (interview or written answers). Returns its projectId.",
    schema: { source: { type: "string", description: "The interview or written answers. Fictional only." }, title: { type: "string" }, client: { type: "string" }, interviewee: { type: "string" }, industry: { type: "string" }, as },
    required: ["source", "title"],
    args: (a, tmp) => {
      const file = path.join(tmp, "source.txt");
      fs.writeFileSync(file, a.source);
      return ["project", "--source", file, "--title", a.title, ...(a.client ? ["--client", a.client] : []), ...(a.interviewee ? ["--interviewee", a.interviewee] : []), ...(a.industry ? ["--industry", a.industry] : []), ...(a.as ? ["--as", a.as] : [])];
    },
  },
  {
    name: "lab_draft",
    description: "Start a draft and wait for it (costs money; refused past the cap).",
    schema: { projectId, mode: { type: "string", enum: ["single", "compare", "iterative"] }, webBackground: { type: "boolean" }, model: { type: "string" }, confirmRegeneration: { type: "boolean" }, noWait: { type: "boolean" }, as },
    required: ["projectId"],
    args: (a) => ["draft", a.projectId, ...(a.mode ? ["--mode", a.mode] : []), ...(a.webBackground === undefined ? [] : ["--web-background", a.webBackground ? "on" : "off"]), ...(a.model ? ["--model", a.model] : []), ...(a.confirmRegeneration ? ["--confirm-regeneration"] : []), ...(a.noWait ? ["--no-wait"] : []), ...(a.as ? ["--as", a.as] : [])],
  },
  { name: "lab_wait", description: "Wait for the project's latest draft.", schema: { projectId }, required: ["projectId"], args: (a) => ["wait", a.projectId] },
  { name: "lab_report", description: "The project's latest report text.", schema: { projectId }, required: ["projectId"], args: (a) => ["report", a.projectId] },
  {
    name: "lab_chat",
    description: "Send a message to the report Assistant and wait for its reply and proposals (costs money).",
    schema: { projectId, message: { type: "string" }, threadId: { type: "string" }, newThread: { type: "boolean" }, web: { type: "boolean" }, as },
    required: ["projectId", "message"],
    args: (a) => ["chat", a.projectId, a.message, ...(a.threadId ? ["--thread", a.threadId] : []), ...(a.newThread ? ["--new-thread"] : []), ...(a.web ? ["--web"] : []), ...(a.as ? ["--as", a.as] : [])],
  },
  { name: "lab_export_check", description: "Whether the report may be exported, and why not.", schema: { projectId, as }, required: ["projectId"], args: (a) => ["export-check", a.projectId, ...(a.as ? ["--as", a.as] : [])] },
];

function runLab(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [LAB, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, text: [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n") }));
  });
}

const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");

/** The first required field that is missing or not the right type, or null. */
function badArgument(tool, args) {
  for (const name of tool.required ?? []) {
    const value = args[name];
    if (value === undefined || value === null || value === "") return `${name} is required`;
  }
  for (const [name, schema] of Object.entries(tool.schema)) {
    const value = args[name];
    if (value === undefined) continue;
    const ok = schema.type === "object" ? typeof value === "object" && !Array.isArray(value) : typeof value === schema.type;
    if (!ok) return `${name} must be a ${schema.type}`;
    if (schema.enum && !schema.enum.includes(value)) return `${name} must be one of ${schema.enum.join(", ")}`;
  }
  return null;
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const reply = (result) => send({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => send({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  try {
    if (msg.method === "initialize") {
      return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "banhall-lab", version: "1.0.0" } });
    }
    if (msg.method === "tools/list") {
      return reply({
        tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: { type: "object", properties: t.schema, required: t.required ?? [] } })),
      });
    }
    if (msg.method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(-32602, `Unknown tool ${msg.params?.name}`);
      const args = msg.params.arguments ?? {};
      const problem = badArgument(tool, args);
      if (problem) return reply({ content: [{ type: "text", text: problem }], isError: true });
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "banhall-lab-mcp-"));
      try {
        const { code, text } = await runLab(tool.args(args, tmp));
        return reply({ content: [{ type: "text", text: text || "(no output)" }], isError: code !== 0 });
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
    if (msg.method === "ping") return reply({});
    if (msg.id !== undefined) fail(-32601, `Method not found: ${msg.method}`);
  } catch (error) {
    if (msg.id !== undefined) fail(-32603, error instanceof Error ? error.message : String(error));
  }
});
