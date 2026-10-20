/**
 * Chat parity Phase B (W3): a reply's web sources in the browser.
 *
 * `chatV2.listTurnWebSources` returns each search a conversation's replies
 * sent, with the query as sent and its numbered sources (the numbers run
 * across a reply). This module groups them by turn, turns the reply's `[n]`
 * citations into keys only those sources match, and names each search in
 * the trace. The browser never receives the tool's own output.
 */

export type WebSource = { n: number; url: string; title: string; domain: string };

export type TurnWebSearch = {
  promptMessageId: string;
  toolCallId?: string;
  query: string;
  status: "ok" | "failed";
  sources: WebSource[];
};

/**
 * Citation keys carry this invisible character, so a key only a numbered
 * source can match. Streamdown reads any bracketed words as citation keys
 * ("[GAP: need 2 results]" gives "GAP:", "need", "2", "results"); a bare "2"
 * key would turn that gap into a source card.
 */
export const CITATION_KEY_MARK = "⁣";

export function citationKey(n: number): string {
  return `${CITATION_KEY_MARK}${n}`;
}

/** The number a citation key stands for, or null for any other key. */
export function citationNumber(key: string): number | null {
  if (!key.startsWith(CITATION_KEY_MARK)) return null;
  const n = Number(key.slice(CITATION_KEY_MARK.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Each search grouped under its turn's order, in creation order. */
export function webSearchesByOrder(
  searches: readonly TurnWebSearch[],
  turns: ReadonlyArray<{ order: number; promptMessageId: string }>
): Map<number, TurnWebSearch[]> {
  const orderByPrompt = new Map(turns.map((turn) => [turn.promptMessageId, turn.order]));
  const grouped = new Map<number, TurnWebSearch[]>();
  for (const search of searches) {
    const order = orderByPrompt.get(search.promptMessageId);
    if (order === undefined) continue;
    grouped.set(order, [...(grouped.get(order) ?? []), search]);
  }
  return grouped;
}

/** A turn's sources, one per number, in number order. */
export function turnWebSources(searches: readonly TurnWebSearch[]): WebSource[] {
  const byNumber = new Map<number, WebSource>();
  for (const search of searches) {
    for (const source of search.sources) {
      if (!byNumber.has(source.n)) byNumber.set(source.n, source);
    }
  }
  return [...byNumber.values()].sort((left, right) => left.n - right.n);
}

/**
 * Streamdown's `sources`, keyed by `citationKey`. Review R2 P3-2: no
 * prototype, because Streamdown looks keys up with `sources[key]`, and
 * "[call toString first]" would otherwise find `toString`.
 */
export function citationSources(sources: readonly WebSource[]): Record<string, WebSource> {
  const map = Object.create(null) as Record<string, WebSource>;
  for (const source of sources) map[citationKey(source.n)] = source;
  return map;
}

const GROUP = String.raw`\[[ \t]*\d{1,3}(?:[ \t]*[,;][ \t]*\d{1,3})*[ \t]*\]`;
/**
 * A run of numeric citation groups ("[1]", "[1, 2]", "[1][2]", "[1] [3]").
 * Not after "]", "!" or "\" (a reference link, an image, an escape), and not
 * before "(" or ":" (an inline link, a reference definition).
 */
const CITATION_RUN = new RegExp(String.raw`(?<![\]!\\])${GROUP}(?:[ \t]*${GROUP})*(?![ \t]*[(:])`, "g");
/** Fenced code blocks and inline code spans are left exactly as written. */
const CODE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2[^\n]*(?=\n|$)|$)|`[^`\n]*`/g;

function markRuns(text: string, numbers: ReadonlySet<number>): string {
  return text.replace(CITATION_RUN, (run) => {
    const cited = [...new Set((run.match(/\d{1,3}/g) ?? []).map(Number))].filter((n) => numbers.has(n));
    return cited.length ? `[${cited.map(citationKey).join(" ")}]` : run;
  });
}

/**
 * The reply text with each citation of one of this turn's numbers rewritten
 * to its key. Every other bracket ("[GAP: ...]", inventory ids, a number the
 * turn never gave) and all code stay exactly as written.
 */
export function markCitations(text: string, numbers: ReadonlySet<number>): string {
  if (numbers.size === 0 || !text.includes("[")) return text;
  let out = "";
  let last = 0;
  for (const match of text.matchAll(CODE)) {
    const start = match.index ?? 0;
    out += markRuns(text.slice(last, start), numbers) + match[0];
    last = start + match[0].length;
  }
  return out + markRuns(text.slice(last), numbers);
}

/** The trace line for a search that ran: "Searched the web: {query}". */
export function webSearchTraceLabel(query: string): string {
  return `Searched the web: ${query}`;
}

/**
 * The trace's searchWeb steps, each named by the query it sent. A step with
 * no record (turned off, refused, over its limit) or whose request failed
 * keeps its own label.
 */
export function withWebSearchLabels<Node extends { kind: string }>(
  nodes: readonly Node[],
  searches: readonly TurnWebSearch[]
): Node[] {
  const byCall = new Map(searches.flatMap((search) => (search.toolCallId ? [[search.toolCallId, search] as const] : [])));
  if (byCall.size === 0) return [...nodes];
  return nodes.map((node) => {
    const tool = node as Node & { toolName?: string; toolCallId?: string; state?: string; label?: string };
    if (node.kind !== "tool" || tool.toolName !== "searchWeb" || tool.state !== "output-available") return node;
    const search = tool.toolCallId ? byCall.get(tool.toolCallId) : undefined;
    return search?.status === "ok" ? { ...node, label: webSearchTraceLabel(search.query) } : node;
  });
}
