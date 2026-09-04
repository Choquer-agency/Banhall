#!/usr/bin/env python3
"""Reproduce static DW42 documentation checks; no runtime tests are implied."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE = 'b99f1eeef78348df5c14f68031f7f0276527ff3f'
FIRST = '453a4c585e9f84e83aaa1f97d860c0f9680aaa53'
SPEC = '_bmad-output/implementation-artifacts/spec-dw42-privacy-contract.md'
STORY = '_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/2-de-identification-before-firm-wide-knowledge.md'
ALLOWED = {
    'docs/product-domain.md', 'docs/the-brain.md', SPEC,
    '.audit/DW42/evidence.md', '.audit/DW42/decisions.tsv',
    '.audit/DW42/verify.py', '.audit/DW42/review.md',
}
PROMPTS = {f'_bmad-output/implementation-artifacts/dw42-review-prompts/{kind}.md'
           for kind in ('blind-hunter', 'edge-case-hunter', 'verification-gap')}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def read(path):
    return (ROOT / path).read_text()


def frozen(text):
    return re.search(r'<frozen-after-approval.*?</frozen-after-approval>', text, re.S).group()


domain, brain = read('docs/product-domain.md'), read('docs/the-brain.md')
assert 'privacyReviewed' not in git('show', BASE + ':docs/product-domain.md')
assert 'deidentify' not in git('show', BASE + ':docs/the-brain.md')
for doc in (domain, brain):
    assert 'privacyReviewed: true' in doc and 'digestId: null' in doc
assert 'Every project-record identifier string is trimmed' in domain
assert 'Email and phone patterns are applied separately' in domain
assert 'production retrieval of approved sources' in brain
assert 'does not backfill' in brain and 'writer-feedback import' in brain
assert 'proposalWordingEditEvents' in domain and 'raw stored' in domain
assert "story 4's mixed-stream" not in domain
assert frozen(read(SPEC)) == frozen(git('show', FIRST + ':' + SPEC))
assert git('hash-object', STORY) == git('rev-parse', BASE + ':' + STORY) == '070de74cb34c7d9fab7276964d1bf9eeabd7fbcb'

heading = re.search(r'^### (2026-09-04: Privacy.*)$', domain, re.M).group(1)
anchor = re.sub('[^a-z0-9 -]', '', heading.lower()).replace(' ', '-')
assert f'(product-domain.md#{anchor})' in brain
for path in ('docs/product-domain.md', 'docs/the-brain.md', SPEC):
    # Restrict to newly relevant references; legacy document links are out of scope.
    for target in re.findall(r'\]\(([^)]+)\)', read(path)):
        if 'spec-ai-engine-sprint-2-learn-chat' in target or '.audit/DW42' in target:
            assert (ROOT / path).parent.joinpath(target.split('#')[0]).is_file(), target

changed = set(git('diff', BASE, '--name-only').splitlines())
untracked = set(git('ls-files', '--others', '--exclude-standard').splitlines())
assert changed <= ALLOWED, changed - ALLOWED
assert untracked <= ALLOWED | PROMPTS, untracked - ALLOWED - PROMPTS
assert changed | (untracked & ALLOWED) == ALLOWED
assert all((ROOT / path).is_file() for path in ALLOWED)
# Ignored runtime/workflow directories are intentionally outside this Git scope check.
git('diff', BASE, '--check')
added = [line[1:] for line in git('diff', BASE, '--', 'docs/product-domain.md', 'docs/the-brain.md').splitlines()
         if line.startswith('+') and not line.startswith('+++')]
assert all('\u2014' not in line for line in added)
print('PASS: baseline omission, final documentation boundaries, links, story identity and frozen intent.')
print('PASS: complete baseline-to-working-candidate tracked/staged changes plus new files match seven-file repair allowlist.')
print('Review prompt files outside candidate:', ', '.join(sorted(untracked & PROMPTS)) or 'none')
print('PASS: whitespace and added-prose checks. Static verification only; no runtime tests executed.')
