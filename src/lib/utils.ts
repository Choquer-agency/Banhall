import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export type WithoutChild<T> = Omit<T, "child">;
export type WithoutChildren<T> = Omit<T, "children">;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;

/**
 * Combine class names (clsx semantics) and resolve Tailwind conflicts —
 * shadcn-svelte's `cn` contract, superset of the old filter-join helper.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
