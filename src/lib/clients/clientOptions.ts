/**
 * The Client field's options on New project (2026-10-14 amendment, "Pick a
 * client on New project"): the saved clients and the company names that have
 * no client row yet, as `clients.listClients` returns them. Pure, so the
 * matching rules are unit-tested apart from the combobox.
 */
import {
  DASHBOARD_UNNAMED_COMPANY_KEY,
  dashboardCompanyKey,
  normalizeDashboardText,
} from "../../../shared/dashboardProjection";

export type ClientOption = {
  key: string;
  clientId: string | null;
  name: string;
  projectCount: number;
  fiscalYearEndMonth?: number;
  fiscalYearEndDay?: number;
  industry?: string;
};

/**
 * A client the New client dialog made (with the year end and industry it was
 * saved with) or chose, as an option until the client list has it. Listed
 * clients still win in mergeClientOptions, so "Use that client" keeps the
 * listed client's own year end and industry.
 */
export function addedClientOption(client: {
  key: string;
  clientId: string | null;
  name: string;
  fiscalYearEndMonth?: number;
  fiscalYearEndDay?: number;
  industry?: string;
}): ClientOption {
  return {
    key: client.key,
    clientId: client.clientId,
    name: client.name,
    projectCount: 0,
    ...(client.fiscalYearEndMonth !== undefined && client.fiscalYearEndDay !== undefined
      ? { fiscalYearEndMonth: client.fiscalYearEndMonth, fiscalYearEndDay: client.fiscalYearEndDay }
      : {}),
    ...(client.industry ? { industry: client.industry } : {}),
  };
}

/** Most options the open list shows at once. */
export const CLIENT_OPTION_LIMIT = 8;

/**
 * One option per key, the first one winning, so a listed client keeps its
 * year end and industry over a name added on this page.
 */
export function mergeClientOptions(...lists: ReadonlyArray<readonly ClientOption[]>): ClientOption[] {
  const byKey = new Map<string, ClientOption>();
  for (const list of lists) {
    for (const option of list) if (!byKey.has(option.key)) byKey.set(option.key, option);
  }
  return [...byKey.values()];
}

/** The listed client the typed name names (same key), or null. */
export function listedClientFor(options: readonly ClientOption[], name: string): ClientOption | null {
  const key = dashboardCompanyKey(name);
  if (key === DASHBOARD_UNNAMED_COMPANY_KEY) return null;
  return options.find((option) => option.key === key) ?? null;
}

/**
 * The options whose name holds the typed text (case and accents ignored),
 * without the one the text already names, up to CLIENT_OPTION_LIMIT.
 */
export function matchingClients(options: readonly ClientOption[], typed: string): ClientOption[] {
  const query = normalizeDashboardText(typed);
  const key = query ? dashboardCompanyKey(typed) : null;
  return options
    .filter((option) => option.key !== key)
    .filter((option) => !query || normalizeDashboardText(option.name).includes(query))
    .slice(0, CLIENT_OPTION_LIMIT);
}
