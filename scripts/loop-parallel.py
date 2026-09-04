#!/usr/bin/env -S /Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python
"""Run one epic's stories as several concurrent bmad-loop lanes.

bmad-loop clamps scm.max_parallel to 1 (fan-out is unbuilt upstream), so
parallelism here means several bmad-loop processes, each with:

  * its own git worktree      -> its own .git index, so no index.lock races
  * its own lane branch       -> merges never collide mid-run
  * its own lane spec folder  -> a subset of stories.yaml, in declared order
  * its own run + tmux session

A lane is declared per story with a `lane:` key in stories.yaml (unknown keys
are ignored by bmad-loop's parser, so the file stays valid upstream):

    - id: "2"
      lane: ctx          # stories sharing a lane run serially, in file order
      title: ...

Stories with no `lane` land in lane "main". Put dependent stories in the SAME
lane, and split lanes by the files they touch: two lanes editing one file will
conflict when their branches merge.

Usage:
  scripts/loop-parallel.py <spec-folder> [--base main] [--plan] [--merge-into BRANCH]

  --plan          print the lane partition and exit (no worktrees, no runs)
  --base          branch the lanes fork from (default: current branch)
  --merge-into    branch that collects the lanes (default: parallel/<epic>)
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
LANE_ROOT = REPO / ".bmad-loop" / "lanes"


def git(*args, cwd=REPO, check=True):
    r = subprocess.run(["git", "--no-optional-locks", *args], cwd=cwd,
                       capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed:\n{r.stderr.strip()}")
    return r.stdout.strip()


def partition(spec: Path):
    stories = yaml.safe_load((spec / "stories.yaml").read_text())
    lanes: dict[str, list] = {}
    for s in stories:
        lanes.setdefault(str(s.get("lane") or "main"), []).append(s)
    return lanes


def build_lane_spec(spec: Path, lane: str, stories: list) -> Path:
    """A lane's spec folder: a copy of the epic with a subset stories.yaml.
    Lives inside the repo so every worktree sees it after one commit."""
    out = spec / "lanes" / lane
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for name in ("SPEC.md", "touchpoints.md"):
        if (spec / name).exists():
            shutil.copy2(spec / name, out / name)
    if (spec / "stories").is_dir():
        shutil.copytree(spec / "stories", out / "stories")
    subset = [{k: v for k, v in s.items() if k != "lane"} for s in stories]
    (out / "stories.yaml").write_text(
        yaml.safe_dump(subset, sort_keys=False, allow_unicode=True, width=100)
    )
    return out


# Gitignored paths a fresh worktree still needs: bmad-loop refuses to start
# without _bmad/bmm/config.yaml, and the verify gate runs npm.
SEED = ("_bmad", "node_modules", ".env.local")


def seed_worktree(worktree: Path):
    """Symlink the gitignored essentials into a lane worktree.

    .gitignore lists `_bmad/` with a trailing slash, which matches directories
    only, so a *symlink* named `_bmad` reads as untracked and bmad-loop refuses
    to start on a dirty worktree. Exclude the seeds through this worktree's own
    info/exclude, which never touches the main checkout."""
    for name in SEED:
        src, dst = REPO / name, worktree / name
        if src.exists() and not dst.exists():
            dst.symlink_to(src)
    # A linked worktree reads $GIT_COMMON_DIR/info/exclude, not its own gitdir's,
    # so the rules go in the shared file. Harmless in the main checkout, where
    # these paths are real directories already covered by .gitignore.
    common = Path(git("rev-parse", "--path-format=absolute", "--git-common-dir",
                      cwd=worktree))
    info = common / "info"
    info.mkdir(parents=True, exist_ok=True)
    exclude = info / "exclude"
    have = exclude.read_text() if exclude.exists() else ""
    add = [f"/{n}" for n in SEED if f"/{n}" not in have.split()]
    if add:
        with exclude.open("a") as fh:
            fh.write(("" if have.endswith("\n") or not have else "\n")
                     + "# bmad-loop lane worktree seeds\n" + "\n".join(add) + "\n")


def lane_policy(worktree: Path, spec_rel: str):
    """Each worktree needs its own policy: same knobs, lane's spec folder.
    policy.toml is gitignored, so it is copied rather than inherited."""
    src = REPO / ".bmad-loop" / "policy.toml"
    dst = worktree / ".bmad-loop" / "policy.toml"
    dst.parent.mkdir(parents=True, exist_ok=True)
    out = []
    for line in src.read_text().splitlines():
        if line.startswith("spec_folder ="):
            line = f'spec_folder = "{spec_rel}"'
        elif line.startswith("target_branch ="):
            line = 'target_branch = ""'
        out.append(line)
    dst.write_text("\n".join(out) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--base", default=None)
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--merge-into", default=None)
    a = ap.parse_args()

    spec = (REPO / a.spec).resolve()
    if not (spec / "stories.yaml").exists():
        raise SystemExit(f"no stories.yaml in {spec}")
    epic = spec.name
    base = a.base or git("rev-parse", "--abbrev-ref", "HEAD")
    collect = a.merge_into or f"parallel/{epic}"
    lanes = partition(spec)

    print(f"epic {epic}   base {base}   lanes {len(lanes)}")
    for lane, stories in lanes.items():
        ids = ", ".join(str(s["id"]) for s in stories)
        print(f"  {lane:10s} {len(stories):2d} stories: {ids}")
    if a.plan:
        return
    if len(lanes) == 1:
        raise SystemExit("only one lane; use scripts/loop.sh instead")
    if git("status", "--porcelain", "--untracked-files=no"):
        raise SystemExit("working tree dirty; commit first")

    # 1. materialize every lane spec and commit once, so all worktrees see them
    specs = {lane: build_lane_spec(spec, lane, st) for lane, st in lanes.items()}
    git("add", "-A", str(spec / "lanes"))
    if git("diff", "--cached", "--name-only"):
        git("commit", "-q", "-m", f"chore(loop): lane specs for {epic}")

    # 2. one worktree + branch + process per lane
    LANE_ROOT.mkdir(parents=True, exist_ok=True)
    procs = {}
    for lane, lane_spec in specs.items():
        branch = f"lane/{epic}/{lane}"
        wt = LANE_ROOT / f"{epic}-{lane}"
        if wt.exists():
            git("worktree", "remove", "--force", str(wt), check=False)
        git("branch", "-f", branch, "HEAD")
        git("worktree", "add", "--quiet", str(wt), branch)
        rel = str(lane_spec.relative_to(REPO))
        seed_worktree(wt)
        lane_policy(wt, rel)
        log = LANE_ROOT / f"{epic}-{lane}.log"
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(("CLAUDECODE", "CLAUDE_CODE", "CLAUDE_PID", "CLAUDE_EFFORT"))}
        env.setdefault("PUBLIC_CONVEX_URL", "https://placeholder.convex.cloud")
        procs[lane] = (subprocess.Popen(
            ["bmad-loop", "run", "--project", str(wt), "--spec", rel],
            cwd=wt, env=env, stdin=subprocess.DEVNULL,
            stdout=open(log, "w"), stderr=subprocess.STDOUT), branch, wt, log)
        print(f"  started lane {lane} -> {branch}  (log {log})")
        time.sleep(5)  # stagger the initial worktree adds

    # 3. wait
    for lane, (p, branch, wt, log) in procs.items():
        rc = p.wait()
        print(f"  lane {lane} exited rc={rc}  ({log})")

    # 4. collect. When collect == base that branch is already checked out here,
    # so `branch -f` would fail; merge the lanes into it in place instead.
    if collect != base:
        git("checkout", "-q", base)
        git("branch", "-f", collect, base)
    git("checkout", "-q", collect)
    conflicts = []
    for lane, (_p, branch, _wt, _log) in procs.items():
        r = subprocess.run(["git", "merge", "--no-edit", branch],
                           cwd=REPO, capture_output=True, text=True)
        if r.returncode != 0:
            conflicts.append(lane)
            subprocess.run(["git", "merge", "--abort"], cwd=REPO)
            print(f"  MERGE CONFLICT from lane {lane}; left for a human")
        else:
            print(f"  merged lane {lane}")
    print(f"\ncollected on {collect}" + (f"; unmerged lanes: {', '.join(conflicts)}" if conflicts else ""))
    print("worktrees kept under .bmad-loop/lanes for inspection")


if __name__ == "__main__":
    sys.exit(main())
