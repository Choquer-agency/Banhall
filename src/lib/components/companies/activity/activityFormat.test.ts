import { describe, expect, it } from "vitest";
import { dayTitle, fileVerb, groupActivity, type ActivityEntry } from "./activityFormat";

/** 2026-11-04 (the company profile): Activity's day groups and wording. */
const NOW = new Date(2026, 10, 4, 15, 0).getTime(); // Wednesday Nov 4, 2026, local time
const local = (month: number, day: number, hour = 12, year = 2026) => new Date(year, month, day, hour).getTime();
const actor = (userId: string) => ({ userId, label: userId, initials: "XX" });

describe("day titles", () => {
  it("reads Today, Yesterday, a weekday this past week, then the date over its weekday", () => {
    expect(dayTitle(local(10, 4, 9), NOW)).toEqual({ title: "Today", subtitle: "Nov 4" });
    expect(dayTitle(local(10, 3), NOW)).toEqual({ title: "Yesterday", subtitle: "Nov 3" });
    expect(dayTitle(local(10, 1), NOW)).toEqual({ title: "Sunday", subtitle: "Nov 1" });
    expect(dayTitle(local(9, 27), NOW)).toEqual({ title: "Oct 27", subtitle: "Tuesday" });
    expect(dayTitle(local(11, 30, 12, 2025), NOW)).toEqual({ title: "Dec 30, 2025", subtitle: "Tuesday" });
  });
});

describe("grouping", () => {
  const file = (id: string, at: number, userId: string, action: "added" | "archived" = "added"): ActivityEntry => ({
    id,
    kind: "file",
    at,
    actor: actor(userId),
    action,
    fileId: `f-${id}`,
    fileName: `${id}.pdf`,
  });

  it("puts one day's rows together, newest day first", () => {
    const days = groupActivity(
      [file("a", local(10, 4, 10), "u1"), file("b", local(10, 1, 10), "u2"), file("c", local(10, 1, 9), "u2", "archived")],
      NOW
    );
    expect(days.map((day) => day.title)).toEqual(["Today", "Sunday"]);
    expect(days[1].rows).toHaveLength(2);
  });

  it("reads files one person added one after another the same day as one row", () => {
    const days = groupActivity(
      [
        file("a", local(10, 4, 10), "u1"),
        file("b", local(10, 4, 9), "u1"),
        file("c", local(10, 4, 8), "u2"),
        file("d", local(10, 4, 7), "u1"),
        file("e", local(10, 3, 7), "u1"),
      ],
      NOW
    );
    expect(days[0].rows.map((row) => (row.kind === "files" ? row.files.map((f) => f.fileName) : []))).toEqual([
      ["a.pdf", "b.pdf"],
      ["c.pdf"],
      ["d.pdf"],
    ]);
    expect(days[1].rows).toHaveLength(1);
  });

  it("words file changes, calling a removal a deletion", () => {
    expect(fileVerb("added", 1)).toBe("added a file");
    expect(fileVerb("added", 3)).toBe("added 3 files");
    expect(fileVerb("removed", 1)).toBe("deleted a file");
  });
});
