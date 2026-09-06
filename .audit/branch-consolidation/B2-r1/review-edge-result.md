[
  {
    "location": "src/lib/components/editor/docSearch.ts:76-87",
    "trigger_condition": "Document contains length-expanding lowercase characters, such as İ, before or inside a match",
    "guard_snippet": "const { hay, posMap } = buildCaseFoldedSearchIndex(doc);",
    "potential_consequence": "Matches use shifted document positions, highlighting or replacing unrelated characters."
  },
  {
    "location": "src/lib/components/editor/docSearch.ts:51-57",
    "trigger_condition": "A hardBreak node separates text within the same paragraph",
    "guard_snippet": "else if (node.type.name === \"hardBreak\") { pushChar(\" \", pos); }",
    "potential_consequence": "Search concatenates separated words, missing spaced needles and matching unintended text across line breaks."
  }
]