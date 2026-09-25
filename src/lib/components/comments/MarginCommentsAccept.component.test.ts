import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { ConvexError } from "convex/values";
import MarginComments from "./MarginComments.svelte";
import { __resetConvexStub, __setMutationError, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

/** A refused Accept (for example a selection in a Section heading) shows on its card. */
beforeEach(() => {
  __resetConvexStub();
  __setQueryData("comments:listComments", [{
    _id: "comment-1", _creationTime: 1, projectId: "project-1", reportId: "report-1", commenterId: "client-1",
    commenterType: "client", highlightFrom: 3, highlightTo: 17, highlightText: "Work Performed",
    body: "Please reword.", suggestedEdit: "Experimental work", resolved: false, createdAt: 1,
  }]);
  __setQueryData("comments:listCommenters", [{ _id: "client-1", name: "Casey Client", color: "#818CF8" }]);
});

it("shows why Accept was refused on the comment", async () => {
  __setMutationError("comments:acceptEdit", new ConvexError({ code: "INVALID_INPUT", message: "Section headings can't be edited." }));
  const handle = { getYForPos: () => 40, getEditorTop: () => 0 } as never;
  await render(MarginComments, {
    projectId: "project-1" as never, reportId: "report-1" as never, commenterId: "writer-1", commenterType: "writer",
    commenterName: "Wren", editorHandle: handle, scrollContainer: null, activeCommentId: "comment-1", onActiveCommentChange: () => {},
  });
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Section headings can't be edited.");
});
