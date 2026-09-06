#!/usr/bin/env python3
"""Verify archive manifests from immutable Git bytes. Exit 0 valid, 1 invalid, 2 operational error."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import zlib


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('target_sha', help='Full immutable commit object ID')
    ap.add_argument('--output', type=Path)
    args = ap.parse_args()
    repo = Path(__file__).resolve().parents[3]
    report = {'targetInput': args.target_sha, 'manifests': [], 'issues': [],
              'recordsChecked': 0, 'identicalDuplicateRecords': [],
              'scope': 'Committed objects only; no index or working-file evidence.'}
    operational = False

    def issue(kind, **details):
        report['issues'].append({'kind': kind, **details})

    def git(*argv):
        nonlocal operational
        p = subprocess.run(['git', *argv], cwd=repo, capture_output=True)
        if p.returncode:
            operational = True
            issue('git_read_error', argv=list(argv), exit=p.returncode,
                  stderr=p.stderr.decode('utf-8', 'replace'))
            return None
        return p.stdout

    def json_unique(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError('Duplicate JSON key: '+key)
            obj[key] = value
        return obj

    def valid_path(value):
        return (isinstance(value, str) and bool(value) and '\x00' not in value
                and not value.startswith('/') and '\\' not in value
                and all(x not in ('', '.', '..') for x in value.split('/')))

    try:
        if not re.fullmatch(r'[0-9a-fA-F]{40}|[0-9a-fA-F]{64}', args.target_sha):
            raise ValueError('target_sha must be a full immutable commit object ID')
        sha = args.target_sha.lower()
        kind = git('cat-file', '-t', sha)
        if kind != b'commit\n':
            raise ValueError('Target is not a readable commit object')
        report['target'] = sha
        rawtree = git('ls-tree', '-r', '-z', sha)
        if rawtree is None:
            raise ValueError('Cannot inventory committed tree')
        tree = {}
        for entry in rawtree.split(b'\0'):
            if not entry:
                continue
            metadata, rawpath = entry.split(b'\t', 1)
            mode, objtype, oid = metadata.decode('ascii').split()
            path = rawpath.decode('utf-8', 'surrogateescape')
            tree[path] = (mode, objtype, oid)

        def read(path, context):
            if path not in tree:
                issue('missing_committed_path', path=path, **context)
                return None
            mode, typ, oid = tree[path]
            if typ != 'blob' or mode not in ('100644', '100755'):
                issue('invalid_file_type', path=path, mode=mode, objectType=typ, **context)
                return None
            return git('cat-file', 'blob', oid)

        manifests = sorted(p for p in tree if p.startswith('.audit/branch-consolidation/')
                           and p.endswith('/archive-manifest.json'))
        report['manifestCount'] = len(manifests)
        if not manifests:
            issue('no_committed_archive_manifests')
        by_original, by_stored = {}, {}
        for manifest in manifests:
            raw = read(manifest, {'manifest': manifest})
            if raw is None:
                continue
            summary = {'path': manifest, 'sha256': hashlib.sha256(raw).hexdigest()}
            report['manifests'].append(summary)
            try:
                doc = json.loads(raw, object_pairs_hook=json_unique)
                if not isinstance(doc, dict) or not isinstance(doc.get('files'), list):
                    raise ValueError('Manifest must be an object with a files array')
            except (ValueError, UnicodeError) as exc:
                issue('invalid_manifest', manifest=manifest, reason=str(exc))
                continue
            summary['records'] = len(doc['files'])
            for index, row in enumerate(doc['files']):
                ctx = {'manifest': manifest, 'recordIndex': index}
                if not isinstance(row, dict):
                    issue('invalid_record', **ctx, reason='Record must be an object')
                    continue
                required = ('original_path', 'stored_path', 'original_sha256', 'stored_sha256', 'encoding')
                if any(key not in row for key in required):
                    issue('invalid_record', **ctx, reason='Missing required fields')
                    continue
                if not all(valid_path(row[key]) for key in ('original_path', 'stored_path')):
                    issue('invalid_record', **ctx, reason='Unsafe or noncanonical repository-relative path')
                    continue
                if not all(isinstance(row[key], str) and re.fullmatch('[0-9a-f]{64}', row[key])
                           for key in ('original_sha256', 'stored_sha256')):
                    issue('invalid_record', **ctx, reason='SHA256 must be 64 lowercase hex digits')
                    continue
                if row['encoding'] not in ('identity', 'gzip'):
                    issue('invalid_encoding', **ctx, encoding=row['encoding'])
                    continue
                signature = tuple(row[key] for key in required)
                for field, seen in (('original_path', by_original), ('stored_path', by_stored)):
                    key = row[field]
                    if key in seen:
                        prior_sig, prior_ctx = seen[key]
                        if signature != prior_sig:
                            issue('conflicting_duplicate', **ctx, field=field, path=key,
                                  prior=prior_ctx, priorRecord=dict(zip(required, prior_sig)), currentRecord=row)
                        else:
                            report['identicalDuplicateRecords'].append({**ctx, 'field':field,
                                                                        'path':key, 'prior':prior_ctx})
                    else:
                        seen[key] = (signature, ctx)
                payload = read(row['stored_path'], ctx)
                if payload is None:
                    continue
                report['recordsChecked'] += 1
                actual = hashlib.sha256(payload).hexdigest()
                if actual != row['stored_sha256']:
                    issue('stored_hash_mismatch', **ctx, path=row['stored_path'],
                          expected=row['stored_sha256'], actual=actual)
                try:
                    original = gzip.decompress(payload) if row['encoding'] == 'gzip' else payload
                except (OSError, EOFError, ValueError, zlib.error) as exc:
                    issue('gzip_decode_error', **ctx, path=row['stored_path'], reason=str(exc))
                    continue
                actual = hashlib.sha256(original).hexdigest()
                if actual != row['original_sha256']:
                    issue('original_hash_mismatch', **ctx, originalPath=row['original_path'],
                          storedPath=row['stored_path'], expected=row['original_sha256'], actual=actual)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        operational = True
        issue('verification_error', reason=str(exc))
    code = 2 if operational else 1 if report['issues'] else 0
    report['exitCode'] = code
    report['status'] = {0:'valid_committed_archives',1:'invalid_committed_archives',2:'verification_error'}[code]
    text = json.dumps(report, indent=2) + '\n'
    print(text, end='')
    if args.output:
        try:
            args.output.write_text(text)
        except OSError as exc:
            print(str(exc), file=sys.stderr)
            return 2
    return code


if __name__ == '__main__':
    sys.exit(main())
