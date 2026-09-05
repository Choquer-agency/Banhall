# bt-12 notification follow-up

Read-only inspection: 2026-09-05T01:08:46.497070+00:00. Scope: the existing notification-evidence.json and evidence.md under `/Users/johnnynguyen/Documents/Repos/Banhall/.audit/bmad-parallel-health-20260904/`, and their exact referenced Pi session log. No other conversations were searched, and no controllers, tests, worker processes, engine state, repository code, worktrees, or ledgers were changed. This report is the sole output written.

## Verdict

Later primary evidence now closes the bt-12 delivery gap: its background-terminal-result notification was recorded with display=true at **2026-09-04 12:45:18.739 PDT (19:45:18.739 UTC)**. The wrapper's last stdout line records **12:14:10 done**, so the recorded notification arrived approximately **31 minutes 8.739 seconds later**. The stdout completion clock has only second precision; this is not a millisecond-precise process-exit delay. The evidence establishes the notification record timestamp, not the moment a human read it.

The original failed fan-out attempt remains a failure despite its wrapper exitCode=0: the same primary notification reports boundary rc=1 and learn-chat rc=1. Successful or completed replacement workers cannot retroactively establish success for bt-12 or any other original attempt. This follow-up makes no current worker health, combined verification, integration, or shipping claim.

## Primary evidence

Source: `/Users/johnnynguyen/.pi/agent/sessions/--Users-johnnynguyen-Documents-Repos-Banhall--/2026-09-04T00-08-44-533Z_01a069bf-10f5-7f58-b7b8-9749a0c5015a.jsonl`.

- Line 865, record `664ea385`: bg_start tool result starts bt-12, title `lane fan-out v5`, PID 98553, at `2026-09-04T19:13:27.282Z`.
- Lines 867 and 869, preserved in the existing notification-evidence.json: the original boundary lane runs report zero tokens and escalation; the QA run explains the renderer rejected the symlinked _bmad surface. This supports the failed-attempt classification independently of wrapper exit status.
- Line 914, record `bc9be881`: at `2026-09-04T19:31:03.200Z`, assistant text predicts bt-12 will report next. That text alone is not delivery proof.
- **Line 923, record `a27f0165`**: actual notification, customType `background-terminal-result`, details.id `bt-12`, display=true, timestamp `2026-09-04T19:45:18.739Z`. Its exact relevant content follows:

```text
Background terminal bt-12 "lane fan-out v5" exited (exit 0) after 43s.

stdout:
12:13:27  fan out boundary from sprint2-boundary
12:14:03  boundary rc=1
12:14:05  pushed sprint2-boundary
12:14:05  fan out learn-chat from sprint2-learn-chat
12:14:07  learn-chat rc=1
12:14:09  pushed sprint2-learn-chat
12:14:10  done
```

The inspected session contained 1063 lines and its final record timestamp was `2026-09-04T21:52:13.185Z`. The match at line 923 directly answers the previously unresolved question. The earlier audit's “Not yet observed” statement was a capture-time limitation, superseded by this later source record. Existing evidence for delayed bt-8 through bt-11 notifications remains historical; it was not broadened into any claim about replacement completion.
