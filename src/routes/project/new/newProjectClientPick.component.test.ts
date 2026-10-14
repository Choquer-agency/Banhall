import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import {
  __mutationCalls,
  __resetConvexStub,
  __setMutationResult,
  __setQueryData,
} from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";
import { mostRecentYearEnd } from "$lib/clients/usualYearEnd";
import { listClients, openTranscriptPaste, setInputValue, startButton } from "./newProjectTestSupport";

/**
 * Picking a client on New project (Paper W7 to W9; 2026-10-14 amendment,
 * "Pick a client on New project" and "Usual fiscal year end"). Start stays
 * blocked until the Client field holds a listed client; New client from the
 * field makes one and fills the field; a picked client's usual year end and
 * industry fill empty fields.
 */
const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
// The row's text without its screen-reader state prefix ("Done:", "To do:").
const clientRow = () =>
  text(document.querySelector('[data-checklist-row="client-title"]')).replace(/^[A-Za-z ]+: /, "");
const clientField = () => document.querySelector<HTMLInputElement>("#clientName")!;
const fiscalYear = () => text(document.querySelector("[data-fiscal-year]"));
const longDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

async function titleAndTranscript() {
  await expect.poll(() => document.querySelector("#title")).not.toBeNull();
  setInputValue("#title", "Adaptive cold storage controls");
  await openTranscriptPaste();
  setInputValue("#transcript", "Interviewer: What was uncertain?\nEngineer: The seal.");
}

beforeEach(async () => {
  await page.viewport(1440, 900);
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetConvexStub();
  takeProjectStart();
  __setPageUrl("/project/new");
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("tags:listTags", []);
  __setQueryData("projects:listIndustries", []);
  __setQueryData("clients:findSimilarClients", { exact: null, similar: [] });
});

describe("the Client field on New project", () => {
  it("blocks Start until the field holds a listed client (W8)", async () => {
    listClients("Cedarline Systems");
    await render(NewProjectPage, {});
    await titleAndTranscript();
    setInputValue("#clientName", "Northwind Robotics");
    await expect.poll(clientRow).toBe("Pick a client from the list");
    expect(startButton()?.disabled).toBe(true);

    setInputValue("#clientName", "cedarline systems");
    await expect.poll(clientRow).toBe("Client and title");
    await expect.poll(() => startButton()?.disabled).toBe(false);
  });

  it("says why Start is blocked in the tablet and phone bottom bar", async () => {
    for (const [width, height] of [[1024, 900], [390, 844]] as const) {
      await page.viewport(width, height);
      listClients("Cedarline Systems");
      const screen = await render(NewProjectPage, {});
      await titleAndTranscript();
      setInputValue("#clientName", "Northwind Robotics");
      await expect.poll(() => text(document.querySelector("[data-bottom-summary]"))).toBe("Pick a client from the list");
      expect(document.querySelector<HTMLButtonElement>("[data-bottom-start]")?.disabled).toBe(true);
      setInputValue("#clientName", "Cedarline Systems");
      await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-bottom-start]")?.disabled).toBe(false);
      await screen.unmount();
    }
  });

  it("makes a new client from the field, with this project's year end, and fills the field (W9)", async () => {
    __setPageUrl("/project/new?fye=2026-06-30");
    listClients("Cedarline Systems");
    __setMutationResult("clients:createClient", {
      clientId: "client-new",
      key: "northwind robotics",
      name: "Northwind Robotics",
    });
    await render(NewProjectPage, {});
    await titleAndTranscript();
    await userEvent.fill(clientField(), "Northwind Robotics");
    await expect
      .poll(() => text(document.querySelector("[data-client-no-match]")))
      .toBe("No client named Northwind Robotics Check the spelling, or add it as a new client.");
    await userEvent.click(document.querySelector<HTMLElement>("[data-new-client-option]")!);

    const dialog = page.getByRole("dialog", { name: "New client" });
    await expect.element(dialog).toBeInTheDocument();
    expect(text(dialog.element())).toContain("Once created, it fills the Client field on this project.");
    expect(document.querySelector<HTMLInputElement>("#new-client-name")!.value).toBe("Northwind Robotics");
    expect(document.querySelector<HTMLInputElement>("#new-client-year-end-month")!.value).toBe("June");
    expect(document.querySelector<HTMLInputElement>("#new-client-year-end-day")!.value).toBe("30");
    expect(text(document.querySelector("[data-year-end-helper]"))).toBe(
      "Filled from this project. New projects for this client start with it."
    );

    await userEvent.click(document.querySelector<HTMLButtonElement>("[data-create-client]")!);
    await expect.poll(() => __mutationCalls("clients:createClient")).toEqual([
      { name: "Northwind Robotics", fiscalYearEndMonth: 6, fiscalYearEndDay: 30 },
    ]);
    await expect.poll(() => clientField().value).toBe("Northwind Robotics");
    await expect.poll(clientRow).toBe("Client and title");
    await expect.poll(() => startButton()?.disabled).toBe(false);
  });

  it("offers no New client to a role that may not create projects", async () => {
    __setQueryData("users:getCurrentUser", { _id: "user-2", role: "financial", firstName: "Fran" });
    listClients("Cedarline Systems");
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("#clientName")).not.toBeNull();
    await userEvent.fill(clientField(), "Northwind Robotics");
    await expect
      .poll(() => text(document.querySelector("[data-client-no-match]")))
      .toBe("No client named Northwind Robotics Check the spelling.");
    expect(document.querySelector("[data-new-client-option]")).toBeNull();
  });

  it("fills an empty fiscal year and industry from the picked client, and takes them back when the pick changes", async () => {
    listClients({ name: "Cedarline Systems", fiscalYearEndMonth: 9, fiscalYearEndDay: 30, industry: "manufacturing" });
    await render(NewProjectPage, {});
    await expect.poll(() => document.querySelector("#clientName")).not.toBeNull();
    expect(fiscalYear()).toContain("Choose the year end");

    setInputValue("#clientName", "Cedarline Systems");
    const expected = mostRecentYearEnd(9, 30)!;
    await expect.poll(fiscalYear).toContain(longDate(expected));
    await expect.poll(() => document.querySelector<HTMLInputElement>("#industry")?.value).toBe("Manufacturing");

    setInputValue("#clientName", "Cedarline");
    await expect.poll(fiscalYear).toContain("Choose the year end");
    await expect.poll(() => document.querySelector<HTMLInputElement>("#industry")?.value).toBe("Not set (all industries)");
  });

  it("never replaces a fiscal year that is already set", async () => {
    __setPageUrl("/project/new?fye=2025-03-31");
    listClients({ name: "Cedarline Systems", fiscalYearEndMonth: 9, fiscalYearEndDay: 30 });
    await render(NewProjectPage, {});
    await expect.poll(fiscalYear).toContain("March 31, 2025");
    setInputValue("#clientName", "Cedarline Systems");
    await expect.poll(() => clientField().dataset.clientPicked).toBe("true");
    expect(fiscalYear()).toContain("March 31, 2025");
  });

  it("checks a ?client= prefill quietly while the list loads, then counts it as picked", async () => {
    __setPageUrl("/project/new?client=Cedarline%20Systems");
    await render(NewProjectPage, {});
    await titleAndTranscript();
    await expect.poll(() => clientField().value).toBe("Cedarline Systems");
    await expect.poll(clientRow).toBe("Checking the client list");
    expect(document.body.textContent).not.toContain("Pick a client from the list");
    expect(startButton()?.disabled).toBe(true);

    listClients("Cedarline Systems");
    await expect.poll(clientRow).toBe("Client and title");
    await expect.poll(() => startButton()?.disabled).toBe(false);
  });

  it("counts a duplicated project's client as picked once the list has it", async () => {
    __setPageUrl("/project/new?from=project-1");
    __setQueryData("projects:getProject", { _id: "project-1", title: "Alloy", clientName: "Forgeworks Inc.", mode: "generate" });
    listClients("Forgeworks Inc.");
    await render(NewProjectPage, {});
    await expect.poll(() => clientField().value).toBe("Forgeworks Inc.");
    await expect.poll(() => clientField().dataset.clientPicked).toBe("true");
    await expect.poll(clientRow).toBe("Client and title");
  });
});
