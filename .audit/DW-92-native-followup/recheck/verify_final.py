"""Verify this pass against actual files; never mutate orchestrator artifacts."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
AUDIT = Path(__file__).resolve().parent
SPEC = '_bmad-output/implementation-artifacts/spec-dw-92-blocking-qa-native-followup.md'
BASELINE = '9da55bece5948da12129720dd2330a3032c985bf'
PROTECTED = ['src', 'convex/_generated', 'convex/learning.ts', 'convex/ai/learning.ts', 'convex/brain.ts', '_bmad-output/specs/spec-ai-engine-sprint-2-boundary/lanes/qa/stories/8-blocking-qa-policy.md']

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def require(condition, message):
    if not condition:
        raise SystemExit(message)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

require(not git('diff', '--name-only', BASELINE, '--', *PROTECTED).strip(), 'Protected tracked files changed')
require(not git('ls-files', '--others', '--', *PROTECTED).strip(), 'Untracked protected files found')
for path, expected in json.loads((AUDIT / 'protected-start.json').read_text()).items():
    require(digest(ROOT / path) == expected, 'Orchestrator-owned file changed since invocation: ' + path)
start = json.loads((AUDIT / 'start.json').read_text())
source = ['convex', 'src', 'shared', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts', 'svelte.config.js', 'vite.config.ts']
require(not git('diff', start['revision'], '--', *source).strip(), 'Tested source differs from entry commit')
require(not git('ls-files', '--others', '--exclude-standard', '--', *source).strip(), 'Untracked runtime inputs found')
for path, expected in json.loads((AUDIT.parent / 'verified-source.json').read_text())['file_sha256'].items():
    require(digest(ROOT / path) == expected, 'Previously repaired source changed: ' + path)
manifest = json.loads((AUDIT / 'final-command-manifest.json').read_text())
require(len(manifest) == 3, 'Incomplete command manifest')
for record in manifest:
    require(record['exit_code'] == 0 and record['head'] == start['revision'], 'Command failed or revision mismatch')
log_hashes = {record['log']: digest(AUDIT / record['log']) for record in manifest}
attestation_path = AUDIT / 'log-sha256.json'
if attestation_path.exists():
    require(json.loads(attestation_path.read_text()) == log_hashes, 'Retained command output changed')
else:
    attestation_path.write_text(json.dumps(log_hashes, indent=2) + '\n')
spec = (ROOT / SPEC).read_text()
require(spec.count('\n## Auto Run Result\n') == 1, 'Missing or duplicate terminal result')
result = spec.split('\n## Auto Run Result\n')[1]
status = "blocked" if "status: 'blocked'" in spec.split("---", 2)[1] else "done"
require(f"status: '{status}'" in spec.split("---", 2)[1], "Invalid terminal status")
if status == "blocked":
    require("Blocking condition: finalization left repository dirty" in result, "Missing finalization blocker")
for value in [f'Status: {status}', 'Files changed:', 'Review:', 'Verification:', 'Residual risks:']:
    require(value in result, 'Required terminal field absent: ' + value)
print(json.dumps({'head': git('rev-parse', 'HEAD').decode().strip(), 'source_revision': start['revision'], 'protected_files_unchanged': True, 'orchestrator_files_match_invocation': True, 'source_matches_verified_commit': True, 'terminal_result_valid': True, 'logs_sha256': log_hashes}, indent=2))
