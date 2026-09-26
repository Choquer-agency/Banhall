/**
 * Admin destinations, grouped as on the round 2 boards (B2 rail list, A5
 * flyout). One source for the rail, the Admin flyout and the command palette,
 * so the surfaces never disagree about what admin routes exist or what they
 * are called. Visibility is gated at each consumer (`settings.configure`,
 * decision 53); the pages enforce access on the server.
 */
export type AdminRouteIcon =
  | "house-rules"
  | "tags"
  | "brain"
  | "ingestion"
  | "models"
  | "reviews"
  | "learning"
  | "usage"
  | "comparisons"
  | "backfill"
  | "users";

export type AdminRoute = {
  href: `/admin/${string}`;
  label: string;
  icon: AdminRouteIcon;
};

export type AdminRouteGroup = {
  key: "writing" | "ai" | "spend";
  label: string;
  routes: readonly AdminRoute[];
};

export const ADMIN_GROUPS: readonly AdminRouteGroup[] = [
  {
    key: "writing",
    label: "Writing",
    routes: [
      { href: "/admin/house-rules", label: "House rules", icon: "house-rules" },
      { href: "/admin/tags", label: "Project tags", icon: "tags" },
      { href: "/admin/brain", label: "The Brain", icon: "brain" },
      { href: "/admin/ingestion", label: "OneDrive import", icon: "ingestion" },
    ],
  },
  {
    key: "ai",
    label: "AI and quality",
    routes: [
      { href: "/admin/models", label: "Models", icon: "models" },
      { href: "/admin/reviews", label: "QA reviews", icon: "reviews" },
      { href: "/admin/learning", label: "Learning health", icon: "learning" },
    ],
  },
  {
    key: "spend",
    label: "Spend",
    routes: [{ href: "/admin/usage", label: "AI usage and cost", icon: "usage" }],
  },
];

/** The eight pages the rail (B2) and the flyout (A5) list, in board order. */
export const ADMIN_RAIL_ROUTES: readonly AdminRoute[] = ADMIN_GROUPS.flatMap((group) => group.routes);

/** Reachable from the command palette only (not on the round 2 rail). */
export const ADMIN_PALETTE_ONLY_ROUTES: readonly AdminRoute[] = [
  { href: "/admin/comparisons", label: "Paired comparisons", icon: "comparisons" },
  { href: "/admin/backfill", label: "Ownership review", icon: "backfill" },
  { href: "/admin/users", label: "Users and roles", icon: "users" },
];

/** Every admin page, for the command palette. */
export const ADMIN_ROUTES: readonly AdminRoute[] = [...ADMIN_RAIL_ROUTES, ...ADMIN_PALETTE_ONLY_ROUTES];

/** "Open Admin" and G then A land here (`/admin` redirects to it). */
export const ADMIN_LANDING_PATH = "/admin/house-rules";

/** The route whose rail and flyout rows carry the ingestion attention signal. */
export const ADMIN_INGESTION_PATH = "/admin/ingestion";
