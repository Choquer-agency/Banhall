// The one narrow column every project page surface uses (owner, 2026-10-06):
// the report, Sources, Summary review, the drafting view, generation
// progress, intake and the full-screen Assistant. From lg up it is 960px
// with 40px sides, an 880px text column, so the editor's block handle 34px
// left of the text is never clipped. Change the width in one place: the
// --container-reading token in src/routes/layout.css.
export const readingColumn = "mx-auto w-full max-w-3xl px-6 lg:max-w-reading lg:px-10";

// The report's Full width toggle swaps the column for the whole pane: 40px
// sides beside a side panel, 48px when the pane is alone.
export function reportColumn(fullWidth: boolean, sidePanelOpen: boolean): string {
  if (!fullWidth) return readingColumn;
  // max-w-full, not none, so the width eases between the two.
  return sidePanelOpen ? "mx-auto w-full max-w-full px-6 lg:px-10" : "mx-auto w-full max-w-full px-6 lg:px-12";
}
