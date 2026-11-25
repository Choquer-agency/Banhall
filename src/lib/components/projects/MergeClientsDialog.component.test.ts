import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import MergeClientsDialog from "./MergeClientsDialog.svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { __resetAuthState } from "$lib/test/convex-auth-stub";

/**
 * Merge clients and its company files (2026-11-18, a company holds all its
 * files; review P3-7): no file count refuses a merge any more. Up to 100
 * files move at once; past that the dialog says the rest move over a few
 * minutes and drafts wait; past 500 it says "More than 500".
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

const clients = [
  { key: "acuity insights", clientId: "c1", name: "Acuity Insights", projectCount: 4 },
  { key: "acuity inc", clientId: "c2", name: "Acuity Inc", projectCount: 1 },
];

function preview(overrides: Record<string, unknown> = {}) {
  return {
    projectCount: 5,
    movedCount: 1,
    tooMany: false,
    keptName: "Acuity Insights",
    keptKey: "acuity insights",
    nameConflict: null,
    numberCollisions: [],
    collisionCheckIncomplete: false,
    companyFileCount: 0,
    moreCompanyFiles: false,
    tooManyCompanyFiles: false,
    companyContactCount: 0,
    tooManyCompanyContacts: false,
    ...overrides,
  };
}

beforeEach(() => {
  __resetConvexStub();
  __resetAuthState();
});

async function open(previewData: Record<string, unknown>) {
  __setQueryData("clients:previewClientMerge", previewData);
  await page.viewport(1280, 900);
  await render(MergeClientsDialog, { open: true, clients });
  await expect.poll(() => document.querySelector("[data-merge-summary]")).not.toBeNull();
}

describe("the merge dialog's company files line", () => {
  it("100 files or fewer move with the merge, said plainly", async () => {
    await open(preview({ companyFileCount: 100 }));
    expect(text(document.querySelector("[data-merge-company-files]"))).toBe("100 company files move to Acuity Insights too.");
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-confirm-merge]")?.disabled).toBe(false);
  });

  it("one file reads as one", async () => {
    await open(preview({ companyFileCount: 1 }));
    expect(text(document.querySelector("[data-merge-company-files]"))).toBe("1 company file moves to Acuity Insights too.");
  });

  it("101 to 500 files: the first 100 move now and drafts wait for the rest", async () => {
    await open(preview({ companyFileCount: 340 }));
    expect(text(document.querySelector("[data-merge-company-files]"))).toBe(
      "340 company files move to Acuity Insights too. The first 100 move now and the rest over the next few minutes. Drafts for Acuity Insights wait until they are all there."
    );
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-confirm-merge]")?.disabled).toBe(false);
  });

  it("past 500 files it says more than 500, and nothing refuses the merge", async () => {
    await open(preview({ companyFileCount: 500, moreCompanyFiles: true }));
    expect(text(document.querySelector("[data-merge-company-files]"))).toBe(
      "More than 500 company files move to Acuity Insights too. The first 100 move now and the rest over the next few minutes. Drafts for Acuity Insights wait until they are all there."
    );
    expect(document.querySelector('[data-merge-error="too-many-files"]')).toBeNull();
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-confirm-merge]")?.disabled).toBe(false);
    expect(text(document.body)).not.toMatch(/[\u2010-\u2015]/);
  });

  it("no files: no files line", async () => {
    await open(preview());
    expect(document.querySelector("[data-merge-company-files]")).toBeNull();
  });
});
