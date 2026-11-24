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
      versionCode: "R",
      revision: "1",
      writerInitials: "LR",
      reviewerInitials: "MO",
      reviewerInProgress: true,
      title: "Marine Battery Electricaland Thermal Behaviour Advancements",
    });
  });

  it("upper-cases lowercase initials, flags lowercase reviewer as in progress, and accepts a lowercase r", () => {
    expect(parsePdFilename("7 AcmeLabs 2024-06-30 r12.tl.ec SolarTrackerPrototype.pdf")).toEqual({
      projectNumber: "7",
      clientName: "Acme Labs",
      fiscalYearEnd: "2024-06-30",
      versionCode: "R",
      revision: "12",
      writerInitials: "TL",
      reviewerInitials: "EC",
      reviewerInProgress: true,
      title: "Solar Tracker Prototype",
    });
    expect(parsePdFilename("7 AcmeLabs 2024-06-30 R12.TL.EC SolarTrackerPrototype.pdf")?.reviewerInProgress).toBeUndefined();
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

  it("accepts 2-digit project numbers up to 99 per Banhall naming convention", () => {
    expect(parsePdFilename("21 Client 2025-12-31 R1.LR Title.docx")).toEqual({
      projectNumber: "21",
      clientName: "Client",
      fiscalYearEnd: "2025-12-31",
      versionCode: "R",
      revision: "1",
      writerInitials: "LR",
      title: "Title",
    });
    expect(parsePdFilename("99 Client 2025-12-31")?.projectNumber).toBe("99");
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
      versionCode: "R",
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
      versionCode: "R",
      revision: "1",
      writerInitials: "LR",
    });
  });

  it("drops an impossible date and still reads the revision after it", () => {
    expect(parsePdFilename("3 Client 2025-02-30 R1.LR Title.docx")).toEqual({
      projectNumber: "3",
      clientName: "Client",
      versionCode: "R",
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

  it("reads a T (to be submitted) version as its letter and number", () => {
    expect(parsePdFilename("04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift.docx")).toEqual({
      projectNumber: "4",
      clientName: "Cedarline Systems",
      fiscalYearEnd: "2025-03-31",
      versionCode: "T",
      revision: "2",
      writerInitials: "DW",
      reviewerInitials: "PN",
      title: "Cold Chain Sensor Drift",
    });
  });

  it("reads an S (submitted) version as its letter and number", () => {
    expect(parsePdFilename("11 HaldenFoods 2024-12-31 S1.so.dw ShelfLifeModel.docx")).toEqual({
      projectNumber: "11",
      clientName: "Halden Foods",
      fiscalYearEnd: "2024-12-31",
      versionCode: "S",
      revision: "1",
      writerInitials: "SO",
      reviewerInitials: "DW",
      reviewerInProgress: true,
      title: "Shelf Life Model",
    });
  });

  it("accepts a lowercase t or s and upper-cases the letter", () => {
    expect(parsePdFilename("2 NorthgateLabs 2025-06-30 t3.pn Title.docx")?.versionCode).toBe("T");
    expect(parsePdFilename("2 NorthgateLabs 2025-06-30 s10.pn Title.docx")).toMatchObject({
      versionCode: "S",
      revision: "10",
    });
  });

  it("reads a T or S version with no reviewer initials", () => {
    expect(parsePdFilename("5 HaldenFoods 2025-12-31 T1.DW Title.docx")).toEqual({
      projectNumber: "5",
      clientName: "Halden Foods",
      fiscalYearEnd: "2025-12-31",
      versionCode: "T",
      revision: "1",
      writerInitials: "DW",
      title: "Title",
    });
    expect(parsePdFilename("5 HaldenFoods S4.DW Title.docx")).toEqual({
      projectNumber: "5",
      clientName: "Halden Foods",
      versionCode: "S",
      revision: "4",
      writerInitials: "DW",
      title: "Title",
    });
  });

  it("does not read any other letter, or a letter with no number, as a version", () => {
    // With no fiscal year-end to anchor them, these names do not parse at all.
    expect(parsePdFilename("3 Client X1.DW Title.docx")).toBeNull();
    expect(parsePdFilename("3 Client V2.DW.PN Title.docx")).toBeNull();
    expect(parsePdFilename("3 Client T.DW Title.docx")).toBeNull();
    expect(parsePdFilename("3 Client TS1.DW Title.docx")).toBeNull();
    expect(parsePdFilename("3 Client T1 Title.docx")).toBeNull();
    // With a fiscal year-end the name parses, and the odd token is title.
    expect(parsePdFilename("3 Client 2025-12-31 X1.DW Title.docx")).toEqual({
      projectNumber: "3",
      clientName: "Client",
      fiscalYearEnd: "2025-12-31",
      title: "X1.DW Title",
    });
  });

  it("never reads a T or S version token as the client, and needs a project number", () => {
    expect(parsePdFilename("2 T1.DW 2025-12-31 Title.docx")).toBeNull();
    expect(parsePdFilename("2 S1.DW.PN Title.docx")).toBeNull();
    expect(parsePdFilename("CedarlineSystems 2025-12-31 T1.DW Title.docx")).toBeNull();
    expect(parsePdFilename("T1.DW.PN Title.docx")).toBeNull();
  });

  it("keeps a trailing T or S token when the name has no extension", () => {
    expect(parsePdFilename("3 Client 2025-12-31 T1.DW.PN")).toMatchObject({
      versionCode: "T",
      revision: "1",
      writerInitials: "DW",
      reviewerInitials: "PN",
    });
    expect(parsePdFilename("3 Client 2025-12-31 S2.DW")).toMatchObject({ versionCode: "S", revision: "2" });
  });

  it("never reads a document extension as initials", () => {
    for (const extension of ["doc", "pdf", "txt", "vtt", "DOC"]) {
      expect(parsePdFilename(`03 Cedarline 2025-12-31 T1.${extension}`), extension).toEqual({
        projectNumber: "3",
        clientName: "Cedarline",
        fiscalYearEnd: "2025-12-31",
        versionCode: "T",
        revision: "1",
      });
      expect(parsePdFilename(`03 Cedarline 2025-12-31 R2.DW.${extension}`), extension).toEqual({
        projectNumber: "3",
        clientName: "Cedarline",
        fiscalYearEnd: "2025-12-31",
        versionCode: "R",
        revision: "2",
        writerInitials: "DW",
      });
    }
    // A title that ends in a version-like token loses only the extension.
    expect(parsePdFilename("3 Client 2025-12-31 Title R1.LR.pdf")?.title).toBe("Title R1.LR");
  });

  it("reads a version with no initials right before a document extension", () => {
    expect(parsePdFilename("03 Cedarline 2025-12-31 T1.docx")).toEqual({
      projectNumber: "3",
      clientName: "Cedarline",
      fiscalYearEnd: "2025-12-31",
      versionCode: "T",
      revision: "1",
    });
    // The version is enough to anchor the name, as a version with initials is.
    expect(parsePdFilename("5 HaldenFoods r3.doc")).toEqual({
      projectNumber: "5",
      clientName: "Halden Foods",
      versionCode: "R",
      revision: "3",
    });
  });

  it("keeps a version with no initials as title anywhere else", () => {
    // Not the last token, or no document extension after it.
    expect(parsePdFilename("3 Client 2025-12-31 T1 Title.docx")).toMatchObject({ title: "T1 Title" });
    expect(parsePdFilename("3 Client 2025-12-31 T1")).toMatchObject({ title: "T1" });
    expect(parsePdFilename("3 Client 2025-12-31 T1.xlsx")).toMatchObject({ title: "T1" });
    expect(parsePdFilename("3 Client 2025-12-31 T1.docx")?.title).toBeUndefined();
    expect(parsePdFilename("3 Client T1 Title.docx")).toBeNull();
    expect(parsePdFilename("3 Client T1")).toBeNull();
  });

  it("still reads dotted initials when the name has no document extension", () => {
    expect(parsePdFilename("3 Client 2025-12-31 R1.LR.mo")).toMatchObject({
      writerInitials: "LR",
      reviewerInitials: "MO",
    });
    expect(parsePdFilename("3 Client 2025-12-31 T1.DW")).toMatchObject({ writerInitials: "DW" });
  });
});

describe("parsePdFilename on the firm's real name shapes (2026-11-17)", () => {
  // Made-up names in the exact shapes a dry run on the firm's files found:
  // "01 Word Word 2026-03-31 T0.AA.AA.AA WordWord.docx" and
  // "03 Word Word 2026-03-31 T0.AA.AA.AA.AA WordWord-WordWord.docx".
  it("reads a client part of two or more words, up to the date", () => {
    expect(parsePdFilename("01 Cedarline Systems 2025-03-31 T1.DW.PN LabelVisionCheck.docx")).toEqual({
      projectNumber: "1",
      clientName: "Cedarline Systems",
      fiscalYearEnd: "2025-03-31",
      versionCode: "T",
      revision: "1",
      writerInitials: "DW",
      reviewerInitials: "PN",
      title: "Label Vision Check",
    });
    expect(parsePdFilename("02 Halden Fine Foods 2024-12-31 R3.SO ShelfLife.docx")?.clientName).toBe("Halden Fine Foods");
    // Up to the version when there is no date.
    expect(parsePdFilename("02 Halden Foods S2.KT Title.docx")).toMatchObject({ clientName: "Halden Foods", writerInitials: "KT" });
    // Each word is split like a one-word client.
    expect(parsePdFilename("05 HaldenFoods Canada 2025-06-30 T1.DW Title.docx")?.clientName).toBe("Halden Foods Canada");
  });

  it("reads a version numbered 0", () => {
    expect(parsePdFilename("01 Cedarline Systems 2026-03-31 T0.DW.PN Title.docx")).toMatchObject({
      versionCode: "T",
      revision: "0",
      writerInitials: "DW",
      reviewerInitials: "PN",
    });
    expect(parsePdFilename("01 Cedarline Systems 2026-03-31 T0.docx")).toMatchObject({ versionCode: "T", revision: "0" });
  });

  it("reads a W (work in progress) version with or without initials", () => {
    expect(parsePdFilename("01 CadMakers 2020-02-02 W0.AD AutomatedMesh.docx")).toEqual({
      projectNumber: "1",
      clientName: "Cad Makers",
      fiscalYearEnd: "2020-02-02",
      versionCode: "W",
      revision: "0",
      writerInitials: "AD",
      title: "Automated Mesh",
    });
    expect(parsePdFilename("02 CadMakers 2020-02-02 w2.ad.mo Title.docx")).toMatchObject({
      versionCode: "W",
      revision: "2",
      writerInitials: "AD",
      reviewerInitials: "MO",
      reviewerInProgress: true,
    });
    expect(parsePdFilename("01 CadMakers 2020-02-02 W0.docx")).toMatchObject({
      versionCode: "W",
      revision: "0",
    });
  });

  it("unpacks three or four initials groups positionally into writer, reviewer, client, and financial slots", () => {
    expect(parsePdFilename("01 Cedarline Systems 2026-03-31 T0.DW.PN.KT LabelVision.docx")).toEqual({
      projectNumber: "1",
      clientName: "Cedarline Systems",
      fiscalYearEnd: "2026-03-31",
      versionCode: "T",
      revision: "0",
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
      initialsGroups: ["DW", "PN", "KT"],
      title: "Label Vision",
    });
    expect(parsePdFilename("03 Halden Foods 2026-03-31 T0.dw.pn.kt.so ColdChain-SensorDrift.docx")).toEqual({
      projectNumber: "3",
      clientName: "Halden Foods",
      fiscalYearEnd: "2026-03-31",
      versionCode: "T",
      revision: "0",
      writerInitials: "DW",
      reviewerInitials: "PN",
      reviewerInProgress: true,
      clientInitials: "KT",
      financialInitials: "SO",
      initialsGroups: ["DW", "PN", "KT", "SO"],
      title: "Cold Chain-Sensor Drift",
    });
    // One or two groups keep today's meaning and give no initialsGroups array.
    expect(parsePdFilename("01 Cedarline Systems 2026-03-31 T0.DW LabelVision.docx")?.initialsGroups).toBeUndefined();
    // Five groups are not a version token: they stay title text.
    expect(parsePdFilename("01 Cedarline Systems 2026-03-31 T0.DW.PN.KT.SO.AB Title.docx")).toMatchObject({
      title: "T0.DW.PN.KT.SO.AB Title",
    });
    // No extension: the last group is not mistaken for one.
    expect(parsePdFilename("01 Cedarline Systems 2026-03-31 T0.DW.PN.KT")).toMatchObject({
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
      initialsGroups: ["DW", "PN", "KT"],
    });
  });

  it("never reads a file extension as an initials group, and keeps one or two groups as writer and reviewer", () => {
    for (const extension of ["msg", "MSG", "eml", "rtf", "xlsx", "pptx", "docx", "doc", "pdf"]) {
      const parsed = parsePdFilename(`01 Cedarline Systems 2025-03-31 T1.DW.PN.${extension}`);
      expect(parsed, extension).toMatchObject({ versionCode: "T", revision: "1", writerInitials: "DW", reviewerInitials: "PN" });
      expect(parsed?.initialsGroups, extension).toBeUndefined();
    }
    expect(parsePdFilename("01 Cedarline Systems 2025-03-31 T1.DW.msg")).toMatchObject({ writerInitials: "DW" });
    expect(parsePdFilename("01 Cedarline Systems 2025-03-31 T1.DW.PN.msg")?.initialsGroups).toBeUndefined();
    // Three groups and an extension: unpacked plus initialsGroups.
    expect(parsePdFilename("01 Cedarline Systems 2025-03-31 T1.DW.PN.KT.msg")).toMatchObject({
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
      initialsGroups: ["DW", "PN", "KT"],
    });
    // Initials that are not a known extension, with no extension: still groups.
    expect(parsePdFilename("3 Client 2025-12-31 R1.LR.mo")).toMatchObject({
      writerInitials: "LR",
      reviewerInitials: "MO",
      reviewerInProgress: true,
    });
  });

  it("reads a title of hyphenated CamelCase words", () => {
    expect(parsePdFilename("03 Cedarline Systems 2026-03-31 T0.DW.PN LabelVision-ColdChain.docx")?.title).toBe(
      "Label Vision-Cold Chain"
    );
  });

  it("still needs a date or version right after the client words", () => {
    expect(parsePdFilename("3 Cedarline Systems Notes.docx")).toBeNull();
    expect(parsePdFilename("3 Cedarline Systems (copy) 2025-03-31 T1.DW.docx")).toBeNull();
    expect(parsePdFilename("3 Cedarline (Unclosed 2025-03-31 T1.DW.docx")).toBeNull();
    expect(parsePdFilename("3 Cedarline Systems) 2025-03-31 T1.DW.docx")).toBeNull();
    // More than six client words is not a scheme name.
    expect(parsePdFilename("3 A B C D E F G 2025-03-31 T1.DW Title.docx")).toBeNull();
    expect(parsePdFilename("3 A B C D E F 2025-03-31 T1.DW Title.docx")?.clientName).toBe("A B C D E F");
  });

  it("handles legal-suffix periods and parenthesized DBA names in the client part", () => {
    expect(
      parsePdFilename("01 NorthgateLabsInc. 2025-12-31 T0.DW.PN.KT AutomatedSensorCalibration.docx")
    ).toEqual({
      projectNumber: "1",
      clientName: "Northgate Labs Inc.",
      fiscalYearEnd: "2025-12-31",
      versionCode: "T",
      revision: "0",
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
      initialsGroups: ["DW", "PN", "KT"],
      title: "Automated Sensor Calibration",
    });
    expect(
      parsePdFilename("01 HaldenBrewingLtd. 2026-02-28 T0.DW.PN.KT.SO FermentationControl.docx")
    ).toMatchObject({
      projectNumber: "1",
      clientName: "Halden Brewing Ltd.",
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
      financialInitials: "SO",
      initialsGroups: ["DW", "PN", "KT", "SO"],
    });
    expect(
      parsePdFilename("01 1234567 Ontario (Cedar-Labs) 2024-06-30 T0.DW.PN.KT PerformanceScaling.docx")
    ).toEqual({
      projectNumber: "1",
      clientName: "1234567 Ontario (Cedar-Labs)",
      fiscalYearEnd: "2024-06-30",
      versionCode: "T",
      revision: "0",
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
      initialsGroups: ["DW", "PN", "KT"],
      title: "Performance Scaling",
    });
    expect(
      parsePdFilename("01 1234567 Ontario (Cedar Labs) 2024-06-30 T0.DW.PN Title.docx")?.clientName
    ).toBe("1234567 Ontario (Cedar Labs)");
  });

  it("tolerates a stray space after the version dot and capital O typed for version 0", () => {
    expect(
      parsePdFilename("01 NorthgateLabsInc. 2025-12-31 T0. DW.PN.KT SensorProtocols.docx")
    ).toEqual({
      projectNumber: "1",
      clientName: "Northgate Labs Inc.",
      fiscalYearEnd: "2025-12-31",
      versionCode: "T",
      revision: "0",
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
      initialsGroups: ["DW", "PN", "KT"],
      title: "Sensor Protocols",
    });
    // Without extension or title, collapsing the space prevents stripping the last initials group.
    expect(parsePdFilename("01 HaldenBrewingLtd. 2026-02-28 T0. DW.PN.KT")).toEqual({
      projectNumber: "1",
      clientName: "Halden Brewing Ltd.",
      fiscalYearEnd: "2026-02-28",
      versionCode: "T",
      revision: "0",
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
      initialsGroups: ["DW", "PN", "KT"],
    });
    // Capital O instead of 0 in a revision with initials parses as version 0.
    expect(
      parsePdFilename("02 Cedarline 2024-12-31 TO.DW.PN.KT AutomatedContentGeneration")
    ).toEqual({
      projectNumber: "2",
      clientName: "Cedarline",
      fiscalYearEnd: "2024-12-31",
      versionCode: "T",
      revision: "0",
      writerInitials: "DW",
      reviewerInitials: "PN",
      clientInitials: "KT",
      initialsGroups: ["DW", "PN", "KT"],
      title: "Automated Content Generation",
    });
    // Lowercase "To." is never treated as version T0.
    expect(parsePdFilename("02 Cedarline 2024-12-31 To.DW Title.docx")?.revision).toBeUndefined();
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
