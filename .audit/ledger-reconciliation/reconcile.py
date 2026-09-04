#!/usr/bin/env python3
"""Read exact Git objects; write review-only artifacts inside this audit directory.

Fresh heads: python3 reconcile.py --repo /path/to/repo
Replay: python3 reconcile.py --repo /path/to/repo --manifest RUN/manifest.json
No installation, application, ledger status transitions, or native sweep occurs.
"""
import argparse
import collections
import csv
import datetime
import hashlib
import json
import pathlib
import re
import subprocess

BRANCHES = ['main', 'sprint2-boundary'] + [
    'lane/spec-ai-engine-sprint-2-boundary/' + lane
    for lane in ('qa', 'schema', 'pipeline', 'chatspend')
] + ['sprint2-learn-chat']
LEDGER = '_bmad-output/implementation-artifacts/deferred-work.md'
ROOT = pathlib.Path(__file__).resolve().parent


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args]).decode()


def parse(raw, *, source_snapshot=False):
    # Fail closed on input outside the observed canonical grammar. Do not guess
    # at fenced examples, legacy blocks, extra headings, or duplicate fields.
    matches = list(re.finditer(r'^### DW-(\d+): (.*)$', raw, re.M))
    assert matches and not raw[:matches[0].start()].strip(), 'unexpected preamble'
    entries = []
    for i, match in enumerate(matches):
        block = raw[match.start():matches[i+1].start() if i+1 < len(matches) else len(raw)]
        lines = block.splitlines()
        fields = collections.defaultdict(list)
        for line in lines[1:]:
            if not line.strip():
                continue
            field = re.fullmatch(r'([a-z][a-z_-]*): (.*)', line)
            assert field, 'unsupported ledger line: ' + line
            fields[field[1]].append(field[2])
        for key in ('origin', 'source_spec'):
            assert len(fields[key]) == 1, 'missing/duplicate ' + key
        assert len(fields['status']) == 1 or (source_snapshot and not fields['status']), 'missing/duplicate status'
        normalized = re.sub(r'^### DW-\d+:', '### DW-ID:', block.rstrip())
        entries.append(dict(source_occurrence=i+1, old_id='DW-'+match[1], title=match[2], block=block,
                            normalized=normalized, fingerprint=digest(normalized), fields=dict(fields)))
    if not source_snapshot:
        assert len({e['old_id'] for e in entries}) == len(entries), 'duplicate IDs inside source'
    assert ''.join(e['block'] for e in entries) == raw, 'source bytes not partitioned'
    return entries


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False)+'\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=pathlib.Path, required=True)
    parser.add_argument('--manifest', type=pathlib.Path)
    args = parser.parse_args()
    if args.manifest:
        manifest = json.loads(args.manifest.read_text())
        assert [s['branch'] for s in manifest['sources']] == BRANCHES
    else:
        manifest = {'created_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'ledger_path': LEDGER, 'sources': [
                        {'branch': branch, 'sha': git(args.repo, 'rev-parse', branch+'^{commit}').strip()}
                        for branch in BRANCHES]}
    assert manifest['ledger_path'] == LEDGER
    for source in manifest['sources']:
        assert re.fullmatch(r'[0-9a-f]{40}', source['sha'])
    run_key = digest(json.dumps(manifest, sort_keys=True))[:12]
    out = ROOT / ('preview-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '-' + run_key)
    out.mkdir()
    write_json(out/'manifest.json', manifest)
    occurrences = []
    for source in manifest['sources']:
        raw = git(args.repo, 'show', source['sha']+':'+LEDGER)
        snapshot = source['branch'].replace('/', '__')+'.md'
        (out/snapshot).write_text(raw)
        source['snapshot'] = snapshot
        source['ledger_sha256'] = digest(raw)
        entries = parse(raw, source_snapshot=True)
        source['entry_count'] = len(entries)
        occurrences.extend(dict(e, branch=source['branch'], sha=source['sha']) for e in entries)
    write_json(out/'manifest.json', manifest)
    # Source merges can damage metadata. Restore only a missing status whose
    # complete remaining body exactly matches a unique, intact source record.
    # Duplicate source IDs are retained as separate source occurrences; origin
    # and complete content, never a collided numeric ID, determine identity.
    source_damage = []
    for entry in occurrences:
        if entry['fields']['status']:
            continue
        body_without_status = lambda e: re.sub(r'^status: .*\n?', '', e['normalized'], flags=re.M).rstrip()
        candidates = [e for e in occurrences if e['fields']['status'] and body_without_status(e) == entry['normalized'].rstrip()]
        assert candidates, 'missing status has no exact intact source witness'
        assert len({e['fingerprint'] for e in candidates}) == 1, 'missing status has conflicting source witnesses'
        witness = candidates[0]
        original = dict(entry)
        restored_block = re.sub(r'^### DW-\d+:', '### '+entry['old_id']+':', witness['block'])
        restored = parse(restored_block)[0]
        for key in ('block', 'normalized', 'fingerprint', 'fields'):
            entry[key] = restored[key]
        source_damage.append(dict(kind='restore-missing-status-from-exact-intact-source', original=original,
                                  restored_status=entry['fields']['status'][0], witness={k:witness[k] for k in ('branch','sha','old_id','source_occurrence','fingerprint')}))
    for source in manifest['sources']:
        counts = collections.Counter(e['old_id'] for e in occurrences if e['branch']==source['branch'])
        for old_id, count in counts.items():
            if count > 1:
                source_damage.append(dict(kind='numeric-ID-collision-in-source', branch=source['branch'], sha=source['sha'], old_id=old_id, occurrences=count))
    write_json(out/'source-damage-repairs.json', source_damage)
    main_entries = [e for e in occurrences if e['branch'] == 'main']
    assert {f'DW-{n}' for n in range(1,23)} <= {e['old_id'] for e in main_entries}
    # Main entries are first and remain byte-for-byte intact. Exact content only
    # is coalesced, with every occurrence retained in the explicit map.
    canonical, by_fingerprint, used = [], {}, set()
    next_id = max(int(e['old_id'][3:]) for e in occurrences) + 1
    for entry in occurrences:
        fingerprint = entry['fingerprint']
        if fingerprint not in by_fingerprint:
            new_id = entry['old_id']
            if new_id in used:
                while 'DW-'+str(next_id) in used:
                    next_id += 1
                new_id = 'DW-'+str(next_id)
                next_id += 1
            used.add(new_id)
            result = dict(entry, new_id=new_id)
            canonical.append(result)
            by_fingerprint[fingerprint] = result
        entry['new_id'] = by_fingerprint[fingerprint]['new_id']
    merged = ''.join(re.sub(r'^### DW-\d+:', '### '+e['new_id']+':', e['block'])
                     + ('' if e['block'].endswith('\n\n') else '\n\n') for e in canonical)
    (out/'deferred-work.preview.md').write_text(merged)
    reparsed = parse(merged)
    assert {e['fingerprint'] for e in occurrences} == {e['fingerprint'] for e in reparsed}
    result_by_id = {e['old_id']: e for e in reparsed}
    for entry in occurrences:
        result = result_by_id[entry['new_id']]
        assert entry['normalized'] == result['normalized'], 'facts/content lost'
        assert entry['fields'] == result['fields'], 'field/status/gate loss'
    main_raw = (out/'main.md').read_text()
    assert merged.startswith(main_raw), 'main ledger bytes changed'
    assert all(e['old_id'] == e['new_id'] for e in occurrences if e['branch'] == 'main')
    columns = ['branch','sha','source_occurrence','old_id','new_id','fingerprint','origin','source_spec','status']
    with (out/'mapping.tsv').open('w') as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, delimiter='\t')
        writer.writeheader()
        for entry in occurrences:
            row = {k:entry[k] for k in columns[:6]}
            row.update({k:entry['fields'][k][0] for k in columns[6:]})
            writer.writerow(row)
    write_json(out/'entries.json', occurrences)
    identity_groups, substance_groups = collections.defaultdict(list), collections.defaultdict(list)
    for entry in canonical:
        identity = (entry['fields']['origin'][0], entry['fields']['source_spec'][0])
        identity_groups[identity].append(entry)
        substance = re.sub(r'^origin: .*\n', '', entry['normalized']+'\n', flags=re.M)
        substance_groups[digest(substance)].append(entry)
    summary_entry = lambda e: {k:e[k] for k in ('new_id','old_id','branch','sha','fingerprint','title','fields')}
    variants = [{'origin':key[0], 'source_spec':key[1], 'variants':[summary_entry(e) for e in entries]}
                for key, entries in identity_groups.items() if len(entries)>1]
    aliases = [[summary_entry(e) for e in entries] for entries in substance_groups.values() if len(entries)>1]
    write_json(out/'content-variants-requiring-review.json', variants)
    write_json(out/'distinct-origin-alias-candidates.json', aliases)
    # Suggest only; never edit a spec or historical log. Scope active specs by
    # their recorded status. Done specs and logs remain historical references.
    references, historical = [], []
    for source in manifest['sources']:
        branch_options = collections.defaultdict(set)
        for e in occurrences:
            if e['branch']==source['branch']:
                branch_options[e['old_id']].add(e['new_id'])
        branch_map = {old_id:next(iter(ids)) if len(ids)==1 else None for old_id,ids in branch_options.items()}
        files = git(args.repo, 'ls-tree', '-r', '--name-only', source['sha'], '_bmad-output').splitlines()
        for file in files:
            if not file.endswith(('.md','.yaml','.yml')) or file == LEDGER:
                continue
            content = git(args.repo, 'show', source['sha']+':'+file)
            if not re.search(r'\bDW-\d+\b', content):
                continue
            frontmatter = re.match(r'\A---\s*\n(.*?)\n---\s*(?:\n|$)', content, re.S)
            status_match = re.search(r'^status:\s*[\'\"]?([a-z-]+)', frontmatter[1], re.M) if frontmatter else None
            status = status_match[1] if status_match else None
            active = status in ('draft','ready-for-dev','in-progress','in-review','blocked')
            manifest_candidate = pathlib.PurePosixPath(file).name == 'stories.yaml'
            for line_number, line in enumerate(content.splitlines(), 1):
                for old_id in dict.fromkeys(re.findall(r'\bDW-\d+\b', line)):
                    new_id = branch_map.get(old_id)
                    if new_id == old_id:
                        continue
                    row = dict(branch=source['branch'], sha=source['sha'], path=file,
                               line=line_number, status=status, old_id=old_id, new_id=new_id,
                               text=line, action='review contextual reference; do not blindly replace')
                    if active or manifest_candidate:
                        references.append(row)
                    else:
                        historical.append(row)
    write_json(out/'active-reference-rewrite-suggestions.json', references)
    write_json(out/'historical-references-immutable.json', historical)
    counts = dict(sources=len(manifest['sources']), occurrences=len(occurrences),
                  canonical_entries=len(canonical), exact_copies_deduplicated=len(occurrences)-len(canonical),
                  remapped_occurrences=sum(e['old_id']!=e['new_id'] for e in occurrences),
                  main_entries_preserved=len(main_entries), main_stable_ids='DW-1 through DW-22',
                  content_variant_groups=len(variants), distinct_origin_alias_groups=len(aliases),
                  explicit_source_damage_repairs=len(source_damage),
                  active_reference_suggestions=len(references), historical_references_preserved=len(historical),
                  statuses=dict(collections.Counter(e['fields']['status'][0] for e in canonical)),
                  assertions='PASS: all occurrence content, fields, status, origin, source, and gate lines preserved; main bytes intact')
    write_json(out/'proof.json', counts)
    (out/'README.md').write_text('# Reconciliation preview only\n\n'
        'Prepared with bmad-help. Installed [ST] Sweep Triage is automation-only; use the native sweep only after final integration. No sweep or ledger application was performed.\n\n'
        'Each source is read using the exact commit in manifest.json. Re-run the utility without --manifest to snapshot final heads. Use --manifest to replay these commits. Mapping IDs may change when final heads change; review the final mapping before any application.\n\n'
        'Main entries remain byte-for-byte intact. Exact copies ignoring only heading ID and trailing blank space are coalesced; every branch/SHA/old ID is retained in mapping.tsv and entries.json. Numeric collisions receive IDs above the highest source ID. Distinct origins remain separate canonical entries because native harvesting dedupes origin plus source_spec. Identical substance with distinct origins is separately flagged for explicit native-supported alias treatment.\n\n'
        'Source damage is recorded with original bytes and exact intact source witnesses in source-damage-repairs.json; only a missing status with one unambiguous full-body match is restored. Duplicate source IDs are tracked by source_occurrence and remapped. Content variants sharing origin/source remain separate, unmodified entries and require human judgment before application. The preview must not be fed to native sweep while such conflicts remain undecided. Historical references are immutable. Active reference suggestions are contextual review candidates, never automatic global replacements. Unknown-format input aborts rather than guessing.\n\n'
        'Proof:\n\n```json\n'+json.dumps(counts,indent=2)+'\n```\n')
    print(json.dumps(dict(output=str(out), proof=counts), indent=2))


if __name__ == '__main__':
    main()
