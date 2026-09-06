"""Read-only B10 policy comparison. Prints JSON; writes no files."""
from pathlib import Path
import hashlib, json, difflib, sys
root = Path(__file__).resolve().parent
baseline = (root / "policy-audit-baseline.md").read_bytes()
original = (root / "policy-audit-historical-amendment.md").read_bytes()
manifest = json.loads((root / "policy-audit-manifest.json").read_text())
candidate = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("docs/product-domain.md")
actual = candidate.read_bytes()
heading = original.splitlines(keepends=True)[0]
marker = b"## Amendment process\n"
def sha(value): return hashlib.sha256(value).hexdigest()
result = {"candidate": str(candidate), "candidate_sha256": sha(actual), "baseline_sha256": sha(baseline), "baseline_receipt_intact": sha(baseline) == manifest["baseline_sha256"], "amendment_receipt_intact": sha(original) == manifest["amendment_sha256"], "heading_count": actual.count(heading), "amendment_process_count": actual.count(marker)}
if actual.count(heading) == 1 and actual.count(marker) == 1:
    start, end = actual.index(heading), actual.index(marker)
    if start < end:
        inserted = actual[start:end]
        restored = actual[:start] + actual[end:]
        result.update({"all_existing_policy_bytes_preserved": restored == baseline, "exact_historical_amendment": inserted == original, "inserted_sha256": sha(inserted), "insert_start_line": actual[:start].count(b"\n") + 1, "historical_amendment_diff": list(difflib.unified_diff(original.decode().splitlines(), inserted.decode().splitlines(), fromfile="historical amendment", tofile="candidate amendment", lineterm="")), "existing_policy_diff": list(difflib.unified_diff(baseline.decode().splitlines(), restored.decode().splitlines(), fromfile="baseline policy", tofile="candidate minus amendment", lineterm=""))})
result["strict_pass"] = all(result.get(k) is True for k in ["baseline_receipt_intact", "amendment_receipt_intact", "all_existing_policy_bytes_preserved", "exact_historical_amendment"])
print(json.dumps(result, indent=2))
sys.exit(0 if result["strict_pass"] else 1)
