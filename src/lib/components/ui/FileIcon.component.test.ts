import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import FileIcon from "./FileIcon.svelte";

const icon = () => document.body.querySelector<HTMLImageElement>("img[data-file-icon]")!;

async function loaded(image: HTMLImageElement) {
  if (!image.complete) await new Promise((resolve) => image.addEventListener("load", resolve, { once: true }));
  return image;
}

describe("FileIcon", () => {
  it("shows the vivid icon for pdf, docx, xlsx and txt, and a neutral one otherwise", async () => {
    const cases = [
      ["Follow-up call, Sep 19.pdf", "pdf"],
      ["Interview.DOCX", "docx"],
      ["Cost breakdown.xlsx", "xlsx"],
      ["notes.txt", "txt"],
      ["drawings.zip", "generic"],
    ] as const;
    const sources = new Set<string>();
    for (const [name, kind] of cases) {
      const view = await render(FileIcon, { name });
      const image = await loaded(icon());
      expect(image.dataset.fileIcon).toBe(kind);
      expect(image.naturalWidth).toBeGreaterThan(0);
      sources.add(image.src);
      view.unmount();
    }
    // Five distinct pictures, none of them a broken image.
    expect(sources.size).toBe(5);
  });

  it("uses the vivid colours, not another set", async () => {
    await render(FileIcon, { kind: "pdf" });
    const body = await (await fetch(icon().src)).text();
    expect(body.toLowerCase()).toContain("#c11e07");
  });

  it("renders at the boards' 3:4 sizes", async () => {
    const small = await render(FileIcon, { kind: "docx" });
    expect(icon().getBoundingClientRect()).toMatchObject({ width: 21, height: 28 });
    small.unmount();

    await render(FileIcon, { kind: "docx", size: 40 });
    expect(icon().getBoundingClientRect()).toMatchObject({ width: 30, height: 40 });
  });

  it("is decorative unless given a label", async () => {
    const view = await render(FileIcon, { name: "a.pdf" });
    expect(icon().getAttribute("alt")).toBe("");
    view.unmount();

    await render(FileIcon, { name: "a.pdf", label: "PDF file" });
    expect(icon().getAttribute("alt")).toBe("PDF file");
  });
});
