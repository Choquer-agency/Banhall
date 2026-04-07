"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Doc } from "../../../convex/_generated/dataModel";

export function ProjectCard({ project }: { project: Doc<"projects"> }) {
  const updatedDate = new Date(project.updatedAt).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const createdDate = new Date(project.createdAt).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  });

  return (
    <Link
      href={`/project/${project._id}`}
      className="group relative block rounded-xl border border-gray-200 bg-white p-5 transition-all duration-150 hover:border-gray-300 hover:shadow-md"
    >
      {/* Status indicator line */}
      <div
        className={`absolute left-0 top-4 bottom-4 w-0.5 rounded-full transition-opacity ${
          project.status === "generating"
            ? "bg-blue-400 animate-pulse"
            : project.status === "review"
              ? "bg-amber-400"
              : project.status === "client_review"
                ? "bg-purple-400"
                : project.status === "final"
                  ? "bg-green-400"
                  : "bg-gray-200"
        }`}
      />

      <div className="flex items-start justify-between gap-3 pl-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-gray-900 group-hover:text-navy transition-colors">
            {project.title}
          </h3>
          <p className="mt-0.5 text-sm text-gray-500">{project.clientName}</p>
        </div>
        <Badge status={project.status} />
      </div>

      <div className="mt-4 flex items-center gap-3 pl-2 text-xs text-gray-400">
        <span>Created {createdDate}</span>
        <span className="h-0.5 w-0.5 rounded-full bg-gray-300" />
        <span>Updated {updatedDate}</span>
      </div>
    </Link>
  );
}
