import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  __activeQueryArgs,
  __resetConvexStub,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import ReportRow from "./ReportRow.svelte";

beforeEach(() => {
  document.body.innerHTML = "";
  __resetConvexStub();
});

describe("alert row detail", () => {
  it("subscribes to the full report only while expanded", async () => {
    const id = "alert-1" as Id<"errorReports">;
    const report = {
      _id: id,
      kind: "auto" as const,
      reportType: "bug" as const,
      message: "Something broke",
      url: "/project/1",
      status: "open" as const,
      createdAt: Date.now(),
    };
    await render(ReportRow, { report });
    expect(__activeQueryArgs("errorReports:getError")).toEqual([]);
    expect(document.body.textContent).not.toContain("private stack");

    document.querySelector<HTMLButtonElement>("button")?.click();
    await expect.poll(() => __activeQueryArgs("errorReports:getError")).toEqual([{ id }]);
    expect(document.body.textContent).toContain("Loading details...");

    __setQueryData("errorReports:getError", {
      ...report,
      stack: "private stack",
      source: "client",
      userNote: "private note",
      breadcrumbs: [{ type: "click", label: "Save", at: 1 }],
    });
    await expect.poll(() => document.body.textContent).toContain("private stack");
    expect(document.body.textContent).toContain("private note");

    document.querySelector<HTMLButtonElement>("button")?.click();
    await expect.poll(() => __activeQueryArgs("errorReports:getError")).toEqual([]);
  });
});
