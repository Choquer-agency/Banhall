import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ProjectCardMetadata from "./ProjectCardMetadata.svelte";

describe("ProjectCardMetadata", () => {
  it("keeps creator and update metadata without repeating Owner or Stage", async () => {
    await render(ProjectCardMetadata, {
      writer: "Casey Creator",
      updatedDate: "Jul 29, 2026",
    });

    expect(document.body.textContent).toContain("Created by Casey Creator");
    expect(document.body.textContent).toContain("Updated Jul 29, 2026");
    expect(document.body.textContent).not.toContain("Owner");
    expect(document.body.textContent).not.toContain("Stage");
  });

  it("renders a truthful empty creator value", async () => {
    await render(ProjectCardMetadata, {
      updatedDate: "Jul 29, 2026",
    });

    expect(document.body.textContent).toContain("Created by —");
  });
});
