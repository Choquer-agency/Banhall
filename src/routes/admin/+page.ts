import { redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ADMIN_LANDING_PATH } from "$lib/dashboard/adminRoutes";

// /admin has no page of its own: "Open Admin" and G then A land on the first
// admin page (round 2, A5). Query parameters (for example
// `?workspace=current`) carry over.
export function load({ url }) {
  redirect(307, `${resolve(ADMIN_LANDING_PATH as "/")}${url.search}`);
}
