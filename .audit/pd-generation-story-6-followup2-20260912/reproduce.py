"""Reproduce an expected regression failure without replacing tracked source.

Run from the repository root: python3 <this-file> count|ui|backend.
The command exits with Vitest's status; a reproduced regression exits nonzero.
"""
import json
from pathlib import Path
import subprocess
import sys

mode = sys.argv[1]
root = Path.cwd()
prior = "a953bff56b1457989a0a8998a5543c56ef0a2136"
current = "3cb793348d4e17a8ca506c77d5186b48615c35d7"
choices = {
    "count": (current, "src/routes/admin/comparisons/+page.svelte", "vitest.component.config.ts", "src/routes/admin/comparisons/comparisonsRecord.component.test.ts", "fractional count text"),
    "ui": (prior, "src/routes/admin/comparisons/+page.svelte", "vitest.component.config.ts", "src/routes/admin/comparisons/comparisonsRecord.component.test.ts", "warns on replacement|withholds each metric verdict"),
    "backend": (prior, "convex/comparisons.ts", "vitest.config.ts", "convex/comparisons.test.ts", "exactly 500|large project and financial|large distinct judge"),
}
revision, source, base, test, pattern = choices[mode]
assert subprocess.check_output(["git", "rev-parse", revision], text=True).strip() == revision
original = subprocess.check_output(["git", "show", f"{revision}:{source}"])
folder = root / ".vitest-attachments/story-6-reproduce" / mode
folder.mkdir(parents=True, exist_ok=True)
original_path = folder / "original.txt"
original_path.write_bytes(original)
config = folder / "red.config.ts"
config.write_text('''import { defineConfig, mergeConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import base from BASE;
export default mergeConfig(base, defineConfig({
  cacheDir: CACHE,
  plugins: [{ name: "story-6-original", enforce: "pre", load(id) {
    if (id === SOURCE) return readFileSync(ORIGINAL, "utf8");
  }}],
}));
'''.replace("BASE", json.dumps(str(root / base)))
   .replace("CACHE", json.dumps(str(folder / "optimizer")))
   .replace("SOURCE", json.dumps(str(root / source)))
   .replace("ORIGINAL", json.dumps(str(original_path))))
raise SystemExit(subprocess.run(["npx", "vitest", "run", "--config", str(config), test, "-t", pattern], check=False).returncode)
