import { describe, expect, test } from "vitest";
import { deidentify } from "./deidentify";

describe("deidentify", () => {
  test("scrubs client and people names case-insensitively", () => {
    const out = deidentify(
      "acme farms hired Johnny Test. ACME FARMS then hired Jane Doe.",
      {
        clientName: "Acme Farms",
        writer: "Johnny Test",
        interviewer: "Jane Doe",
      }
    );
    expect(out).not.toMatch(/acme/i);
    expect(out).not.toMatch(/johnny test/i);
    expect(out).not.toMatch(/jane doe/i);
    expect(out).toContain("[redacted]");
  });

  test("scrubs interviewee names", () => {
    const out = deidentify("Interviewed Priya Raman and Bob Stone.", {
      interviewees: ["Priya Raman", "Bob Stone"],
    });
    expect(out).toBe("Interviewed [redacted] and [redacted].");
  });

  test("scrubs both the project title and the SR&ED title", () => {
    const out = deidentify(
      "The Raspberry Cane Trial produced data; see Cold-hardiness of Rubus cultivars.",
      {
        title: "Raspberry Cane Trial",
        sredTitle: "Cold-hardiness of Rubus cultivars",
      }
    );
    expect(out).not.toContain("Raspberry Cane Trial");
    expect(out).not.toContain("Cold-hardiness of Rubus cultivars");
    expect(out).toBe("The [redacted] produced data; see [redacted].");
  });

  test("scrubs email addresses and phone numbers", () => {
    const out = deidentify(
      "Reach jo@acme.ca or call (613) 555-0134 today.",
      {}
    );
    expect(out).toContain("[redacted email]");
    expect(out).toContain("[redacted phone]");
    expect(out).not.toContain("jo@acme.ca");
    expect(out).not.toContain("555-0134");
    // The whole number goes, opening parenthesis included.
    expect(out).toBe("Reach [redacted email] or call [redacted phone] today.");
    // Other written forms of the same number.
    for (const phone of ["613-555-0134", "+1 613 555 0134", "613.555.0134"]) {
      expect(deidentify(`Call ${phone}.`, {})).toBe("Call [redacted phone].");
    }
    // An extension does not shield the number.
    expect(deidentify("Call 613-555-0134x22.", {})).toBe(
      "Call [redacted phone]x22."
    );
  });

  test.each([
    ["LF", "\n"],
    ["CR", "\r"],
    ["CRLF", "\r\n"],
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
  ])("preserves %s boundaries during phone scrubbing", (_label, separator) => {
    for (const fragments of [
      `613${separator}555${separator}0134`,
      `(613)${separator}555-0134`,
      `(613) 555${separator}0134`,
      `(613)${separator}555${separator}0134`,
    ]) {
      const text = `First line${separator}${fragments}${separator}Last line`;
      expect(deidentify(text, {})).toBe(text);
    }
    for (const phone of ["613-555-0134", "(613) 555-0134"]) {
      expect(deidentify(`+1${separator}${phone}`, null)).toBe(
        `+1${separator}[redacted phone]`
      );
    }
  });

  test.each([" ", "\t", "\u00a0", "\u1680", "\u2003", "\u202f", "\u205f", "\u3000", "\ufeff"])(
    "retains same-line whitespace phone coverage for %j",
    (separator) => {
      for (const phone of [
        `613${separator}555${separator}0134`,
        `+1${separator}613${separator}555${separator}0134`,
        `+1${separator}(613)${separator}555${separator}0134`,
      ]) {
        expect(deidentify(`Call ${phone}.`, undefined)).toBe("Call [redacted phone].");
      }
    }
  );

  test("leaves separator-free digit runs alone", () => {
    // Accepted false negative: a bare ten-digit run is far more often a serial
    // or sample id in SR&ED prose than a phone number.
    const text = "Sample 6135550134 failed at cycle 1234567890123.";
    expect(deidentify(text, {})).toBe(text);
  });

  test("leaves mixed-separator numeric ranges and measurements alone", () => {
    // A phone number is written with one separator throughout; a range or a
    // version-like run that happens to fall into a 3-3-4 digit shape is not.
    // Accepted false negative on a mixed-separator phone, in exchange for not
    // rewriting the numbers these exemplars exist to preserve.
    const text =
      "Cycled between 500-600 1000 times; ran 100-200 3000 cycles on v2.100 200 3000.";
    expect(deidentify(text, {})).toBe(text);
    // Consistent separators are still a phone number.
    expect(deidentify("Call 613 555 0134 or 613-555-0134.", {})).toBe(
      "Call [redacted phone] or [redacted phone]."
    );
  });

  test("scrubs a contact address before the name pass can break it", () => {
    // The name pass would rewrite "acmefarms" inside the address, leaving the
    // local part exposed and the email pattern unmatchable.
    expect(
      deidentify("Mail tracy@acmefarms.ca now.", { clientName: "acmefarms" })
    ).toBe("Mail [redacted email] now.");
  });

  test("does not scrub an identifier occurring inside a longer word", () => {
    const text = "Ionization of the Bolted joint stayed within Casement limits.";
    expect(
      deidentify(text, {
        clientName: "Ion",
        writer: "Bolt",
        title: "Case",
      })
    ).toBe(text);
    // The same identifiers still scrub when they stand alone.
    expect(
      deidentify("Ion and Bolt reviewed the Case.", {
        clientName: "Ion",
        writer: "Bolt",
        title: "Case",
      })
    ).toBe("[redacted] and [redacted] reviewed the [redacted].");
  });

  test("ignores blank, whitespace-only, and sub-3-character identifiers", () => {
    const text = "AB and CD ran the trial in a bare room.";
    const out = deidentify(text, {
      clientName: "AB",
      title: "  ",
      sredTitle: "",
      writer: "CD",
      interviewees: ["", "  "],
    });
    expect(out).toBe(text);
  });

  test("longest identifier wins when names overlap", () => {
    const out = deidentify("Acme Farms is a division of Acme.", {
      clientName: "Acme Farms",
      title: "Acme",
    });
    expect(out).not.toMatch(/Acme/i);
    expect(out).toBe("[redacted] is a division of [redacted].");
  });

  test("treats regex-special identifiers as literal text", () => {
    const out = deidentify("Work done by C++ (Nordic) Ltd. was novel.", {
      clientName: "C++ (Nordic) Ltd.",
    });
    expect(out).toBe("Work done by [redacted] was novel.");
    // A literal match, not a regex: an unrelated string must survive.
    expect(deidentify("CXX Nordic Ltd was novel.", {
      clientName: "C++ (Nordic) Ltd.",
    })).toBe("CXX Nordic Ltd was novel.");
  });

  test("preserves paragraph and line structure when nothing matches", () => {
    const text =
      "First   paragraph with  spacing.\n\nSecond paragraph.\n\n\nThird after a wide gap.\n";
    expect(deidentify(text, { clientName: "Nobody Inc" })).toBe(text);
  });

  test("preserves structure around a scrubbed identifier", () => {
    const out = deidentify(
      "Acme Farms ran trials.\n\nAcme Farms then stopped.",
      { clientName: "Acme Farms" }
    );
    expect(out).toBe("[redacted] ran trials.\n\n[redacted] then stopped.");
  });

  test("still scrubs contacts when no project record is available", () => {
    const out = deidentify("Mail jo@acme.ca about it.", null);
    expect(out).toBe("Mail [redacted email] about it.");
  });
});
