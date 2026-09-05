import { defineConfig, mergeConfig } from "vitest/config";
import canonical from "../../vitest.config";

// Deliberate audit control only: change the loaded outcome cohort in memory.
// The production file and canonical configuration remain unchanged on disk.
export default mergeConfig(canonical, defineConfig({
  plugins: [{
    name: "dw99-wrong-outcome-order-control",
    enforce: "pre",
    transform(code, id) {
      if (!id.endsWith("/convex/learningHealth.ts")) return;
      const actual = 'q => q.gte("observedAt", start).lte("observedAt", end)).order("asc")';
      if (code.split(actual).length !== 2) throw new Error("Expected exactly one outcome-order control target");
      return code.replace(actual, actual.replace('order("asc")', 'order("desc")'));
    },
  }],
}));
