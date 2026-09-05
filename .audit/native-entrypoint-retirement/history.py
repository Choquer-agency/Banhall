from pathlib import Path
import json, subprocess
base="14d3d1795d9f861257ac122f7183449b248a369a"
head="9da55bece5948da12129720dd2330a3032c985bf"
root=Path(__file__).resolve().parents[2]
def git(*args): return subprocess.check_output(["git",*args],cwd=root,text=True)
def exists(sha,path): return subprocess.run(["git","cat-file","-e",sha+":"+path],cwd=root,capture_output=True).returncode==0
revived=[]
for sha in git("rev-list","--no-merges",base+".."+head).splitlines():
    for path in git("diff-tree","--no-commit-id","--name-only","--diff-filter=D","-r",sha).splitlines():
        if path.startswith((".audit/","_bmad-output/",".agents/",".codex/",".factory/")): continue
        if exists(head,path): revived.append({"deletion_commit":sha,"present_path":path})
introductions=[]
for row in git("rev-list","--first-parent","--parents",base+".."+head).splitlines():
    ids=row.split(); path="scripts/loop-parallel.py"
    if len(ids)>1 and exists(ids[0],path) and not exists(ids[1],path):
        introductions.append({"commit":ids[0],"parents":ids[1:],"subject":git("show","-s","--format=%s",ids[0]).strip()})
print(json.dumps({"base":base,"head":head,"revived_source_deletions":revived,"first_parent_introductions_including_original_creation":introductions},indent=2))
