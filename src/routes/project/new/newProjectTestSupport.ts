/**
 * Shared steps for the New project component suites (round 2, E1): the page
 * starts through the right column's start button (the bottom bar below
 * desktop) and the start dialog's confirm (F1, G1 to G3).
 */
import { expect } from "vitest";
import { userEvent } from "vitest/browser";

export const startButton = () =>
  document.querySelector<HTMLButtonElement>("[data-start-button], [data-bottom-start]");

export const confirmButton = () => document.querySelector<HTMLButtonElement>("[data-start-run-confirm]");

/** Opens the start dialog once the start button is enabled. */
export async function openStartDialog() {
  await expect.poll(() => startButton()?.disabled).toBe(false);
  startButton()!.click();
  await expect.poll(() => confirmButton()).not.toBeNull();
}

/** Opens the start dialog and confirms it with every file ticked. */
export async function startFromPage() {
  await openStartDialog();
  await expect.poll(() => confirmButton()?.disabled).toBe(false);
  confirmButton()!.click();
}

export function setInputValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!field) throw new Error(`Missing ${selector}`);
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Title and client, the two fields every start needs. */
export async function fillBasics(title = "Solar tracker", client = "Acme Labs") {
  await expect.poll(() => document.querySelector("#title")).not.toBeNull();
  setInputValue("#title", title);
  setInputValue("#clientName", client);
}

/** Opens the paste box under the transcript drop zone. */
export async function openTranscriptPaste() {
  await expect.poll(() => document.querySelector("[data-open-paste]")).not.toBeNull();
  document.querySelector<HTMLButtonElement>("[data-open-paste]")!.click();
  await expect.poll(() => document.querySelector("#transcript")).not.toBeNull();
}

/** Adds pasted text as a supporting document through the Add menu (E2). */
export async function pasteSupportingText(text: string) {
  await userEvent.click(document.querySelector<HTMLElement>("[data-add-supporting]")!);
  await expect.poll(() => document.querySelector("[data-add-paste]")).not.toBeNull();
  await userEvent.click(document.querySelector<HTMLElement>("[data-add-paste]")!);
  await expect.poll(() => document.querySelector('textarea[aria-label="Pasted text"]')).not.toBeNull();
  setInputValue('textarea[aria-label="Pasted text"]', text);
  await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-add-pasted]")?.disabled).toBe(false);
  document.querySelector<HTMLButtonElement>("[data-add-pasted]")!.click();
}

/** Adds files as supporting documents through the hidden input. */
export function addSupportingFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>("[data-supporting-input]");
  if (!input) throw new Error("Missing supporting documents input");
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Picks a chip on a supporting document card (Previous-year reports, Transcript...). */
export async function setDocumentCategory(fileName: string, label: string) {
  const card = () =>
    [...document.querySelectorAll<HTMLElement>("[data-supporting-card]")].find((node) =>
      node.textContent?.includes(fileName)
    );
  await expect.poll(() => card()).not.toBeUndefined();
  await userEvent.click(card()!.querySelector<HTMLElement>("[data-category-chip]")!);
  const option = () =>
    [...document.querySelectorAll<HTMLElement>("[data-category-option]")].find(
      (node) => node.textContent?.trim() === label
    );
  await expect.poll(() => option()).not.toBeUndefined();
  await userEvent.click(option()!);
  await expect.poll(() => card()?.querySelector("[data-category-chip]")?.textContent?.trim()).toBe(label);
}

/** Switches Write a new PD / Review a written PD. */
export async function chooseMode(label: "Write a new PD" | "Review a written PD") {
  const radio = () =>
    [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Project mode"] [role="radio"]')].find(
      (button) => button.textContent?.trim() === label || (label === "Review a written PD" && button.textContent?.trim() === "Review a PD")
    );
  await expect.poll(() => radio()).not.toBeUndefined();
  radio()!.click();
  await expect.poll(() => radio()?.getAttribute("aria-checked")).toBe("true");
}
