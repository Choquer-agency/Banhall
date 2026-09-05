"""Audit-only capture of the real gate in the root-owned external final clone."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

if sys.flags.optimize:
    raise RuntimeError("Run this audit capture without Python assertion optimization.")
context = json.loads(Path(sys.argv[1]).read_text())
mode = sys.argv[2]
assert mode in ("cold", "component")
checkout = Path(context["checkout"]).resolve()
container = Path(context["container"]).resolve()
evidence = Path(context["evidence"]).resolve()
assert checkout.parent == container and container.name.startswith("banhall-sweep-final-")
assert not (checkout / ".env.local").exists()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=checkout, text=True).strip()


def source_hash():
    return hashlib.sha256((checkout / "scripts/loop-verify.sh").read_bytes()).hexdigest()


assert git("rev-parse", "HEAD") == context["revision"]
assert not git("status", "--porcelain")
environment = os.environ.copy()
for startup_hook in ("BASH_ENV", "ENV", "CDPATH", "SHELLOPTS", "BASHOPTS"):
    environment.pop(startup_hook, None)
environment["CI"] = "1"
environment["FORCE_COLOR"] = "0"
if mode == "cold":
    assert not (checkout / "node_modules").exists()
    environment.pop("PUBLIC_CONVEX_URL", None)
    environment.pop("PUBLIC_CONVEX_SITE_URL", None)
    environment["VERIFY_COMPONENT"] = "0"
    environment["PLAYWRIGHT_BROWSERS_PATH"] = str(container / "absent-browser-cache")
else:
    assert (checkout / "node_modules").is_dir()
    environment["PUBLIC_CONVEX_URL"] = "https://placeholder.convex.cloud"
    environment["PUBLIC_CONVEX_SITE_URL"] = "https://placeholder.convex.site"
    environment["VERIFY_COMPONENT"] = "1"
    environment.pop("PLAYWRIGHT_BROWSERS_PATH", None)

command = ["bash", "scripts/loop-verify.sh"]
log_path = evidence / f"gate-{mode}.log"
report = {"mode": mode, "revision": context["revision"], "command": command,
          "checkout": str(checkout), "sourceSha256": source_hash(),
          "startedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
          "log": str(log_path)}
started = time.monotonic()
interrupted_signal = None


def on_interrupt(signum, _frame):
    global interrupted_signal
    interrupted_signal = signal.Signals(signum).name


signal.signal(signal.SIGINT, on_interrupt)
signal.signal(signal.SIGTERM, on_interrupt)
print(json.dumps({"started": mode, "log": str(log_path)}), flush=True)
with log_path.open("x") as output:
    child = subprocess.Popen(command, cwd=checkout, env=environment,
                             stdin=subprocess.DEVNULL, stdout=output,
                             stderr=subprocess.STDOUT, start_new_session=True)
    report["processGroupId"] = child.pid
    try:
        while True:
            if interrupted_signal or time.monotonic() - started >= 1200:
                report["timedOut"] = not interrupted_signal
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
                report["exitCode"] = child.returncode
                break
            try:
                report["exitCode"] = child.wait(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                pass
    finally:
        # The clone's verification process group is owned by this capture.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

report["durationSeconds"] = round(time.monotonic() - started, 3)
report["interruptedSignal"] = interrupted_signal
output = log_path.read_text()
total = 8 if mode == "cold" else 9
banners = [(int(a), int(b)) for a, b in re.findall(r"^\[(\d+)/(\d+)\]", output, re.M)]
report["stepBanners"] = re.findall(r"^\[\d+/\d+\].*$", output, re.M)
report["suiteSummaries"] = re.findall(r"^.*(?:Test Files|Tests\s+\d+ passed|\d+ passed, 0 failed).*$", output, re.M)
report["trackedStatusAfter"] = git("status", "--porcelain")
report["revisionAfter"] = git("rev-parse", "HEAD")
report["sourceSha256After"] = source_hash()
report["checks"] = {
    "exitZero": report["exitCode"] == 0 and not report.get("timedOut") and not interrupted_signal,
    "allStepsInOrder": banners == [(i, total) for i in range(1, total + 1)],
    "unitCasesObserved": bool(re.search(r"Tests\s+1516 passed", output)),
    "discoveryObserved": "discovered 191 test files" in output,
    "uploaderCasesObserved": "50 passed, 0 failed" in output and "18 passed, 0 failed" in output,
    "sourceUnchanged": not report["trackedStatusAfter"] and report["sourceSha256"] == report["sourceSha256After"] and report["revisionAfter"] == context["revision"],
}
if mode == "cold":
    report["checks"].update({
        "localDependenciesInstalled": (checkout / "node_modules").is_dir() and bool(re.search(r"added \d+ packages", output)),
        "placeholderOrigins": all(f"{key} from placeholder" in output for key in ("PUBLIC_CONVEX_URL", "PUBLIC_CONVEX_SITE_URL")),
        "browserFree": "component suite" not in output and not (container / "absent-browser-cache").exists(),
    })
else:
    report["checks"].update({
        "componentCasesObserved": bool(re.search(r"Tests\s+292 passed", output)),
        "environmentOrigins": all(f"{key} from env" in output for key in ("PUBLIC_CONVEX_URL", "PUBLIC_CONVEX_SITE_URL")),
    })
report["passed"] = all(report["checks"].values())
(evidence / f"gate-{mode}.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2), flush=True)
sys.exit(0 if report["passed"] else 1)
