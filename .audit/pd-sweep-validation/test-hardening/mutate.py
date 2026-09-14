import sys, pathlib
# usage: mutate.py <name>
MUT = {
 # Gap A
 "parent-run-generation-check": ("convex/generations.ts", [(
   "if (!candidateRun || candidateRun.generationId !== generation._id) return [];",
   "if (!candidateRun) return [];")]),
 "row-generation-filter": ("convex/generations.ts", [(
   "        row.generationId === generation._id &&\n        row.candidateRunId !== undefined &&",
   "        row.candidateRunId !== undefined &&")]),
 "ownership-both": ("convex/generations.ts", [(
   "if (!candidateRun || candidateRun.generationId !== generation._id) return [];",
   "if (!candidateRun) return [];"),(
   "        row.generationId === generation._id &&\n        row.candidateRunId !== undefined &&",
   "        row.candidateRunId !== undefined &&")]),
 "missing-parent-guard": ("convex/generations.ts", [(
   "if (!candidateRun || candidateRun.generationId !== generation._id) return [];",
   "if (candidateRun && candidateRun.generationId !== generation._id) return [];\n      if (candidateRun)")]),
 "failed-run-filter": ("convex/generations.ts", [(
   "        return runStatus.get(key) !== \"failed\";",
   "        return key !== \"\" || runStatus.get(key) !== \"failed\"; // mutation: failed filter neutralized")]),
 "duplicate-unique": ("convex/complianceNotes.ts", [(
   "    .first();\n  return run?._id;",
   "    .unique();\n  return run?._id;")]),
 "duplicate-last-match": ("convex/complianceNotes.ts", [(
   "    .first();\n  return run?._id;",
   "    .order(\"desc\")\n    .first();\n  return run?._id;")]),
 # Gap B
 "no-same-key-adoption": ("convex/generations.ts", [(
   "    if (reusable) {\n      await ctx.db.patch(args.generationId, { briefId: reusable._id });",
   "    if (false as boolean && reusable) {\n      await ctx.db.patch(args.generationId, { briefId: reusable._id });")]),
 "fence-before-adoption": ("convex/generations.ts", [(
   "  handler: async (ctx, args) => {\n    const reusable = await latestBriefForInputs(",
   "  handler: async (ctx, args) => {\n    const earlyNewest = await newestProjectBrief(ctx, args.projectId);\n    if ((earlyNewest?._id ?? null) !== args.baselineBriefId) return null;\n    const reusable = await latestBriefForInputs(")]),
 "oldest-same-key-adopted": ("convex/generations.ts", [(
   "    const reusable = await latestBriefForInputs(\n      ctx,\n      args.projectId,\n      args.inputsHash\n    );",
   "    const reusable = await ctx.db\n      .query(\"generationBriefs\")\n      .withIndex(\"by_projectId_and_inputsHash\", (q) =>\n        q.eq(\"projectId\", args.projectId).eq(\"inputsHash\", args.inputsHash)\n      )\n      .order(\"asc\")\n      .first();")]),
 "adoption-without-stamp": ("convex/generations.ts", [(
   "    if (reusable) {\n      await ctx.db.patch(args.generationId, { briefId: reusable._id });\n      return reusable._id;",
   "    if (reusable) {\n      return reusable._id;")]),
}
name = sys.argv[1]
path, reps = MUT[name]
p = pathlib.Path(path); s = p.read_text()
for old, new in reps:
    n = s.count(old)
    if n != 1: sys.exit(f"{name}: expected 1 match, found {n}: {old[:60]!r}")
    s = s.replace(old, new)
p.write_text(s)
print(path)
