"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import Link from "next/link";
import Image from "next/image";
import { BuildStamp } from "@/components/BuildStamp";
import { Doc } from "../../../convex/_generated/dataModel";

type Project = Doc<"projects">;

/** BNH-36: group projects company (A→Z) → fiscal year (newest first) → reports. */
function groupByCompanyAndYear(projects: Project[]) {
  const byCompany = new Map<string, Map<string, Project[]>>();
  for (const p of projects) {
    const company = p.clientName?.trim() || "—";
    const fyKey = p.fiscalYearEnd
      ? String(new Date(p.fiscalYearEnd).getFullYear())
      : "none";
    if (!byCompany.has(company)) byCompany.set(company, new Map());
    const years = byCompany.get(company)!;
    if (!years.has(fyKey)) years.set(fyKey, []);
    years.get(fyKey)!.push(p);
  }

  return [...byCompany.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
    .map(([company, years]) => {
      const total = [...years.values()].reduce((n, a) => n + a.length, 0);
      const yearGroups = [...years.entries()]
        .sort((a, b) => {
          if (a[0] === "none") return 1;
          if (b[0] === "none") return -1;
          return Number(b[0]) - Number(a[0]);
        })
        .map(([fyKey, ps]) => {
          const withDate = ps.find((p) => p.fiscalYearEnd);
          return {
            fyKey,
            label: fyKey === "none" ? "No fiscal year set" : `Fiscal ${fyKey}`,
            dateLabel: withDate
              ? new Date(withDate.fiscalYearEnd!).toLocaleDateString("en-CA", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })
              : null,
            projects: [...ps].sort((a, b) => b.updatedAt - a.updatedAt),
          };
        });
      return { company, total, yearGroups };
    });
}

type StatusFilter = "all" | "draft" | "generating" | "review" | "client_review" | "final";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "review", label: "Review" },
  { value: "client_review", label: "Client Review" },
  { value: "final", label: "Final" },
];

export default function DashboardPage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const router = useRouter();
  const user = useQuery(api.users.getCurrentUser);
  const projects = useQuery(api.projects.listProjects);
  const openAlerts = useQuery(api.errorReports.openCount);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const filtered =
    filter === "all"
      ? projects
      : projects?.filter((p) => p.status === filter);

  const counts = projects?.reduce(
    (acc, p) => {
      acc[p.status] = (acc[p.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const q = search.trim().toLowerCase();
  const searched = (filtered ?? []).filter(
    (p) =>
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.clientName.toLowerCase().includes(q) ||
      (p.writer ?? "").toLowerCase().includes(q)
  );
  const groups = groupByCompanyAndYear(searched);
  // Default collapsed; searching forces everything open so matches are visible.
  const isOpen = (key: string) => q.length > 0 || expanded.has(key);

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      {/* Top bar — floating dark brand */}
      <div className="sticky top-0 z-50 w-full pt-5 px-[10%]">
        <header className="flex items-center justify-between bg-navy px-5 py-5 rounded-xl">
        <div className="flex items-center gap-5">
          <Image src="/logo.png" alt="Banhall" width={89} height={89} className="-my-5 brightness-0 invert" />
          <span className="text-sm font-semibold text-white/90">Dashboard</span>
          <BuildStamp className="hidden text-white/50 lg:inline-flex" />
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/alerts"
            className="relative flex items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white/90"
          >
            Alerts
            {openAlerts ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
                {openAlerts}
              </span>
            ) : null}
          </Link>
          <span className="hidden text-sm text-white/60 sm:inline">
            {user?.name ?? user?.email}
          </span>
          <button
            onClick={() => signOut()}
            className="text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>
      </div>

      {/* Content */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-navy">Projects</h2>
            {projects && projects.length > 0 && (
              <p className="mt-0.5 text-sm text-gray-400">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/project/questionnaire">
              <Button variant="secondary">
                Self-Serve
              </Button>
            </Link>
            <Link href="/project/new">
              <Button>
                <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Project
              </Button>
            </Link>
          </div>
        </div>

        {/* Search */}
        {projects && projects.length > 0 && (
          <div className="relative mt-4">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by company, project, or writer…"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>
        )}

        {/* Filters */}
        {projects && projects.length > 0 && (
          <div className="mt-3 flex items-center gap-1">
            {FILTERS.map((f) => {
              const count =
                f.value === "all"
                  ? projects.length
                  : counts?.[f.value] ?? 0;
              if (f.value !== "all" && count === 0) return null;
              return (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filter === f.value
                      ? "bg-navy text-white"
                      : "text-gray-500 hover:bg-chrome hover:text-navy"
                  }`}
                >
                  {f.label}
                  {count > 0 && (
                    <span
                      className={`ml-1.5 ${
                        filter === f.value ? "text-primary-light" : "text-gray-400"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Project grid */}
        {projects === undefined ? (
          <div className="mt-12 flex justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered && filtered.length === 0 && filter !== "all" ? (
          <div className="mt-12 text-center">
            <p className="text-sm text-gray-400">
              No {filter.replace("_", " ")} projects.
            </p>
            <button
              onClick={() => setFilter("all")}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Show all projects
            </button>
          </div>
        ) : searched.length === 0 && q ? (
          <div className="mt-12 text-center">
            <p className="text-sm text-gray-400">No matches for “{search}”.</p>
            <button
              onClick={() => setSearch("")}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="mt-16 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-chrome">
              <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="text-navy font-medium">No projects yet.</p>
            <p className="mt-1 text-sm text-gray-400">
              Create your first project to get started.
            </p>
            <Link href="/project/new" className="mt-4 inline-block">
              <Button>Create your first project</Button>
            </Link>
          </div>
        ) : (
          /* BNH-36: company (A→Z) → fiscal year → report cards */
          <div className="mt-5 flex flex-col gap-2">
            {groups.map((g) => {
              const companyOpen = isOpen(g.company);
              return (
                <div key={g.company} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <button
                    onClick={() => toggle(g.company)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50"
                  >
                    <svg className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${companyOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm font-semibold text-navy">{g.company}</span>
                    <span className="text-xs text-gray-400">
                      {g.total} report{g.total !== 1 ? "s" : ""}
                    </span>
                  </button>

                  {companyOpen && (
                    <div className="border-t border-gray-100">
                      {g.yearGroups.map((yg) => {
                        const yearKey = `${g.company}|${yg.fyKey}`;
                        const yearOpen = isOpen(yearKey);
                        return (
                          <div key={yearKey} className="border-b border-gray-50 last:border-0">
                            <button
                              onClick={() => toggle(yearKey)}
                              className="flex w-full items-center gap-2 px-4 py-2.5 pl-7 text-left transition-colors hover:bg-gray-50"
                            >
                              <svg className={`h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition-transform ${yearOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                              <span className="text-sm font-medium text-gray-700">{yg.label}</span>
                              {yg.dateLabel && (
                                <span className="text-xs text-gray-400">· {yg.dateLabel}</span>
                              )}
                              <span className="ml-auto text-xs text-gray-400">
                                {yg.projects.length}
                              </span>
                            </button>
                            {yearOpen && (
                              <div className="grid gap-3 px-4 pb-4 pl-10 pt-1 sm:grid-cols-2">
                                {yg.projects.map((project) => (
                                  <ProjectCard key={project._id} project={project} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
