[
  {
    "location": ".audit/native-entrypoint-retirement/verify.py:12",
    "trigger_condition": "An active tracked skill or factory script invokes a retired wrapper.",
    "guard_snippet": "Exclude only identified historical artifacts; scan executable files and active skill instructions in excluded directories.",
    "potential_consequence": "The verifier passes while an active operator entry point invokes a deleted wrapper."
  },
  {
    "location": ".audit/native-entrypoint-retirement/verify.py:17",
    "trigger_condition": "A tracked caller uses cd scripts followed by bash loop.sh.",
    "guard_snippet": "Match retired basenames and inspect candidate invocations with their working-directory context.",
    "potential_consequence": "Relative invocations evade the check and fail when operators execute them."
  },
  {
    "location": ".audit/native-entrypoint-retirement/verify.py:15-16",
    "trigger_condition": "Reading a tracked caller raises OSError or UnicodeError.",
    "guard_snippet": "except (UnicodeError, OSError): issues.append(f'Unable to inspect tracked file: {relative}')",
    "potential_consequence": "The verifier reports success despite failing to inspect a possible active caller."
  },
  {
    "location": ".audit/native-entrypoint-retirement/verify.py:22-23",
    "trigger_condition": "Integration preserves gate filenames but empties the script or disables the bootstrap hook.",
    "guard_snippet": "Validate retained gate content and parsed bootstrap hook configuration against the approved baseline.",
    "potential_consequence": "The preservation check passes despite losing verification or dependency readiness enforcement."
  }
]
