import { describe, expect, it } from "vitest";
import { parsePdFilename, splitCamelCase } from "./pdFilename";

describe("parsePdFilename", () => {
  it("parses the canonical example into every field", () => {
    expect(
      parsePdFilename(
        "03 3GAMarine 2025-12-31 R1.LR.mo MarineBatteryElectricalandThermalBehaviourAdvancements.docx"
      )
    ).toEqual({
      projectNumber: "3",
      clientName: "3GA Marine",
      fiscalYearEnd: "2025-12-31",
      revision: "1",
      writerInitials: "LR",
      reviewerInitials: "MO",
      title: "Marine Battery Electricaland Thermal Behaviour Advancements",
    });
  });

  it("upper-cases lowercase initials and accepts a lowercase r", () => {
    expect(parsePdFilename("7 AcmeLabs 2024-06-30 r12.tl.ec SolarTrackerPrototype.pdf")).toEqual({
      projectNumber: "7",
      clientName: "Acme Labs",
      fiscalYearEnd: "2024-06-30",
      revision: "12",
      writerInitials: "TL",
      reviewerInitials: "EC",
      title: "Solar Tracker Prototype",
    });
  });

  it("strips the leading zero so the page validator accepts the number", () => {
    expect(parsePdFilename("03 Client 2025-12-31")?.projectNumber).toBe("3");
    expect(parsePdFilename("09b Client 2025-12-31")?.projectNumber).toBe("9b");
    expect(parsePdFilename("12 Client 2025-12-31")?.projectNumber).toBe("12");
    expect(parsePdFilename("00 Client 2025-12-31")).toBeNull();
    for (const name of ["03 Client 2025-12-31", "09b Client 2025-12-31", "12 Client 2025-12-31"]) {
      expect(parsePdFilename(name)?.projectNumber).toMatch(/^(?:[1-9][0-9]?[A-Za-z]?|[A-Za-z])$/);
    }
  });

  it("drops a project number above the per-company cap of 20 but keeps the rest", () => {
    expect(parsePdFilename("21 Client 2025-12-31 R1.LR Title.docx")).toEqual({
      clientName: "Client",
      fiscalYearEnd: "2025-12-31",
      revision: "1",
      writerInitials: "LR",
      title: "Title",
    });
    expect(parsePdFilename("20 Client 2025-12-31")?.projectNumber).toBe("20");
  });

  it("needs a fiscal year-end or revision token before it trusts the name", () => {
    expect(parsePdFilename("3 Notes.docx")).toBeNull();
    expect(parsePdFilename("7 Final.pdf")).toBeNull();
    expect(parsePdFilename("1 Draft v2.docx")).toBeNull();
    expect(parsePdFilename("3 Client Title")).toBeNull();
    expect(parsePdFilename("3.docx")).toBeNull();
  });

  it("never reads a date or revision token as the client", () => {
    expect(parsePdFilename("2 2025-12-31 R1.LR Title.docx")).toBeNull();
    expect(parsePdFilename("2 R1.LR 2025-12-31 Title.docx")).toBeNull();
  });

  it("returns null for a name outside the scheme", () => {
    expect(parsePdFilename("Final Report.docx")).toBeNull();
    expect(parsePdFilename("Report 2025.docx")).toBeNull();
    expect(parsePdFilename("123 TooManyDigits.docx")).toBeNull();
    expect(parsePdFilename("")).toBeNull();
    expect(parsePdFilename("   ")).toBeNull();
    expect(parsePdFilename(".docx")).toBeNull();
  });

  it("keeps the prefix when the revision token is missing", () => {
    expect(parsePdFilename("3 3GAMarine 2025-12-31 MarineBatteryAdvancements.docx")).toEqual({
      projectNumber: "3",
      clientName: "3GA Marine",
      fiscalYearEnd: "2025-12-31",
      title: "Marine Battery Advancements",
    });
  });

  it("keeps the prefix when the fiscal year-end is missing", () => {
    expect(parsePdFilename("3 3GAMarine R2.OM SolarTracker.docx")).toEqual({
      projectNumber: "3",
      clientName: "3GA Marine",
      revision: "2",
      writerInitials: "OM",
      title: "Solar Tracker",
    });
  });

  it("omits an empty reviewer and an empty title", () => {
    expect(parsePdFilename("3 Client 2025-12-31 R1.LR.docx")).toEqual({
      projectNumber: "3",
      clientName: "Client",
      fiscalYearEnd: "2025-12-31",
      revision: "1",
      writerInitials: "LR",
    });
  });

  it("drops an impossible date and still reads the revision after it", () => {
    expect(parsePdFilename("3 Client 2025-02-30 R1.LR Title.docx")).toEqual({
      projectNumber: "3",
      clientName: "Client",
      revision: "1",
      writerInitials: "LR",
      title: "Title",
    });
    expect(parsePdFilename("3 Client 2025-13-01 Title.docx")).toBeNull();
    expect(parsePdFilename("3 Client 2024-02-29 Title.docx")?.fiscalYearEnd).toBe("2024-02-29");
  });

  it("treats a malformed revision token as part of the title", () => {
    expect(parsePdFilename("3 Client 2025-12-31 R1 Title.docx")).toEqual({
      projectNumber: "3",
      clientName: "Client",
      fiscalYearEnd: "2025-12-31",
      title: "R1 Title",
    });
    expect(parsePdFilename("3 Client 2025-12-31 R1.L Title.docx")?.revision).toBeUndefined();
    expect(parsePdFilename("3 Client 2025-12-31 R1.LRXX Title.docx")?.revision).toBeUndefined();
  });

  it("tolerates repeated spaces and any short extension", () => {
    expect(parsePdFilename("03  3GAMarine   2025-12-31 R1.LR.mo  Title.txt")).toMatchObject({
      projectNumber: "3",
      clientName: "3GA Marine",
      fiscalYearEnd: "2025-12-31",
      title: "Title",
    });
    expect(parsePdFilename("3 Client R1.LR Title")?.title).toBe("Title");
  });

  it("keeps a trailing revision token when the name has no extension", () => {
    expect(parsePdFilename("3 Client 2025-12-31 R1.LR.mo")).toMatchObject({
      revision: "1",
      writerInitials: "LR",
      reviewerInitials: "MO",
    });
  });

  it("keeps a multi-token title in order and splits each token", () => {
    expect(parsePdFilename("3 Client 2025-12-31 R1.LR MarineBattery ThermalBehaviour.docx")?.title).toBe(
      "Marine Battery Thermal Behaviour"
    );
  });
});

describe("splitCamelCase", () => {
  it.each([
    ["3GAMarine", "3GA Marine"],
    ["AcmeLabs", "Acme Labs"],
    ["NASAProgram", "NASA Program"],
    ["Client2024", "Client 2024"],
    ["2024Report", "2024 Report"],
    ["MarineV2", "Marine V2"],
    ["Electricaland", "Electricaland"],
    ["lowercase", "lowercase"],
    ["ABC", "ABC"],
  ])("splits %s into %s", (input, expected) => {
    expect(splitCamelCase(input)).toBe(expected);
  });
});
