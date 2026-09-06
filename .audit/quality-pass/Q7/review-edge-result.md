[
  {
    "location": "src/lib/uploads/originalUpload.ts:37-52",
    "trigger_condition": "Non-2xx response arrives with a body that continues streaming indefinitely.",
    "guard_snippet": "finally { clearTimeout(timer); controller.abort(); }",
    "potential_consequence": "The deadline is cleared without aborting transport, leaving failed response downloads active during retries."
  }
]