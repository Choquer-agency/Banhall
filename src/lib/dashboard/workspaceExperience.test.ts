import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceRouteState,
  shouldQueryWorkspaceAccess,
  type WorkspaceAccessState,
  type WorkspaceRouteState,
} from "./workspaceExperience";

const cases: Array<{
  workspaceParam: string | null;
  expected: [WorkspaceRouteState, WorkspaceRouteState, WorkspaceRouteState, WorkspaceRouteState];
  shouldQuery: boolean;
}> = [
  { workspaceParam: "current", expected: ["current", "current", "current", "current"], shouldQuery: false },
  { workspaceParam: "preview", expected: ["loading", "current", "current", "preview"], shouldQuery: true },
  { workspaceParam: null, expected: ["loading", "current", "current", "preview"], shouldQuery: true },
  { workspaceParam: "", expected: ["loading", "current", "current", "preview"], shouldQuery: true },
  { workspaceParam: "banana", expected: ["loading", "current", "current", "preview"], shouldQuery: true },
];
const accesses: WorkspaceAccessState[] = [
  { status: "loading" },
  { status: "error" },
  { status: "ready", available: false },
  { status: "ready", available: true },
];

describe("workspace routing: fixed 25 observations", () => {
  for (const { workspaceParam, expected, shouldQuery } of cases) {
    accesses.forEach((access, index) => {
      it(`${JSON.stringify(workspaceParam)} + ${JSON.stringify(access)} => ${expected[index]}`, () => {
        expect(resolveWorkspaceRouteState({ workspaceParam, access })).toBe(expected[index]);
      });
    });
    it(`${JSON.stringify(workspaceParam)} shouldQuery => ${shouldQuery}`, () => {
      expect(shouldQueryWorkspaceAccess(workspaceParam)).toBe(shouldQuery);
    });
  }
});
