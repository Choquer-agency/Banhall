[
  {
    "location": "src/lib/components/editor/docSearch.ts:76-87",
    "trigger_condition": "Document contains İ before or inside a match, expanding during lowercasing.",
    "guard_snippet": "const { hay, posMap } = caseFoldWithPositionMap(buildSearchIndex(doc));",
    "potential_consequence": "Match offsets shift, highlighting or replacing adjacent text, or silently dropping valid matches."
  },
  {
    "location": "src/lib/components/editor/docSearch.ts:51-57",
    "trigger_condition": "A hard_break separates text within the same textblock.",
    "guard_snippet": "else if (node.type.name === \"hard_break\") { pendingBreak = chars.length > 0; }",
    "potential_consequence": "Search concatenates separated words, missing spaced phrases and allowing replacements across an omitted break."
  }
]