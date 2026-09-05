from pathlib import Path
import hashlib, json, re, subprocess, sys
root=Path(__file__).resolve().parents[2]
manifest=json.loads((root/".audit/native-entrypoint-retirement/preservation.json").read_text())
retired=["scripts/loop-parallel.py", "scripts/loop.sh"]
issues=[]; references=[]; inspected=0; aliases=[]
for relative in retired:
    path=root/relative
    if path.exists() or path.is_symlink(): issues.append(f"retired entry point exists: {relative}")
tracked=subprocess.check_output(["git","ls-files","-z"],cwd=root).decode().split("\0")
tracked_names=set(tracked)
pattern=re.compile(rb"(?<![A-Za-z0-9_-])(?:loop-parallel\.py|loop\.sh)(?![A-Za-z0-9_.-])")
for relative in tracked:
    if not relative or relative.startswith((".audit/","_bmad-output/")) or relative in retired: continue
    path=root/relative
    if not path.exists() and not path.is_symlink(): continue
    if path.is_symlink():
        target=path.resolve()
        try: target_relative=str(target.relative_to(root))
        except ValueError: target_relative=None
        covered=bool(target_relative and not target_relative.startswith((".audit/", "_bmad-output/")) and target_relative not in (".audit", "_bmad-output") and target.exists() and (
            (target.is_file() and target_relative in tracked_names) or
            (target.is_dir() and any(name.startswith(target_relative+"/") for name in tracked_names))))
        if covered: aliases.append({"alias":relative,"tracked_target":target_relative})
        else: issues.append("uninspected tracked symlink: "+relative)
        continue
    try: content=path.read_bytes()
    except OSError as error:
        issues.append(f"unreadable tracked file: {relative}: {error}"); continue
    inspected+=1
    if pattern.search(content):
        references.append(relative)
        if relative != "docs/bmad-loop.md": issues.append("retired basename reference requires review: "+relative)
        elif hashlib.sha256(content).hexdigest()!=manifest[relative]: issues.append("retirement guide changed; inspect references and recovery safeguards")
for relative, expected in manifest.items():
    try: actual=hashlib.sha256((root/relative).read_bytes()).hexdigest()
    except OSError as error:
        issues.append(f"unreadable preserved file: {relative}: {error}"); continue
    if actual!=expected: issues.append("preserved gate/guide differs from reviewed bytes: "+relative)
source_state={name: {"exists": (root/name).exists(), "symlink": (root/name).is_symlink()} for name in retired}
for name in manifest:
    source_state[name]=hashlib.sha256((root/name).read_bytes()).hexdigest() if (root/name).is_file() else None
fingerprint=hashlib.sha256(json.dumps(source_state,sort_keys=True).encode()).hexdigest()
print(json.dumps({"head":subprocess.check_output(["git","rev-parse","HEAD"],cwd=root,text=True).strip(),"worktree":str(root),"source_fingerprint":fingerprint,"verifier_sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),"inspected_tracked_files":inspected,"retired_basename_references":references,"aliases_to_inspected_tracked_targets":aliases,"issues":issues,"passed":not issues,"limits":"Static basename-reference and exact preserved-file checks; not proof against dynamically constructed command names. New artifacts under .audit and _bmad-output are historical/review inputs, not active callers."},indent=2))
sys.exit(bool(issues))
