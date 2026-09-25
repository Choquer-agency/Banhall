import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { Toaster } from "svelte-sonner";
import DetailsPanel from "./DetailsPanel.svelte";
import DetailsPopover from "./DetailsPopover.svelte";
import { __resetConvexStub } from "$lib/test/convex-svelte-stub.svelte";
import type { DetailsPanelData, TeamMember } from "./types";

/**
 * Details panel states (ui-design-final.md section 8; board 5.1y rows A to C,
 * card V1). The panel takes the getProjectDetailsPanel shape as props, so each
 * state renders from data alone.
 */
const NOW = Date.now();

function data(overrides: Partial<DetailsPanelData> = {}): DetailsPanelData {
  return {
    stage: "drafting",
    workflowVersion: 4,
    industry: "manufacturing",
    fiscalYearEnd: new Date(2026, 5, 30).getTime(),
    scienceCode: "2.03.01",
    projectNumber: "1A",
    owner: { userId: "u-jordan" as never, label: "Jordan Ellis", initials: "JE", isYou: true },
    createdAt: new Date(2026, 8, 17).getTime(),
    editedAt: NOW - 12 * 60_000,
    currentHandoff: null,
    permissions: { canEditDetails: true, canChangeStage: true, canHandOff: true },
    viewerAuthorities: ["owner"],
    ...overrides,
  };
}

const TEAM: TeamMember[] = [
  { userId: "u-jordan" as never, label: "Jordan Ellis", initials: "JE", isYou: true },
  { userId: "u-sam" as never, label: "Sam Chen", initials: "SC", isYou: false },
  { userId: "u-priya" as never, label: "Priya Rao", initials: "PR", isYou: false },
];

function mount(overrides: Partial<DetailsPanelData> = {}, props: Record<string, unknown> = {}) {
  const onChangeStage = vi.fn(async () => {});
  const onHandOff = vi.fn(async () => {});
  const onSaveFiscalYear = vi.fn(async () => {});
  const onSaveScienceCode = vi.fn(async () => {});
  const onSaveProjectNumber = vi.fn(async (_value: string) => {});
  const onClose = vi.fn();
  const screen = render(DetailsPanel, {
    data: data(overrides),
    team: TEAM,
    onChangeStage,
    onHandOff,
    onSaveFiscalYear,
    onSaveScienceCode,
    onSaveProjectNumber,
    onClose,
    ...props,
  });
  return { screen, onChangeStage, onHandOff, onSaveFiscalYear, onSaveScienceCode, onSaveProjectNumber, onClose };
}

const statusLine = () => document.querySelector<HTMLElement>("[data-details-status-line]")!;
const fact = (name: string) => document.querySelector<HTMLElement>(`[data-details-fact="${name}"]`)!;

describe("Details panel", () => {
  beforeEach(async () => {
    __resetConvexStub();
    document.body.innerHTML = "";
    await page.viewport(1280, 900);
  });

  it("shows the stage alone when no handoff is open, never the Owner", async () => {
    await mount();
    await expect.poll(() => statusLine()).not.toBeNull();
    expect(statusLine().textContent?.trim()).toBe("Drafting");
    expect(statusLine().textContent).not.toContain("with");
    expect(statusLine().textContent).not.toContain("Jordan");
    expect(page.getByRole("heading", { name: "Details", exact: true }).elements()).toHaveLength(1);
  });

  it("reads '[stage] with [person]' and shows the handoff note with its hairline", async () => {
    await mount({
      stage: "internal_review",
      currentHandoff: {
        workItemId: "wi-1" as never,
        assigneeId: "u-sam" as never,
        assigneeLabel: "Sam Chen",
        initials: "SC",
        isYou: false,
        note: "Please check 244 against the interview.",
      },
    });
    await expect.poll(() => statusLine()?.textContent).toContain("with");
    expect(statusLine().textContent?.replace(/\s+/g, " ").trim()).toBe("Internal review with S Sam Chen");
    const note = document.querySelector<HTMLElement>("[data-details-handoff-note]")!;
    expect(note.textContent).toBe("Please check 244 against the interview.");
    expect(note.className).toContain("border-l-2");
    // Both actions are borderless secondary buttons.
    for (const name of ["Change stage", "Hand off"]) {
      const button = page.getByRole("button", { name, exact: true }).element() as HTMLElement;
      expect(button.className).toContain("bg-chrome");
      expect(getComputedStyle(button).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    }
  });

  it("puts the fiscal year on one line with its calendar icon, and the science code label with the muted code", async () => {
    await mount();
    await expect.poll(() => fact("fiscal-year")).not.toBeNull();
    const fiscal = fact("fiscal-year").querySelector<HTMLElement>("[data-fiscal-year-value]")!;
    expect(fiscal.textContent?.replace(/\s+/g, " ").trim()).toBe("2026 (June 30, 2026)");
    const rect = fiscal.getBoundingClientRect();
    expect(rect.height).toBeLessThan(24);
    expect(fact("fiscal-year").querySelector("svg")).not.toBeNull();
    const science = fact("science-code");
    expect(science.textContent).toContain("Mechanical engineering");
    expect(science.querySelector(".font-mono")?.textContent).toBe("2.03.01");
    expect(fact("created").textContent).toBe("Sep 17, 2026");
    expect(fact("edited").textContent).toBe("12 min ago");
    expect(fact("owner").textContent).toContain("Jordan Ellis (you)");
  });

  it("lays the panel out on the board 5.1 grid", async () => {
    await mount();
    await expect.poll(() => statusLine()).not.toBeNull();
    const panel = document.querySelector<HTMLElement>("[data-details-panel]")!.getBoundingClientRect();
    const header = document.querySelector<HTMLElement>("[data-details-panel] header")!.getBoundingClientRect();
    expect(Math.round(header.top - panel.top)).toBe(20);
    expect(Math.round(header.height)).toBe(28);
    const close = page.getByRole("button", { name: "Close details", exact: true }).element().getBoundingClientRect();
    expect(Math.round(close.width)).toBe(26);
    expect(Math.round(panel.right - close.right)).toBe(24);

    const card = document.querySelector<HTMLElement>("[data-details-status]")!;
    const cardBox = card.getBoundingClientRect();
    expect(Math.round(cardBox.left - panel.left)).toBe(24);
    expect(Math.round(cardBox.top - header.bottom)).toBe(18);
    expect(getComputedStyle(card).paddingTop).toBe("14px");
    const chip = statusLine().querySelector<HTMLElement>("[data-stage-badge]")!;
    expect(Math.round(chip.getBoundingClientRect().height)).toBe(24);
    expect(getComputedStyle(chip).borderTopLeftRadius).toBe("6px");
    for (const name of ["Change stage", "Hand off"]) {
      const button = page.getByRole("button", { name, exact: true }).element();
      expect(Math.round(button.getBoundingClientRect().height)).toBe(32);
      expect(getComputedStyle(button).fontSize).toBe("13px");
    }

    // Facts: 34px rows inset 8px, a 104px label column, values 12px after it.
    const dt = document.querySelector<HTMLElement>("[data-details-facts] dt")!.getBoundingClientRect();
    const value = fact("industry").getBoundingClientRect();
    expect(Math.round(dt.left - cardBox.left)).toBe(8);
    expect(Math.round(value.left - dt.left)).toBe(116);
    expect(Math.round(value.height)).toBe(34);
    expect(Math.round(value.top - cardBox.bottom)).toBe(18);
  });

  it("keeps the calendar icon and plain values when details are read only", async () => {
    await mount({ permissions: { canEditDetails: false, canChangeStage: false, canHandOff: false } }, {
      changeStageReason: "Only the Owner, a Manager or an Admin can change the stage.",
    });
    await expect.poll(() => fact("fiscal-year")).not.toBeNull();
    expect(fact("fiscal-year").querySelector("button")).toBeNull();
    expect(fact("fiscal-year").querySelector("svg")).not.toBeNull();
    expect(page.getByRole("button", { name: "Edit science code" }).elements()).toHaveLength(0);
    expect((page.getByRole("button", { name: "Change stage", exact: true }).element() as HTMLButtonElement).disabled).toBe(true);
    expect((page.getByRole("button", { name: "Hand off", exact: true }).element() as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("[data-details-status]")?.textContent).toContain(
      "Only the Owner, a Manager or an Admin can change the stage."
    );
  });

  it("opens the fiscal year calendar with quick picks and the helper line, and saves a quick pick", async () => {
    const { onSaveFiscalYear } = await mount();
    await page.getByRole("button", { name: "Edit fiscal year", exact: true }).click();
    await expect.element(page.getByText("The fiscal year takes the year of its end date.")).toBeVisible();
    await expect.element(page.getByText("Year end", { exact: true })).toBeVisible();
    const picks = Array.from(document.querySelectorAll("[data-date-quick-picks] button")).map((b) => b.textContent?.trim());
    expect(picks).toEqual(["Mar 31", "Jun 30", "Sep 30", "Dec 31"]);
    await page.getByRole("button", { name: "Dec 31", exact: true }).click();
    await expect.poll(() => onSaveFiscalYear.mock.calls.length).toBe(1);
    expect(onSaveFiscalYear).toHaveBeenCalledWith(new Date(2026, 11, 31).getTime());
  });

  it("opens the science code picker grouped by field with the current code checked", async () => {
    const { onSaveScienceCode } = await mount();
    await page.getByRole("button", { name: "Edit science code", exact: true }).click();
    const search = page.getByPlaceholder("Search by name or code");
    await expect.element(search).toBeVisible();
    const headings = Array.from(document.querySelectorAll("[data-command-group-heading]")).map((h) => h.textContent?.trim());
    expect(headings).toContain("Mechanical engineering");
    expect(headings.every((heading) => !heading?.includes("\u2014"))).toBe(true);
    const current = document.querySelector<HTMLElement>("[data-science-code-current]")!;
    expect(current.textContent).toContain("2.03.01");
    expect(current.querySelector("svg")).not.toBeNull();
    await search.fill("robotics");
    await expect.poll(() => document.querySelectorAll("[data-command-item]").length).toBe(1);
    (document.querySelector("[data-command-item]") as HTMLElement).click();
    await expect.poll(() => onSaveScienceCode.mock.calls.length).toBe(1);
    expect(onSaveScienceCode).toHaveBeenCalledWith("2.02.02");
  });

  it("opens the science code picker on the current code, its field at the top of the list", async () => {
    await mount();
    await page.getByRole("button", { name: "Edit science code", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-science-code-current]")).not.toBeNull();
    const current = document.querySelector<HTMLElement>("[data-science-code-current]")!;
    await expect.poll(() => current.hasAttribute("data-selected")).toBe(true);
    const list = current.closest<HTMLElement>("[data-command-list]")!;
    const group = current.closest<HTMLElement>("[data-command-group]")!;
    await expect.poll(() => list.scrollTop).toBeGreaterThan(0);
    expect(Math.abs(group.getBoundingClientRect().top - list.getBoundingClientRect().top)).toBeLessThan(2);
    expect(group.querySelector("[data-command-group-heading]")?.textContent?.trim()).toBe("Mechanical engineering");
  });

  it("edits the project number in place: Enter saves, Escape cancels", async () => {
    const { onSaveProjectNumber } = await mount();
    await expect.poll(() => fact("project-number")).not.toBeNull();
    expect(fact("project-number").textContent?.trim()).toBe("1A");
    await page.getByRole("button", { name: "Edit project number", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Edit project number" });
    await expect.element(input).toHaveValue("1A");
    await input.fill("P01-A");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => onSaveProjectNumber.mock.calls.length).toBe(1);
    expect(onSaveProjectNumber).toHaveBeenCalledWith("P01-A");
    await expect.poll(() => fact("project-number").querySelector("input")).toBeNull();

    await page.getByRole("button", { name: "Edit project number", exact: true }).click();
    await page.getByRole("textbox", { name: "Edit project number" }).fill("Z9");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => fact("project-number").querySelector("input")).toBeNull();
    expect(onSaveProjectNumber).toHaveBeenCalledTimes(1);
  });

  it("keeps the project number editor open with the error when the save fails", async () => {
    const onSaveProjectNumber = vi.fn(async () => {
      throw new Error("That project number is already in use.");
    });
    await mount({}, { onSaveProjectNumber });
    await page.getByRole("button", { name: "Edit project number", exact: true }).click();
    await page.getByRole("textbox", { name: "Edit project number" }).fill("2B");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("alert")).toHaveTextContent("That project number is already in use.");
    expect(fact("project-number").querySelector("input")).not.toBeNull();
  });

  it("lists every stage grouped, with Submitted and Delivered disabled as not available yet", async () => {
    await mount();
    await page.getByRole("button", { name: "Change stage", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-stage-menu]")).not.toBeNull();
    const groups = Array.from(document.querySelectorAll("[data-stage-menu] [role=group]")).map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["In progress", "Done", "Paused"]);
    expect(document.querySelectorAll("[data-stage-menu-option]")).toHaveLength(11);
    const option = (stage: string) => document.querySelector<HTMLButtonElement>(`[data-stage-menu-option="${stage}"]`)!;
    expect(option("drafting").getAttribute("aria-checked")).toBe("true");
    expect(option("internal_review").textContent).toContain("next");
    for (const stage of ["ready_for_delivery", "delivered"]) {
      expect(option(stage).disabled).toBe(true);
      expect(option(stage).textContent).toContain("not available yet");
    }
    expect(option("on_hold").textContent).toContain("asks for a reason");
  });

  it("applies a plain move at once and confirms it with a bottom toast", async () => {
    await render(Toaster, { position: "top-right" });
    const { onChangeStage } = await mount();
    await page.getByRole("button", { name: "Change stage", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-stage-menu-option='internal_review']")).not.toBeNull();
    document.querySelector<HTMLButtonElement>("[data-stage-menu-option='internal_review']")!.click();
    await expect.poll(() => onChangeStage.mock.calls.length).toBe(1);
    expect(onChangeStage).toHaveBeenCalledWith("internal_review", undefined);
    await expect.element(page.getByText("Moved to Internal review", { exact: true })).toBeVisible();
    const list = page.getByText("Moved to Internal review", { exact: true }).element().closest("[data-sonner-toaster]");
    expect(list?.getAttribute("data-y-position")).toBe("bottom");
  });

  it("turns the card into an inline reason step for a note-required move", async () => {
    const { onChangeStage } = await mount();
    await page.getByRole("button", { name: "Change stage", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-stage-menu-option='on_hold']")).not.toBeNull();
    document.querySelector<HTMLButtonElement>("[data-stage-menu-option='on_hold']")!.click();
    await expect.element(page.getByText("Why is it on hold?", { exact: true })).toBeVisible();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    const confirm = page.getByRole("button", { name: "Put on hold", exact: true });
    expect((confirm.element() as HTMLButtonElement).disabled).toBe(true);
    await page.getByRole("textbox", { name: "Why is it on hold?" }).fill("Waiting on the client for the payroll numbers.");
    await confirm.click();
    await expect.poll(() => onChangeStage.mock.calls.length).toBe(1);
    expect(onChangeStage).toHaveBeenCalledWith("on_hold", "Waiting on the client for the payroll numbers.");
    await expect.poll(() => document.querySelector("[data-stage-step]")).toBeNull();
  });

  it("keeps the review decision step on the internal-review completion edge", async () => {
    const { onChangeStage } = await mount({ stage: "internal_review" });
    await page.getByRole("button", { name: "Change stage", exact: true }).click();
    await expect.poll(() => document.querySelector("[data-stage-menu-option='edits']")).not.toBeNull();
    document.querySelector<HTMLButtonElement>("[data-stage-menu-option='edits']")!.click();
    await expect.poll(() => document.querySelector("[data-stage-step='decision']")).not.toBeNull();
    expect(onChangeStage).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Return for edits", exact: true }).click();
    await expect.poll(() => onChangeStage.mock.calls.length).toBe(1);
    expect(onChangeStage).toHaveBeenCalledWith("edits", undefined);
  });

  it("hands off to a person and a stage without a due date, and confirms with a toast", async () => {
    await render(Toaster, { position: "top-right" });
    const { onHandOff } = await mount();
    await page.getByRole("button", { name: "Hand off", exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "Hand off", exact: true })).toBeVisible();
    expect(page.getByRole("button", { name: "Back to details", exact: true }).elements()).toHaveLength(1);
    const view = document.querySelector<HTMLElement>("[data-hand-off-view]")!;
    expect(view.textContent).not.toMatch(/due/i);
    expect(view.querySelector('input[type="date"]')).toBeNull();
    // Stage defaults to the next In progress stage.
    expect(document.querySelector("[data-hand-off-stage]")?.textContent).toContain("Internal review");
    expect(view.textContent).toContain("Keep Drafting if it should not move.");
    // The team list puts the viewer last.
    document.querySelector<HTMLButtonElement>("[data-hand-off-to]")!.click();
    await expect.poll(() => document.querySelectorAll("[data-command-item]").length).toBe(3);
    const people = Array.from(document.querySelectorAll("[data-command-item]")).map((item) => item.textContent?.trim());
    expect(people).toEqual(["S Sam Chen", "P Priya Rao", "J Jordan Ellis (you)"]);
    (document.querySelectorAll<HTMLElement>("[data-command-item]")[0]).click();
    await expect.element(page.getByText("Sam sees it under With you on their home page.", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Note (optional)" }).fill("Please check 244.");
    await page.getByRole("button", { name: "Hand off", exact: true }).click();
    await expect.poll(() => onHandOff.mock.calls.length).toBe(1);
    expect(onHandOff).toHaveBeenCalledWith({
      assigneeId: "u-sam",
      assigneeLabel: "Sam Chen",
      stage: "internal_review",
      note: "Please check 244.",
    });
    await expect.element(page.getByText("Handed off to Sam Chen", { exact: true })).toBeVisible();
    await expect.poll(() => document.querySelector("[data-hand-off-view]")).toBeNull();
  });

  it("lets a hand off keep the current stage and asks for a reason on a note-required stage", async () => {
    const { onHandOff } = await mount();
    await page.getByRole("button", { name: "Hand off", exact: true }).click();
    document.querySelector<HTMLButtonElement>("[data-hand-off-stage]")!.click();
    await expect.poll(() => document.querySelector("[data-hand-off-stage-option='drafting']")).not.toBeNull();
    expect(document.querySelector("[data-hand-off-stage-option='drafting']")?.textContent).toContain("keep current");
    expect(document.querySelector("[data-hand-off-stage-option='ready_for_delivery']")).toBeNull();
    document.querySelector<HTMLButtonElement>("[data-hand-off-stage-option='on_hold']")!.click();
    await expect.element(page.getByText("Reason (required)", { exact: true })).toBeVisible();
    document.querySelector<HTMLButtonElement>("[data-hand-off-to]")!.click();
    await expect.poll(() => document.querySelectorAll("[data-command-item]").length).toBe(3);
    (document.querySelectorAll<HTMLElement>("[data-command-item]")[1]).click();
    const submit = () => document.querySelector<HTMLButtonElement>("[data-hand-off-submit]")!;
    expect(submit().disabled).toBe(true);
    await page.getByRole("textbox", { name: "Reason (required)" }).fill("Client is travelling.");
    await expect.poll(() => submit().disabled).toBe(false);
    submit().click();
    await expect.poll(() => onHandOff.mock.calls.length).toBe(1);
    expect(onHandOff).toHaveBeenCalledWith(expect.objectContaining({ stage: "on_hold", note: "Client is travelling." }));
  });

  it("never offers a hand-off stage the server refuses", async () => {
    await mount();
    await page.getByRole("button", { name: "Hand off", exact: true }).click();
    document.querySelector<HTMLButtonElement>("[data-hand-off-stage]")!.click();
    await expect.poll(() => document.querySelector("[data-hand-off-stage-option='drafting']")).not.toBeNull();
    // A handoff opens work, so Abandoned is never a hand-off stage.
    expect(document.querySelector("[data-hand-off-stage-option='abandoned']")).toBeNull();
    expect(document.querySelector("[data-hand-off-stage-option='on_hold']")).not.toBeNull();
    document.body.innerHTML = "";

    // A Delivered project cannot stay Delivered: the view picks a stage it may move to.
    const { onHandOff } = await mount({ stage: "delivered", viewerAuthorities: ["manager"] });
    await page.getByRole("button", { name: "Hand off", exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "Hand off", exact: true })).toBeVisible();
    expect(document.querySelector("[data-hand-off-stage]")?.textContent).not.toContain("Delivered");
    document.querySelector<HTMLButtonElement>("[data-hand-off-stage]")!.click();
    await expect.poll(() => document.querySelectorAll("[data-hand-off-stage-option]").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-hand-off-stage-option='delivered']")).toBeNull();
    expect(document.querySelector("[data-hand-off-stage-option='abandoned']")).toBeNull();
    expect(onHandOff).not.toHaveBeenCalled();
  });

  it("keeps the hand off view open with the error when the save fails", async () => {
    const onHandOff = vi.fn(async () => {
      throw new Error("You cannot move this project to Internal review");
    });
    await mount({}, { onHandOff });
    await page.getByRole("button", { name: "Hand off", exact: true }).click();
    document.querySelector<HTMLButtonElement>("[data-hand-off-to]")!.click();
    await expect.poll(() => document.querySelectorAll("[data-command-item]").length).toBe(3);
    (document.querySelectorAll<HTMLElement>("[data-command-item]")[0]).click();
    await expect.poll(() => document.querySelector<HTMLButtonElement>("[data-hand-off-submit]")?.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>("[data-hand-off-submit]")!.click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("You cannot move this project to Internal review");
    expect(document.querySelector("[data-hand-off-view]")).not.toBeNull();
  });

  it("closes from its header and shows the loading state before data arrives", async () => {
    const onClose = vi.fn();
    await render(DetailsPanel, { data: undefined, onChangeStage: vi.fn(), onHandOff: vi.fn(), onClose });
    expect(document.querySelector("[aria-busy=true]")).not.toBeNull();
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Details popover", () => {
  beforeEach(() => {
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("peeks the status line, fiscal year, science code, owner and edited, and opens all details", async () => {
    const anchor = document.createElement("button");
    anchor.textContent = "i";
    document.body.append(anchor);
    const onOpenAll = vi.fn();
    // `anchor` is also a Svelte mount option, so props go under `props`.
    await render(DetailsPopover, { props: {
      data: data({
        stage: "internal_review",
        currentHandoff: {
          workItemId: "wi-1" as never,
          assigneeId: "u-sam" as never,
          assigneeLabel: "Sam Chen",
          initials: "SC",
          isYou: false,
          note: "",
        },
      }),
      anchor,
      open: true,
      onOpenAll,
    } });
    const popover = () => document.querySelector<HTMLElement>("[data-details-popover]");
    await expect.poll(() => popover()).not.toBeNull();
    expect(popover()!.getBoundingClientRect().width).toBe(360);
    const text = popover()!.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("Internal review with S Sam Chen");
    expect(text).toContain("2026 (June 30, 2026)");
    expect(text).toContain("Mechanical engineering 2.03.01");
    expect(text).toContain("Jordan Ellis (you)");
    expect(text).toContain("12 min ago");
    expect(document.querySelector("[data-details-popover-notch]")).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Open all details", exact: true }));
    expect(onOpenAll).toHaveBeenCalledOnce();
  });
});
