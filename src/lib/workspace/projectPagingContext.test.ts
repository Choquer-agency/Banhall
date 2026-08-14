import { beforeEach, describe, expect, it } from "vitest";
import {
  clearProjectPagingContext,
  getProjectPagingContext,
  projectPagingPosition,
  setProjectPagingContext,
} from "./projectPagingContext";

describe("project paging context", () => {
  beforeEach(() => clearProjectPagingContext());

  it("resolves position, neighbours, and the bounded qualifier", () => {
    setProjectPagingContext({ ids: ["a", "b", "c"], label: "Drafting", bounded: true });
    expect(projectPagingPosition("b")).toEqual({
      index: 1,
      total: 3,
      label: "Drafting",
      bounded: true,
      prevId: "a",
      nextId: "c",
    });
    expect(projectPagingPosition("a")?.prevId).toBeNull();
    expect(projectPagingPosition("c")?.nextId).toBeNull();
  });

  it("returns null off-context and for unknown ids; empty pages clear", () => {
    expect(projectPagingPosition("a")).toBeNull();
    setProjectPagingContext({ ids: [], label: "Projects", bounded: false });
    expect(getProjectPagingContext()).toBeNull();
    setProjectPagingContext({ ids: ["a"], label: "Projects", bounded: false });
    expect(projectPagingPosition("zzz")).toBeNull();
  });

  it("copies the id list so later mutation cannot rewrite the stash", () => {
    const ids = ["a", "b"];
    setProjectPagingContext({ ids, label: "Projects", bounded: false });
    ids.push("c");
    expect(projectPagingPosition("c")).toBeNull();
  });

  it("deduplicates repeated project destinations while preserving display order", () => {
    setProjectPagingContext({
      ids: ["a", "b", "a", "c", "b"],
      label: "With you",
      bounded: false,
    });

    expect(getProjectPagingContext()?.ids).toEqual(["a", "b", "c"]);
    expect(projectPagingPosition("b")).toMatchObject({
      index: 1,
      total: 3,
      prevId: "a",
      nextId: "c",
    });
  });
});
