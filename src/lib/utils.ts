import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine class names (clsx semantics) and resolve Tailwind conflicts —
 * shadcn-svelte's `cn` contract, superset of the old filter-join helper.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
