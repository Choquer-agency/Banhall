export type DashboardView = "my_work" | "all_projects";

export function resolveDashboardView(args: {
  killSwitch: boolean;
  ready: boolean;
  urlView?: string | null;
  sessionView?: string | null;
  configuredDefault: DashboardView;
}): DashboardView {
  if (args.killSwitch || !args.ready) return "all_projects";
  if (args.urlView === "my_work" || args.urlView === "all_projects") return args.urlView;
  if (args.sessionView === "my_work" || args.sessionView === "all_projects") return args.sessionView;
  return args.configuredDefault;
}
