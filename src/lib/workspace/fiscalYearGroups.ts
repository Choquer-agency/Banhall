export type ClientProjectSort = "project_number" | "created" | "updated";

export type FiscalProjectRow = {
  _id: string;
  title: string;
  projectNumber?: string;
  fiscalYearEnd?: number;
  createdAt?: number;
  _creationTime?: number;
  updatedAt: number;
};

export type FiscalYearGroup<T extends FiscalProjectRow> = {
  key: string;
  label: string;
  year: number | null;
  rows: T[];
};

export function fiscalYearOf(fiscalYearEnd?: number) {
  if (fiscalYearEnd === undefined) return null;
  const year = new Date(fiscalYearEnd).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

export function projectNumberKey(value?: string) {
  const normalized = value?.trim().toUpperCase() ?? "";
  const numbered = normalized.match(/^([0-9]+)([A-Z]?)$/);
  if (numbered) {
    // Letter DESCENDS inside a number group (owner direction 2026-08-19):
    // the newest duplicate gets the latest letter and should list first, so
    // 1b sorts before 1a. Inverting the letter keeps one ascending
    // localeCompare across the whole key. A bare number reads as the "A"
    // slot and therefore lists last in its group.
    const letter = numbered[2] || "A";
    const inverted = String.fromCharCode(65 + (90 - letter.charCodeAt(0)));
    return `0:${Number(numbered[1]).toString().padStart(3, "0")}:${inverted}`;
  }
  if (/^[A-Z]$/.test(normalized)) return `1:${normalized}`;
  return "2:";
}

export function groupProjectsByFiscalYear<T extends FiscalProjectRow>(
  rows: readonly T[],
  sortBy: ClientProjectSort = "project_number"
): FiscalYearGroup<T>[] {
  const buckets = new Map<number | null, T[]>();
  for (const row of rows) {
    const year = fiscalYearOf(row.fiscalYearEnd);
    buckets.set(year, [...(buckets.get(year) ?? []), row]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    })
    .map(([year, groupRows]) => ({
      key: year === null ? "unrecorded" : String(year),
      label: year === null ? "Fiscal year not set" : `Fiscal ${year}`,
      year,
      rows: groupRows.sort((a, b) => {
        if (sortBy === "created") {
          const byCreated = (b.createdAt ?? b._creationTime ?? 0) - (a.createdAt ?? a._creationTime ?? 0);
          if (byCreated) return byCreated;
        } else if (sortBy === "updated") {
          const byUpdated = b.updatedAt - a.updatedAt;
          if (byUpdated) return byUpdated;
        } else {
          const byNumber = projectNumberKey(a.projectNumber).localeCompare(
            projectNumberKey(b.projectNumber),
            "en-CA"
          );
          if (byNumber) return byNumber;
        }
        return a.title.localeCompare(b.title, "en-CA", { sensitivity: "base" });
      }),
    }));
}
