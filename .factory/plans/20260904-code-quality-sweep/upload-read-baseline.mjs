// Run from the repository/worktree being measured. This runner reads source,
// invokes actual registered functions in an in-memory convex-test backend,
// and prints measurements. It writes no files and calls no shared backend.
// Node's module hooks only transpile local TypeScript in memory.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire, registerHooks } from "node:module";

const requireFromWorktree = createRequire(path.join(process.cwd(), "package.json"));
const ts = requireFromWorktree("typescript");
const { convexTest } = await import(pathToFileURL(requireFromWorktree.resolve("convex-test")).href);

// This mutation needs only local Convex database/storage fakes. Reject any
// accidental fetch rather than contacting a deployment or external service.
globalThis.fetch = async () => {
  throw new Error("Network fetch is disabled in the local upload-read baseline runner");
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith(".") || specifier.startsWith("/")) &&
        context.parentURL?.startsWith("file:")
      ) {
        const candidate = fileURLToPath(new URL(specifier, context.parentURL));
        for (const extension of [".ts", ".js"]) {
          if (fs.existsSync(candidate + extension)) {
            return { url: pathToFileURL(candidate + extension).href, shortCircuit: true };
          }
        }
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      return {
        format: "module",
        source: ts.transpileModule(fs.readFileSync(fileURLToPath(url), "utf8"), {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const convexRoot = path.resolve("convex");
const modules = {};
for (const relative of fs.readdirSync(convexRoot, { recursive: true }).filter((file) =>
  /\.(ts|js)$/.test(file) && !file.endsWith(".d.ts") && !file.endsWith(".test.ts"),
)) {
  modules["./" + relative] = () => import(pathToFileURL(path.join(convexRoot, relative)).href);
}
const { default: schema } = await import(pathToFileURL(path.join(convexRoot, "schema.ts")).href);
const { api } = await import(pathToFileURL(path.join(convexRoot, "_generated/api.js")).href);
const documentsSource = fs.readFileSync(path.join(convexRoot, "documents.ts"), "utf8");
console.log(JSON.stringify({
  kind: "upload_read_measurement_context",
  cwd: process.cwd(),
  node: process.version,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  source: "convex/documents.ts",
  sourceSha256: createHash("sha256").update(documentsSource).digest("hex"),
  convexVersion: requireFromWorktree("convex/package.json").version,
  convexTestVersion: requireFromWorktree("convex-test/package.json").version,
}));

for (const existingCount of [0, 3]) {
  const t = convexTest(schema, modules);
  const authId = "local-perf-proof";
  const projectId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId,
      email: "local-perf-proof@example.invalid",
      role: "writer",
    });
    const id = await ctx.db.insert("projects", {
      title: "Local-only measurement",
      clientName: "Synthetic",
      status: "draft",
      createdBy: userId,
      shareToken: "local-only",
      createdAt: 1,
      updatedAt: 1,
    });
    for (let i = 0; i < existingCount; i++) {
      await ctx.db.insert("projectDocuments", {
        projectId: id,
        fileName: `existing-${i}.txt`,
        fileType: "txt",
        content: "a".repeat(100_000),
        source: "test",
        uploadedBy: userId,
        createdAt: i + 1,
      });
    }
    return id;
  });
  const writer = t.withIdentity({ subject: authId });
  const result = await writer.mutation(async (ctx) => {
    const documentId = await ctx.runMutation(api.documents.uploadDocument, {
      projectId,
      fileName: "image.png",
      fileType: "image",
      content: "",
    });
    return { documentId, metrics: await ctx.meta.getTransactionMetrics() };
  });
  // Inspect the inserted result in a separate transaction, after capturing
  // metrics, so the verification read is not part of the upload cost.
  const stored = await t.run((ctx) => ctx.db.get(result.documentId));
  if (stored?.processingStatus !== "reference_only") {
    throw new Error("Actual uploadDocument did not produce the expected reference-only image row");
  }
  console.log(JSON.stringify({
    kind: "actual_registered_upload_local_convex_test",
    existingCount,
    existingDocumentChars: 100_000,
    databaseQueries: result.metrics.databaseQueries.used,
    documentsRead: result.metrics.documentsRead.used,
    bytesRead: result.metrics.bytesRead.used,
    status: stored.processingStatus,
  }));
}
