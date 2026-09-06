#!/usr/bin/env python3
"""Read-only captured-history verification; exit 0 complete, 1 missing, 2 error."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target_ref')
    parser.add_argument('required_integration_sha')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    audit = Path(__file__).resolve().parent.parent
    repo = audit.parent.parent
    result = {'targetInput': args.target_ref, 'requiredIntegrationInput': args.required_integration_sha,
              'refDrift': [], 'newlyObservedRefs': [], 'excludedSymbolicRefs': [],
              'capturedChecks': [], 'plannedParents': [], 'errors': [],
              'scope': 'Committed ancestry only; not content acceptance, CI proof or uncommitted-work integration.'}

    def git(*argv):
        proc = subprocess.run(['git', *argv], cwd=repo, capture_output=True, text=True)
        return proc

    def resolve(ref):
        proc = git('rev-parse', '--verify', ref + '^{commit}')
        if proc.returncode:
            raise RuntimeError(f'Cannot resolve commit {ref}: exit {proc.returncode}: {proc.stderr.strip()}')
        return proc.stdout.strip()

    def ancestor(sha, target):
        proc = git('merge-base', '--is-ancestor', sha, target)
        if proc.returncode not in (0, 1):
            result['errors'].append({'operation': 'merge-base --is-ancestor', 'sha': sha,
                                     'target': target, 'exit': proc.returncode, 'stderr': proc.stderr.strip()})
            return None
        return proc.returncode == 0

    try:
        captured = json.loads((audit / 'initial-refs.json').read_text())
        plan = json.loads((audit / 'ancestry-plan.json').read_text())
        if len(captured['refs']) != 81 or len(plan['plannedParents']) != 20:
            raise ValueError('Expected original 81-ref capture and 20-parent plan; review changed inputs.')
        target = resolve(args.target_ref)
        required = resolve(args.required_integration_sha)
        result.update(target=target, requiredIntegration=required,
                      capturedCount=len(captured['refs']), plannedParentCount=len(plan['plannedParents']))
        # One inventory avoids treating Git failures as absent refs.
        inventory = git('for-each-ref', '--format=%(refname) %(objectname) %(symref)',
                        'refs/heads', 'refs/remotes')
        if inventory.returncode:
            raise RuntimeError(f'Ref inventory failed: exit {inventory.returncode}: {inventory.stderr.strip()}')
        live = {}
        captured_names = {row['ref'] for row in captured['refs']}
        for line in inventory.stdout.splitlines():
            ref, sha, symbolic = line.split(' ', 2)
            live[ref] = sha
            if symbolic:
                result['excludedSymbolicRefs'].append({'ref': ref, 'sha': sha, 'symbolicTarget': symbolic})
            elif ref not in captured_names:
                result['newlyObservedRefs'].append({'ref': ref, 'sha': sha,
                                                   'ancestor': ancestor(sha, target)})
        for row in captured['refs']:
            current = live.get(row['ref'])
            if current != row['sha']:
                result['refDrift'].append({'ref': row['ref'], 'captured': row['sha'], 'current': current})
            result['capturedChecks'].append({'ref': row['ref'], 'sha': row['sha'],
                                             'ancestor': ancestor(row['sha'], target)})
        for row in plan['plannedParents']:
            result['plannedParents'].append({'id': row['id'], 'sha': row['tip'],
                                             'ancestor': ancestor(row['tip'], target)})
        result['baseline'] = captured['baseline']
        result['baselineAncestor'] = ancestor(captured['baseline'], target)
        result['requiredIntegrationAncestor'] = ancestor(required, target)
        result['capturedMissing'] = [row for row in result['capturedChecks'] if row['ancestor'] is False]
        result['plannedParentsMissing'] = [row for row in result['plannedParents'] if row['ancestor'] is False]
        complete = (not result['capturedMissing'] and not result['plannedParentsMissing']
                    and result['baselineAncestor'] is True and result['requiredIntegrationAncestor'] is True)
        result['ancestryComplete'] = complete and not result['errors']
        result['refDriftRequiresReview'] = bool(result['refDrift'])
        result['newRefDispositionsRequired'] = bool(result['newlyObservedRefs'])
        result['allBranchesDispositionEstablished'] = False
        result['newRefDispositionNote'] = ('Ancestry completeness covers the captured 81 refs and 20 parents. '
            'New refs require explicit parent disposition, including the expected integration branch; '
            'ancestry alone does not establish content acceptance or an all-branches claim.')
        code = 2 if result['errors'] else 0 if complete else 1
    except (OSError, ValueError, KeyError, TypeError, RuntimeError) as exc:
        result['errors'].append({'message': str(exc)})
        result['ancestryComplete'] = False
        code = 2
    result['exitCode'] = code
    result['status'] = {0: 'ancestry_complete', 1: 'ancestry_incomplete', 2: 'verification_error'}[code]
    serialized = json.dumps(result, indent=2) + '\n'
    print(serialized, end='')
    if args.output:
        try:
            args.output.write_text(serialized)
        except OSError as exc:
            print(f'Cannot write output: {exc}', file=sys.stderr)
            return 2
    return code


if __name__ == '__main__':
    sys.exit(main())
