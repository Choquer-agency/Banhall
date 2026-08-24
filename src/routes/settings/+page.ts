import { redirect } from "@sveltejs/kit";
import { DEFAULT_SETTINGS_PATH } from "$lib/settings/sections";

// /settings has no content of its own — land on the first section so the URL
// is always a real, shareable page (never `/settings#…`).
export function load() {
  redirect(307, DEFAULT_SETTINGS_PATH);
}
