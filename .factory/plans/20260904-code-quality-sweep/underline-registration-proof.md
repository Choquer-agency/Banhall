# Duplicate underline registration proof

Executed on root checkout `73994f5`, exit code 0. No product or worktree changes. The script resolves source and installed packages from its caller's current directory; its candidate exists only as an in-memory array filter. After the two-line deletion, it reports `current` with one registration and no warning, skipping a redundant candidate.

## Source trace

- `src/lib/tiptapConfig.ts:5` imports explicit Underline; `:46` adds it to the extension array.
- Installed StarterKit, Underline, and Tiptap core are all 3.28.0. `node_modules/@tiptap/starter-kit/src/starter-kit.ts:263-264` already adds Underline unless configured false. Both instances use default HTMLAttributes.
- Live `Editor.svelte:780` and `ReadOnlyEditor.svelte:191` use this shared config; `EditorToolbar.svelte:124-126` uses toggleUnderline.
- `git diff 11bfe3e -- src/lib/tiptapConfig.ts` produced no output. The duplicate exists in the sweep baseline.

## Command and actual output

Run from the checkout being verified:

```sh
node .factory/plans/20260904-code-quality-sweep/underline-registration-proof.mjs
```

```json
{
  "sourcePath": "/Users/johnnynguyen/Documents/Repos/Banhall/src/lib/tiptapConfig.ts",
  "rows": [
    {
      "phase": "baseline",
      "editable": true,
      "explicitEntriesInSource": 1,
      "underlineRegistrations": 2,
      "duplicateWarnings": 1,
      "schemaHasUnderline": true,
      "initialUnderline": true,
      "text": "Alpha",
      "toggledOff": true,
      "toggledOn": true
    },
    {
      "phase": "candidate-in-memory",
      "editable": true,
      "explicitEntriesInSource": 1,
      "underlineRegistrations": 1,
      "duplicateWarnings": 0,
      "schemaHasUnderline": true,
      "initialUnderline": true,
      "text": "Alpha",
      "toggledOff": true,
      "toggledOn": true
    },
    {
      "phase": "baseline",
      "editable": false,
      "explicitEntriesInSource": 1,
      "underlineRegistrations": 2,
      "duplicateWarnings": 1,
      "schemaHasUnderline": true,
      "initialUnderline": true,
      "text": "Alpha",
      "toggledOff": null,
      "toggledOn": null
    },
    {
      "phase": "candidate-in-memory",
      "editable": false,
      "explicitEntriesInSource": 1,
      "underlineRegistrations": 1,
      "duplicateWarnings": 0,
      "schemaHasUnderline": true,
      "initialUnderline": true,
      "text": "Alpha",
      "toggledOff": null,
      "toggledOn": null
    }
  ]
}
```

The real headless Editor retains existing underline JSON and schema in editable and read-only modes. Actual editable commands toggle underline off and on while retaining text. Removing only the explicit item changes registration count 2 to 1 and duplicate warnings 1 to 0. This is not a browser-interaction claim; the existing real Editor browser suite supplies that separate evidence.

## Bounded recommendation

Fold removal of the import and array item into pending slop-2 AC4, keeping six criteria and eleven touched files. Keep the direct dependency declaration. Run this proof after the change and the existing Editor browser suite for before-warning/after-no-warning evidence. No permanent implementation-mirroring test is needed. Tickets were not edited by this audit.

