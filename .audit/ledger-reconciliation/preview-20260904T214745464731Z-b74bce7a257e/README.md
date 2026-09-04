# Reconciliation preview only

Prepared with bmad-help. Installed [ST] Sweep Triage is automation-only; use the native sweep only after final integration. No sweep or ledger application was performed.

Each source is read using the exact commit in manifest.json. Re-run the utility without --manifest to snapshot final heads. Use --manifest to replay these commits. Mapping IDs may change when final heads change; review the final mapping before any application.

Main entries remain byte-for-byte intact. Exact copies ignoring only heading ID and trailing blank space are coalesced; every branch/SHA/old ID is retained in mapping.tsv and entries.json. Numeric collisions receive IDs above the highest source ID. Distinct origins remain separate canonical entries because native harvesting dedupes origin plus source_spec. Identical substance with distinct origins is separately flagged for explicit native-supported alias treatment.

Source damage is recorded with original bytes and exact intact source witnesses in source-damage-repairs.json; only a missing status with one unambiguous full-body match is restored. Duplicate source IDs are tracked by source_occurrence and remapped. Content variants sharing origin/source remain separate, unmodified entries and require human judgment before application. The preview must not be fed to native sweep while such conflicts remain undecided. Historical references are immutable. Active reference suggestions are contextual review candidates, never automatic global replacements. Unknown-format input aborts rather than guessing.

Proof:

```json
{
  "sources": 7,
  "occurrences": 340,
  "canonical_entries": 91,
  "exact_copies_deduplicated": 249,
  "remapped_occurrences": 48,
  "main_entries_preserved": 22,
  "main_stable_ids": "DW-1 through DW-22",
  "content_variant_groups": 0,
  "distinct_origin_alias_groups": 4,
  "explicit_source_damage_repairs": 3,
  "active_reference_suggestions": 0,
  "historical_references_preserved": 5,
  "statuses": {
    "open": 91
  },
  "assertions": "PASS: all occurrence content, fields, status, origin, source, and gate lines preserved; main bytes intact"
}
```
