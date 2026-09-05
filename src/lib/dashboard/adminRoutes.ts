/**
 * Admin destinations — one list shared by UserMenu (the account/admin menu,
 * the ONE home for admin navigation) and the command palette, so the two
 * surfaces can never disagree about what admin routes exist. Visibility is
 * role-gated at each consumer (admins only).
 */
export const ADMIN_ROUTES = [
  { href: "/admin/brain", label: "The Brain" },
  { href: "/admin/tags", label: "Project tags" },
  { href: "/admin/learning", label: "Learning health" },
  { href: "/admin/reviews", label: "Consultant QA reviews" },
  { href: "/admin/backfill", label: "Ownership review" },
  { href: "/admin/users", label: "Users & roles" },
  { href: "/admin/models", label: "Model preferences" },
  { href: "/admin/usage", label: "AI usage & cost" },
] as const;
