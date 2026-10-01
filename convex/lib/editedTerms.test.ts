import { describe, expect, it } from "vitest";
import { containsTerm, editedTermsOf } from "./editedTerms";

// The release suite's fictional edits (run 4).
const ORIGINAL_CONTEXT = [
  "The company has made foam ceramic filters for metal foundries for a little over twenty years.",
];
const EDITED_CONTEXT = [
  "The company has made foam ceramic filters for metal foundries for a little over twenty years. The team calls the graded structure the cascade-fired lattice.",
];

describe("edited terms of a Seed Selection", () => {
  it("finds the team term the writer added, not the plain words around it", () => {
    expect(editedTermsOf(ORIGINAL_CONTEXT, EDITED_CONTEXT)).toEqual(["cascade-fired lattice"]);
  });

  it("finds a name and a date in an added sentence", () => {
    expect(
      editedTermsOf(
        ["The model still runs only in shadow mode on nine dryers during spring drying, not yet live-alerting."],
        [
          "The model still runs only in shadow mode on nine dryers during spring drying, not yet live-alerting. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027.",
        ]
      )
    ).toEqual(["Ashgrove elevator", "spring 2027"]);
  });

  it("finds a changed word and a quoted phrase, and nothing in an unedited Seed", () => {
    expect(
      editedTermsOf(
        ["Coupons were held at 40 degrees for 10 days."],
        ['Coupons were held at 45 degrees for 10 days in the "warm soak" rig.']
      )
    ).toEqual(["warm soak", "45"]);
    expect(editedTermsOf(ORIGINAL_CONTEXT, ORIGINAL_CONTEXT)).toEqual([]);
    // A capital at the start of a sentence is not a name.
    expect(editedTermsOf(["The kiln ran hot."], ["The kiln ran hot. Operators noticed early."])).toEqual([]);
  });

  it("matches a term word for word, case and line breaks aside, never inside a longer word", () => {
    expect(containsTerm("The Cascade-fired\nlattice held.", "cascade-fired lattice")).toBe(true);
    expect(containsTerm("The cascade fired lattice held.", "cascade-fired lattice")).toBe(false);
    expect(containsTerm("The cascade-fired lattices held.", "cascade-fired lattice")).toBe(false);
    expect(containsTerm("A graded, cascade-fired structure.", "cascade-fired lattice")).toBe(false);
    expect(containsTerm("booked for spring 2027.", "spring 2027")).toBe(true);
  });
});
