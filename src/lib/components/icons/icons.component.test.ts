import type { Component } from "svelte";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import * as icons from "./index";
import type { IconProps } from "./types";

// name, component, exact board viewBox, default size (the boards' most used).
const cases: [string, Component<IconProps>, string, number][] = [
  ["IconSidebar", icons.IconSidebar, "0 0 24 24", 16],
  ["IconSearch", icons.IconSearch, "0 0 24 24", 17],
  ["IconHome", icons.IconHome, "0 0 24 24", 15],
  ["IconFolder", icons.IconFolder, "0 0 24 24", 15],
  ["IconBuilding", icons.IconBuilding, "0 0 24 24", 15],
  ["IconUsers", icons.IconUsers, "0 0 24 24", 15],
  ["IconShield", icons.IconShield, "0 0 24 24", 15],
  ["IconShieldCheck", icons.IconShieldCheck, "0 0 24 24", 15],
  ["IconWarning", icons.IconWarning, "0 0 24 24", 15],
  ["IconLightbulb", icons.IconLightbulb, "0 0 24 24", 15],
  ["IconMegaphone", icons.IconMegaphone, "0 0 24 24", 15],
  ["IconGear", icons.IconGear, "0 0 24 24", 15],
  ["IconBell", icons.IconBell, "0 0 24 24", 16],
  ["IconUser", icons.IconUser, "0 0 24 24", 15],
  ["IconLogout", icons.IconLogout, "0 0 24 24", 15],
  ["IconFlag", icons.IconFlag, "0 0 24 24", 15],
  ["IconMenu", icons.IconMenu, "0 0 24 24", 20],
  ["IconEye", icons.IconEye, "0 0 24 24", 15],
  ["IconEyeOff", icons.IconEyeOff, "0 0 24 24", 16],
  ["IconChevronDown", icons.IconChevronDown, "0 0 24 24", 14],
  ["IconChevronDownSmall", icons.IconChevronDownSmall, "0 0 12 12", 12],
  ["IconChevronUp", icons.IconChevronUp, "0 0 24 24", 14],
  ["IconChevronRight", icons.IconChevronRight, "0 0 24 24", 15],
  ["IconArrowRight", icons.IconArrowRight, "0 0 24 24", 14],
  ["IconArrowLeft", icons.IconArrowLeft, "0 0 24 24", 20],
  ["IconPlus", icons.IconPlus, "0 0 24 24", 12],
  ["IconPlusSmall", icons.IconPlusSmall, "0 0 12 12", 12],
  ["IconMinus", icons.IconMinus, "0 0 24 24", 11],
  ["IconClose", icons.IconClose, "0 0 24 24", 14],
  ["IconCheck", icons.IconCheck, "0 0 24 24", 11],
  ["IconCheckCircle", icons.IconCheckCircle, "0 0 24 24", 16],
  ["IconAlertCircle", icons.IconAlertCircle, "0 0 24 24", 16],
  ["IconInfo", icons.IconInfo, "0 0 24 24", 14],
  ["IconInfoWide", icons.IconInfoWide, "0 0 24 24", 16],
  ["IconUpload", icons.IconUpload, "0 0 24 24", 16],
  ["IconCloudDownload", icons.IconCloudDownload, "0 0 24 24", 15],
  ["IconBook", icons.IconBook, "0 0 24 24", 15],
  ["IconDocument", icons.IconDocument, "0 0 24 24", 15],
  ["IconDocumentSmall", icons.IconDocumentSmall, "0 0 14 14", 14],
  ["IconTable", icons.IconTable, "0 0 14 14", 14],
  ["IconClock", icons.IconClock, "0 0 24 24", 16],
  ["IconClockSmall", icons.IconClockSmall, "0 0 14 14", 14],
  ["IconCalendar", icons.IconCalendar, "0 0 24 24", 15],
  ["IconMore", icons.IconMore, "0 0 24 24", 16],
  ["IconPencil", icons.IconPencil, "0 0 24 24", 14],
  ["IconComment", icons.IconComment, "0 0 24 24", 14],
  ["IconQuote", icons.IconQuote, "0 0 24 24", 14],
  ["IconRegenerate", icons.IconRegenerate, "0 0 24 24", 14],
  ["IconLock", icons.IconLock, "0 0 24 24", 11],
  ["IconTag", icons.IconTag, "0 0 24 24", 15],
  ["IconBrain", icons.IconBrain, "0 0 24 24", 15],
  ["IconSliders", icons.IconSliders, "0 0 24 24", 15],
  ["IconBarChart", icons.IconBarChart, "0 0 24 24", 15],
  ["IconDollarCircle", icons.IconDollarCircle, "0 0 24 24", 15],];

describe("round 2 icons", () => {
  it("covers every exported icon", () => {
    const exported = Object.keys(icons).filter((key) => key.startsWith("Icon")).sort();
    expect(cases.map(([name]) => name).sort()).toEqual(exported);
  });

  it.each(cases)("%s renders the board geometry with size and class", async (name, Icon, viewBox, defaultSize) => {
    const plain = await render(Icon, {});
    let svg = plain.container.querySelector("svg")!;
    expect(svg).toBeInstanceOf(SVGSVGElement);
    expect(svg.getAttribute("viewBox")).toBe(viewBox);
    expect(svg.getAttribute("width")).toBe(String(defaultSize));
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.children.length).toBeGreaterThan(0);
    plain.unmount();

    const sized = await render(Icon, { size: 23, class: `text-primary probe-${name}` });
    svg = sized.container.querySelector("svg")!;
    expect(svg.getBoundingClientRect()).toMatchObject({ width: 23, height: 23 });
    expect(svg.classList.contains(`probe-${name}`)).toBe(true);
    sized.unmount();
  });
});
