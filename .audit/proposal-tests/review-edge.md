[
  {
    "location": "tests/chatProposals.test.ts:217-219",
    "trigger_condition": "The same target occurs once in each of two separate paragraphs.",
    "guard_snippet": "Seed two paragraph nodes containing the target; retain STALE_REVISION and unchanged-state assertions for both modes.",
    "potential_consequence": "A uniqueness check that resets per paragraph can pass the migrated test undetected.",
    "kind": "deletion",
    "confidence": "high"
  }
]
