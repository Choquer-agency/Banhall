import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import NewProjectPage from "./+page.svelte";
import { __resetPage, __setPageUrl } from "$lib/test/app-state-stub.svelte";
import { __resetNavigation } from "$lib/test/app-navigation-stub";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";
import { stashProjectIntent, stashProjectStart, takeProjectIntent, takeProjectStart } from "$lib/workspace/projectIntentHandoff";

/**
 * Client-scoped creation prefill (2026-08-06 second amendment):
 * /project/new?client=<recorded name> prefills the free-text Client name
 * field from a client lane/section header. The prefill is editable text
 * only — the wizard, authority checks, creator-becomes-Owner, and
 * born-at-intake semantics are untouched.
 */
const clientInput = () => document.querySelector<HTMLInputElement>("#clientName");

describe("/project/new client prefill", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    takeProjectStart();
    __setQueryData("users:getMyUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  });

  it("prefills the editable client-name field from ?client=", async () => {
    __setPageUrl(`/project/new?client=${encodeURIComponent("Acme & Co")}`);
    await render(NewProjectPage, {});

    await expect.poll(() => clientInput()).not.toBeNull();
    await expect.poll(() => clientInput()?.value).toBe("Acme & Co");
    // Still plain editable text — no durable-Client implication.
    const input = clientInput()!;
    input.value = "Different Name";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("Different Name");
  });

  it("leaves the field empty without the param and ignores blank values", async () => {
    __setPageUrl("/project/new?client=%20%20");
    await render(NewProjectPage, {});

    await expect.poll(() => clientInput()).not.toBeNull();
    expect(clientInput()?.value).toBe("");
  });
});

const titleInput = () => document.querySelector<HTMLInputElement>("#title");

describe("/project/new Home intent prefill", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetPage();
    __resetNavigation();
    __resetConvexStub();
    takeProjectStart();
    __setQueryData("users:getMyUser", { _id: "user-1", role: "writer", firstName: "Wendy" });
  });

  it("consumes the one-use Home handoff into the editable internal title", async () => {
    stashProjectIntent("Solar tracker prototype");
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await expect.poll(() => titleInput()?.value).toBe("Solar tracker prototype");
    expect(takeProjectIntent()).toBe("");

    const input = titleInput()!;
    input.value = "Edited project title";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(input.value).toBe("Edited project title");
  });

  it("carries the Home transcript into the wizard without creating anything", async () => {
    stashProjectStart({
      title: "Solar tracker",
      transcriptText: "Interview transcript",
      transcriptFileName: null,
    });
    __setPageUrl("/project/new");
    await render(NewProjectPage, {});

    await expect.poll(() => titleInput()?.value).toBe("Solar tracker");
    await expect.poll(() => document.querySelector<HTMLTextAreaElement>("#transcript")?.value).toBe("Interview transcript");
    expect(takeProjectStart()).toEqual({ title: "", transcriptText: "", transcriptFileName: null });
  });

  it("keeps duplicate-project prefill authoritative over Home intent", async () => {
    stashProjectIntent("Solar tracker prototype");
    __setPageUrl("/project/new?from=project-1");
    __setQueryData("projects:getProject", {
      _id: "project-1",
      title: "Existing project",
      clientName: "Acme Labs",
      mode: "generate",
    });
    await render(NewProjectPage, {});

    await expect.poll(() => titleInput()?.value).toBe("Existing project (copy)");
    expect(takeProjectIntent()).toBe("");
  });
});
