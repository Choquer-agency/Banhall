# Historical structural verifier with one explicit hash-verified B4 recovery. No ledger mutation.
from pathlib import Path
import collections, functools, hashlib, json, subprocess

root=Path(__file__).resolve().parents[3]
path=root/'.audit/branch-consolidation/factory-audit/full-history-disposition.json'
data=json.loads(path.read_text())
def git(*args):
    return subprocess.check_output(['git',*args],cwd=root)
@functools.lru_cache(maxsize=6)
def tree(sha):
    result={}
    for row in git('ls-tree','-rz',sha).split(b'\0'):
        if not row: continue
        info,name=row.split(b'\t',1)
        mode,kind,blob=info.decode().split()
        result[name.decode()]={'mode':mode,'kind':kind,'blob':blob}
    return result

union=set()
for ref,sha in data['capturedTips'].items():
    assert git('rev-parse',ref).decode().strip()==sha
    union.update(git('rev-list',sha,'--not',data['baseline']).decode().splitlines())
assert union=={r['sha'] for r in data['commits']}
counts=collections.Counter()
for row in data['commits']:
    sha=row['sha'];parents=git('show','-s','--format=%P',sha).decode().split()
    assert parents==row['parents']
    actual=tree(sha);first=tree(parents[0]);baseline=tree(data['baseline']);snapshot=tree(data['currentCommitSnapshot'])
    changed={p for p in actual.keys()|first.keys() if actual.get(p)!=first.get(p)}
    assert changed=={p['path'] for p in row['changedPaths']},(sha,changed-{p['path'] for p in row['changedPaths']})
    for p in row['changedPaths']:
        name=p['path'];a=actual.get(name);b=first.get(name)
        assert p['commitBlob']==(a['blob'] if a else None),(sha,p)
        assert p['parentBlob']==(b['blob'] if b else None),(sha,p)
        assert p['baseline']==baseline.get(name),(sha,p)
        assert p['currentSnapshot']==snapshot.get(name),(sha,p)
        counts['path_records_verified']+=1
    counts['commits_verified']+=1
for relative,sha in data['sourceArtifactSha256'].items():
    p=root/'.audit/branch-consolidation'/relative
    if relative == 'planning/B4.md':
        assert sha == 'fd7ee2f91854330bb336e46410b678f36e77404f771cdca22b1d92933df88129'
        recovered=root/'.audit/branch-consolidation/recovery-audit/B4-original-hash-recovered.md'
        assert hashlib.sha256(recovered.read_bytes()).hexdigest()==sha, 'recovered historical B4 identity'
        assert hashlib.sha256(p.read_bytes()).hexdigest()=='cba0efe2489056805207bdd71de7e6e0d82d608284593d32dadc60d09808822b', 'current B4 replacement drift'
    else:
        assert hashlib.sha256(p.read_bytes()).hexdigest()==sha,relative
result={'ledger_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'captured_commit_union_verified':len(union),'counts':dict(counts),'all_declared_source_artifact_hashes_match_at_original_paths':False,'historical_identities_verified_with_explicit_recovery':True,'qualified_replacement':{'path':'planning/B4.md','historical_recovered_path':'.audit/branch-consolidation/recovery-audit/B4-original-hash-recovered.md','expected_historical_sha256':'fd7ee2f91854330bb336e46410b678f36e77404f771cdca22b1d92933df88129','current_replacement_sha256':'cba0efe2489056805207bdd71de7e6e0d82d608284593d32dadc60d09808822b','provenance':'.audit/branch-consolidation/recovery-audit/B4-historical-recovery-provenance.json'},'limits':'Structural identity verification only. Independent semantic review remains complementary; planned batches still require implementation/review/runtime proof.'}
(root/'.audit/branch-consolidation/recovery-audit/factory-history-qualified-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
