"""Verify DW-92 protected artifacts and flat result placement against Git."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASELINE = "9da55bece5948da12129720dd2330a3032c985bf"
SPEC = "_bmad-output/implementation-artifacts/spec-dw-92-blocking-qa-native-followup.md"
PROTECTED = [
    "_bmad-output/specs/spec-ai-engine-sprint-2-boundary/lanes/qa/stories/8-blocking-qa-policy.md",
    "_bmad-output/implementation-artifacts/deferred-work.md",
    "src", "convex/_generated",
]

def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)

changed = git("diff", "--name-only", BASELINE, "--", *PROTECTED).decode().splitlines()
assert not changed, changed
for path in PROTECTED[:2]:
    assert (ROOT / path).read_bytes() == git("show", f"{BASELINE}:{path}"), path
spec = (ROOT / SPEC).read_text()
assert (ROOT / SPEC).parent == ROOT / "_bmad-output/implementation-artifacts"
assert f"baseline_revision: '{BASELINE}'" in spec
result = {
    "baseline": git("rev-parse", BASELINE).decode().strip(),
    "head": git("rev-parse", "HEAD").decode().strip(),
    "protected_paths_unchanged": True,
    "original_spec_sha256": hashlib.sha256((ROOT / PROTECTED[0]).read_bytes()).hexdigest(),
    "flat_result_spec": SPEC,
    "auto_run_result_present": "## Auto Run Result\n" in spec,
}
print(json.dumps(result, indent=2))
