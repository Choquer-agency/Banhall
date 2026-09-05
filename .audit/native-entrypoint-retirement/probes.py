from pathlib import Path
import subprocess,tempfile,json,shutil,hashlib
source=Path(__file__).resolve().parents[2]; checks=[]
with tempfile.TemporaryDirectory(prefix="bmad-entrypoint-verifier-") as d:
 r=Path(d)
 for f in [".audit/native-entrypoint-retirement/verify.py",".audit/native-entrypoint-retirement/preservation.json","scripts/loop-verify.sh",".bmad-loop/plugins/npm-bootstrap/plugin.toml","docs/bmad-loop.md"]:
  p=r/f;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/f,p)
 def git(*a): subprocess.run(["git",*a],cwd=r,check=True,capture_output=True)
 git("init","-q");git("add","-A");git("-c","user.name=Verifier Fixture","-c","user.email=fixture@example.invalid","commit","-qm","fixture")
 def verify(name,expected,fragment=None):
  x=subprocess.run(["python3",".audit/native-entrypoint-retirement/verify.py"],cwd=r,capture_output=True,text=True); j=json.loads(x.stdout); assert (x.returncode==0)==expected,(name,x.stdout,x.stderr)
  if fragment: assert any(fragment in issue for issue in j["issues"]),(name,j)
  checks.append({"case":name,"expected_pass":expected,"actual_pass":j["passed"],"issues":j["issues"]})
 verify("actual reviewed source",True)
 for file in ["scripts/loop-parallel.py","scripts/loop.sh"]:
  p=r/file;p.write_text("retired fixture, never execute\n");verify("restored "+file,False,"retired entry point exists");p.unlink()
 p=r/".agents/active/SKILL.md";p.parent.mkdir(parents=True);p.write_text("Run bash scripts/loop.sh\n");git("add",str(p.relative_to(r)));verify("active skill caller",False,"basename reference");git("rm","--cached","-q",str(p.relative_to(r)));p.unlink()
 p=r/".factory/caller.sh";p.parent.mkdir(parents=True);p.write_text("cd scripts\nbash loop.sh\n");git("add",str(p.relative_to(r)));verify("relative factory caller",False,"basename reference");git("rm","--cached","-q",str(p.relative_to(r)));p.unlink()
 p=r/"docs/bmad-loop.md"; original=p.read_bytes();p.write_bytes(original+b"\nUse bash loop.sh\n");verify("modified operator guide",False,"guide changed");p.write_bytes(original)
 p=r/"scripts/loop-verify.sh";original=p.read_bytes();p.write_bytes(b"");verify("empty native gate",False,"preserved gate/guide differs");p.write_bytes(original)
 p=r/"tracked-alias";p.symlink_to("scripts/loop-verify.sh");git("add","tracked-alias");verify("alias to inspected tracked file",True);git("rm","--cached","-q","tracked-alias");p.unlink()
 p=r/"uninspected";p.write_text("not tracked\n");q=r/"tracked-alias";q.symlink_to("uninspected");git("add","tracked-alias");verify("alias to uninspected file",False,"uninspected tracked symlink");git("rm","--cached","-q","tracked-alias");q.unlink();p.unlink()
 p=r/"tracked-alias";p.symlink_to(".audit/native-entrypoint-retirement/verify.py");git("add","tracked-alias");verify("active alias into excluded historical artifacts",False,"uninspected tracked symlink");git("rm","--cached","-q","tracked-alias");p.unlink()
 verify("restored fixture",True)
print(json.dumps({"fixture_only":True,"verifier_sha256":hashlib.sha256((source/".audit/native-entrypoint-retirement/verify.py").read_bytes()).hexdigest(),"checks":checks},indent=2))
