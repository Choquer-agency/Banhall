"""Run the ordinary required DW-92 commands with attributable raw logs."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
AUDIT = Path(__file__).resolve().parent

def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode().strip()

def now():
    return datetime.now(timezone.utc).isoformat()

records = []
commands = [
    ("final-ordinary-gate.log", ["bash", "scripts/loop-verify.sh"]),
    ("final-focused.log", ["npx", "vitest", "run", "convex/ai/qaChecks.test.ts", "convex/projects.test.ts", "convex/qaBlocking.test.ts"]),
    ("final-convex-tsc.log", ["npx", "tsc", "-p", "convex/tsconfig.json", "--noEmit"]),
]
for filename, command in commands:
    record = {
        "command": command,
        "cwd": str(ROOT),
        "head": git("rev-parse", "HEAD"),
        "working_diff_sha256": hashlib.sha256(subprocess.check_output(["git", "diff", "HEAD"], cwd=ROOT)).hexdigest(),
        "gate_script_sha256": hashlib.sha256((ROOT / "scripts/loop-verify.sh").read_bytes()).hexdigest(),
        "started_at": now(),
        "log": filename,
    }
    print("RUN " + " ".join(command), flush=True)
    with (AUDIT / filename).open("wb") as output:
        completed = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
    record.update(ended_at=now(), exit_code=completed.returncode)
    records.append(record)
    (AUDIT / "final-command-manifest.json").write_text(json.dumps(records, indent=2) + "\n")
    print("EXIT " + str(completed.returncode), flush=True)
    if completed.returncode:
        raise SystemExit(completed.returncode)
