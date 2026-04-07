"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { ProjectCard } from "@/components/dashboard/ProjectCard";
import Link from "next/link";

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

  const [filter, setFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
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

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <h1 className="text-lg font-bold tracking-tight text-navy">Banhall</h1>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-gray-500 sm:inline">
            {user?.name ?? user?.email}
          </span>
          <button
            onClick={() => signOut()}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Projects</h2>
            {projects && projects.length > 0 && (
              <p className="mt-0.5 text-sm text-gray-400">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <Link href="/project/new">
            <Button>
              <svg className="mr-1.5 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Project
            </Button>
          </Link>
        </div>

        {/* Filters */}
        {projects && projects.length > 0 && (
          <div className="mt-4 flex items-center gap-1">
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
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  }`}
                >
                  {f.label}
                  {count > 0 && (
                    <span
                      className={`ml-1.5 ${
                        filter === f.value ? "text-white/70" : "text-gray-400"
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
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
          </div>
        ) : filtered && filtered.length === 0 && filter !== "all" ? (
          <div className="mt-12 text-center">
            <p className="text-sm text-gray-400">
              No {filter.replace("_", " ")} projects.
            </p>
            <button
              onClick={() => setFilter("all")}
              className="mt-2 text-xs text-navy hover:underline"
            >
              Show all projects
            </button>
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="mt-16 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p className="text-gray-500">No projects yet.</p>
            <p className="mt-1 text-sm text-gray-400">
              Create your first project to get started.
            </p>
            <Link href="/project/new" className="mt-4 inline-block">
              <Button>Create your first project</Button>
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered?.map((project) => (
              <ProjectCard key={project._id} project={project} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
