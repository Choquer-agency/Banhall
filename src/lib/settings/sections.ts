/**
 * Settings sub-navigation. Each section is a real route under /settings so
 * links are shareable and the browser back button works, with no hash state.
 * `/settings` itself redirects to the first section (see routes/settings/+page.ts).
 */
export type SettingsSectionKey = "account" | "writing";

export const SETTINGS_SECTIONS: {
  key: SettingsSectionKey;
  label: string;
  description: string;
  path: `/settings/${SettingsSectionKey}`;
}[] = [
  {
    key: "account",
    label: "Account",
    description: "Name, email, and password",
    path: "/settings/account",
  },
  {
    key: "writing",
    label: "Writing preferences",
    description: "How Banhall writes your reports",
    path: "/settings/writing",
  },
];

export const DEFAULT_SETTINGS_PATH = SETTINGS_SECTIONS[0].path;

export function settingsSectionForPath(pathname: string) {
  return (
    SETTINGS_SECTIONS.find((s) => pathname.startsWith(s.path)) ??
    SETTINGS_SECTIONS[0]
  );
}
