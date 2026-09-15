import { beforeEach, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetAuthState } from "$lib/test/convex-auth-state-stub.svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { takeProjectStart } from "$lib/workspace/projectIntentHandoff";

/**
 * PD file-name prefill (writer request 2026-09-09): in review mode a PD named
 * by the firm's scheme fills the empty project number, client, fiscal
 * year-end and titles, shows a dismissible hint, and never overwrites a value
 * the writer already typed. Initials never become an Owner or writer.
 */
const PD_NAME =
  "03 3GAMarine 2025-12-31 R1.LR.mo MarineBatteryElectricalandThermalBehaviourAdvancements.txt";
const HINT = "Filled from the file name: project 3 · 3GA Marine · FYE 2025-12-31 · title · R1 · writer LR · reviewer MO";

const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`);
function type(id: string, value: string) {
  const input = field(id);
  if (!input) throw new Error(`Missing field #${id}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openReviewMode() {
  await render(NewProjectPage, {});
  await expect.poll(() => field("title")).not.toBeNull();
  const radio = document.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="false"]');
  if (!radio) throw new Error("Missing review mode");
  radio.click();
  await expect.poll(() => document.body.textContent).toContain("Written PD to review");
}

async function dropPd(name: string) {
  // The PD slot is the only single-file input that is not the .docx-only transcript input.
  const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([multiple]):not([accept=".docx"])');
  if (!input) throw new Error("Missing PD input");
  const transfer = new DataTransfer();
  transfer.items.add(new File(["Experimental development of a marine battery."], name));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await expect.poll(() => document.body.textContent).toContain("words extracted");
}

beforeEach(() => {
  localStorage.clear();
  __resetPage();
  __resetNavigation();
  __resetAuthState();
  __resetConvexStub();
  takeProjectStart();
  __setPageUrl("/project/new");
  __setQueryData("users:getCurrentUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("users:getMyUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  __setQueryData("tags:listTags", []);
});

it("fills the empty fields from a scheme-named PD and shows the hint", async () => {
  await openReviewMode();
  await dropPd(PD_NAME);

  await expect.poll(() => field("projectNumber")?.value).toBe("3");
  expect(field("clientName")?.value).toBe("3GA Marine");
  expect(field("sredTitle")?.value).toBe("Marine Battery Electricaland Thermal Behaviour Advancements");
  expect(field("title")?.value).toBe("Marine Battery Electricaland Thermal Behaviour Advancements");
  expect(document.querySelector("#fiscalYearEnd")?.textContent).toContain("December 31, 2025");
  // Initials are informational only (hint text), never a person field.
  expect(document.body.textContent).toContain(HINT);
});

it("never overwrites what the writer already typed", async () => {
  await openReviewMode();
  type("clientName", "Acme Labs");
  type("title", "Internal name");
  await dropPd(PD_NAME);

  await expect.poll(() => field("projectNumber")?.value).toBe("3");
  expect(field("clientName")?.value).toBe("Acme Labs");
  expect(field("title")?.value).toBe("Internal name");
  expect(field("sredTitle")?.value).toBe("Marine Battery Electricaland Thermal Behaviour Advancements");
  expect(document.body.textContent).toContain(
    // The SR&ED title was still empty, so "title" stays in the hint.
    "Filled from the file name: project 3 · FYE 2025-12-31 · title · R1 · writer LR · reviewer MO"
  );
});

it("dismisses the hint and clears it with the file; a non-scheme name shows none", async () => {
  await openReviewMode();
  await dropPd(PD_NAME);
  await expect.poll(() => document.body.textContent).toContain("Filled from the file name");
  document.querySelector<HTMLButtonElement>('[aria-label="Dismiss the file-name hint"]')?.click();
  await expect.poll(() => document.body.textContent).not.toContain("Filled from the file name");

  document.querySelector<HTMLButtonElement>('[aria-label="Remove file"]')?.click();
  await expect.poll(() => document.body.textContent).not.toContain("words extracted");
  await dropPd("Final Report.txt");
  expect(document.body.textContent).not.toContain("Filled from the file name");
  // Fields filled by the first file are the writer's now and stay put.
  expect(field("clientName")?.value).toBe("3GA Marine");
});
