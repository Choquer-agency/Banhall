"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Doc } from "../../../convex/_generated/dataModel";
import { useState, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

const STATUS_LINE_COLORS: Record<string, string> = {
  draft: "bg-gray-200",
  generating: "bg-blue-400 animate-pulse",
  review: "bg-amber-400",
  client_review: "bg-purple-400",
  final: "bg-primary",
};

export function ProjectCard({ project }: { project: Doc<"projects"> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const deleteProject = useMutation(api.projects.deleteProject);

  const updatedDate = new Date(project.updatedAt).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const createdDate = new Date(project.createdAt).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
  });

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirming(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await deleteProject({ projectId: project._id });
    setMenuOpen(false);
    setConfirming(false);
  }

  return (
    <div className="group relative">
      <Link
        href={`/project/${project._id}`}
        className="relative block rounded-xl border border-gray-200 bg-white p-5 transition-all duration-150 hover:border-primary/30 hover:shadow-md"
      >
        {/* Status indicator line */}
        <div
          className={`absolute left-0 top-4 bottom-4 w-0.5 rounded-full ${
            STATUS_LINE_COLORS[project.status] ?? "bg-gray-200"
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

      {/* Three-dot menu — appears on hover */}
      <div ref={menuRef} className="absolute bottom-3 right-3">
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen(!menuOpen);
            setConfirming(false);
          }}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-all ${
            menuOpen
              ? "bg-gray-100 text-gray-600"
              : "text-gray-300 opacity-0 group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-600"
          }`}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>

        {menuOpen && (
          <div className={`absolute right-0 bottom-8 z-20 w-40 overflow-hidden rounded-lg border shadow-lg ${
            confirming ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
          }`}>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDelete();
              }}
              className={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-2.5 text-left text-sm transition-colors ${
                confirming
                  ? "text-red-600 font-medium"
                  : "text-red-500 hover:bg-red-50"
              }`}
            >
              <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {confirming ? "Confirm delete?" : "Delete"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
