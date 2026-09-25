/**
 * Offline evaluation of the transcript method (owner decision 27). Runs the
 * production fact extraction (convex/ai/transcriptFactsAgent.ts, verifier in
 * convex/lib/transcriptFacts.ts) and, as the baseline, the production
 * condense digest (convex/ai/condenseAgent.ts) on real transcripts, and
 * reports:
 *
 * - verified-quote rate: quotes the model proposed that the verifier found
 *   in a client turn of the verbatim transcript;
 * - fact recall vs the digest: digest items (uncertainties, hypotheses,
 *   experiments, results) that some verified fact covers, and the numbers
 *   the digest recorded that some fact carries.
 *
 * Small projects switch to facts (`transcripts.factsMode` = "all") only when
 * this shows facts match the digest on three real transcripts. Nothing here
 * touches Convex; the client is passed in, so the test runs it with HTTP
 * stubbed and the CLI (scripts/transcript-facts-eval.mjs) with a real key.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { avoidTokenCollisions, buildPlaceholderMap, type PlaceholderMap } from "../../convex/lib/deidentify";
import {
  locateQuote,
  planFactWindows,
  renderTurnLine,
  verifyFacts,
  type FactTurn,
  type ProposedFact,
  type VerifiedFact,
} from "../../convex/lib/transcriptFacts";
import { inferSpeakerRoles } from "../../convex/lib/transcriptSpeakers";
import { CONDENSE_WINDOW_CHARS } from "../../convex/lib/transcripts";
import {
  citationsExtractor,
  structuredExtractor,
  type FactWindowExtractor,
} from "../../convex/ai/transcriptFactsAgent";
import { condenseWindow, splitIntoWindows, type TranscriptDigest } from "../../convex/ai/condenseAgent";
import { withPlaceholders } from "../../convex/ai/placeholderClient";
import type { GenerationClient } from "../../convex/ai/openrouterCore";
import { restorePlaceholders } from "../../convex/lib/deidentify";
import { parseTranscriptTurns, prepareTranscriptUpload } from "../../shared/transcriptParse";
import { estimateCostFromTable } from "../../shared/modelPricing";

export type EvalTranscript = {
  name: string;
  text: string;
  fileName?: string;
  /** The client's company name, hidden behind a placeholder (decision 26). */
  clientName?: string;
  /** The firm's interviewer, so the role rules can place them. */
  interviewer?: string;
  interviewees?: readonly string[];
  /** A stored digest to compare against instead of condensing again. */
  digest?: readonly TranscriptDigest[];
};

export type EvalOptions = {
  client: Anthropic;
  model: string;
  adapter?: "citations" | "structured";
  /** Share of a digest item's content words a fact must carry to count. */
  recallThreshold?: number;
};

type Usage = { inputTokens: number; outputTokens: number; costUsd: number };

export type TranscriptEval = {
  name: string;
  chars: number;
  turns: number;
  speakers: Array<{ label: string; role: string }>;
  windows: number;
  facts: { proposed: number; kept: number; context: number; dropped: number };
  /**
   * `verified` quotes were found in a client turn or a turn whose speaker has
   * no role yet (decision 25); `notClientOnly` were found only in
   * interviewer or other speakers' turns, so they back nothing.
   */
  quotes: { proposed: number; verified: number; notClientOnly: number; rate: number };
  recall: {
    digestItems: number;
    recalled: number;
    rate: number;
    byCategory: Record<string, { items: number; recalled: number }>;
    numbers: number;
    numbersRecalled: number;
    missed: string[];
  };
  cost: { factsUsd: number; digestUsd: number };
};

export type EvalReport = {
  model: string;
  adapter: "citations" | "structured";
  transcripts: TranscriptEval[];
  totals: {
    verifiedQuoteRate: number;
    factRecall: number;
    numberRecall: number;
    factsUsd: number;
    digestUsd: number;
  };
};

/** Counts every response's usage and prices it, whatever the call. */
export function meteredClient(client: Anthropic, model: string): { client: Anthropic; usage: Usage; reset: () => Usage } {
  let usage: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const messages = client.messages;
  const create = messages.create.bind(messages);
  const proxy = new Proxy(messages, {
    get(target, property, receiver) {
      if (property !== "create") return Reflect.get(target, property, receiver);
      return async (...args: Parameters<typeof create>) => {
        const response = (await create(...args)) as Anthropic.Message;
        const tokens = {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          cacheCreationInputTokens: response.usage?.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: response.usage?.cache_read_input_tokens ?? 0,
        };
        usage.inputTokens += tokens.inputTokens;
        usage.outputTokens += tokens.outputTokens;
        usage.costUsd += estimateCostFromTable(model, tokens);
        return response;
      };
    },
  });
  const wrapped = Object.create(client) as Anthropic;
  Object.defineProperty(wrapped, "messages", { value: proxy });
  return {
    client: wrapped,
    get usage() {
      return usage;
    },
    reset: () => {
      const previous = usage;
      usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      return previous;
    },
  };
}

const STOPWORDS = new Set(
  "the and for that with this was were are you they them their from have has had not but our out what when which who into than then there these those about would could should because also just very more most some such only over its it's can did does done been being will shall per".split(" ")
);

export function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+(?:[.,][\p{N}]+)?/gu)) {
    const word = match[0];
    if (/\d/.test(word) || (word.length >= 3 && !STOPWORDS.has(word))) words.add(word);
  }
  return words;
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0].replace(",", "."));
}

type DigestItem = { category: string; text: string };

export function digestItems(digests: readonly TranscriptDigest[]): DigestItem[] {
  const items: DigestItem[] = [];
  for (const digest of digests) {
    for (const text of digest.technologicalUncertainties) items.push({ category: "uncertainty", text });
    for (const text of digest.hypotheses) items.push({ category: "hypothesis", text });
    for (const experiment of digest.experiments) {
      items.push({
        category: "experiment",
        text: [experiment.problem, experiment.approach, experiment.result, experiment.conclusion].filter(Boolean).join(" "),
      });
    }
    for (const text of digest.resultsAndNumbers) items.push({ category: "result", text });
  }
  return items.filter((item) => item.text.trim() !== "");
}

/** Whether some fact carries enough of a digest item's content words. */
export function recalledBy(item: string, facts: readonly VerifiedFact[], threshold: number): boolean {
  const wanted = contentWords(item);
  if (wanted.size === 0) return true;
  return facts.some((fact) => {
    const have = contentWords([fact.claim, ...fact.quotes.map((quote) => quote.exactExcerpt)].join(" "));
    let shared = 0;
    for (const word of wanted) if (have.has(word)) shared += 1;
    return shared / wanted.size >= threshold;
  });
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function evalTurns(entry: EvalTranscript): { content: string; turns: FactTurn[]; placeholders: PlaceholderMap; speakers: Array<{ label: string; role: string }> } {
  const { content } = prepareTranscriptUpload({ fileName: entry.fileName ?? `${entry.name}.txt`, text: entry.text });
  const parsed = parseTranscriptTurns(content);
  const guesses = inferSpeakerRoles(parsed, {
    staffNames: entry.interviewer ? [entry.interviewer] : [],
    clientNames: entry.interviewees ?? [],
  });
  const roles = new Map(guesses.map((guess) => [guess.label, guess.role]));
  const turns: FactTurn[] = parsed.map((turn) => ({
    index: turn.index,
    ...(turn.speakerLabel ? { speakerLabel: turn.speakerLabel } : {}),
    role: turn.speakerLabel ? (roles.get(turn.speakerLabel) ?? "unknown") : "unknown",
    ...(turn.startMs !== undefined ? { startMs: turn.startMs } : {}),
    charStart: turn.charStart,
    charEnd: turn.charEnd,
    cleanText: turn.cleanText,
  }));
  const placeholders = avoidTokenCollisions(
    buildPlaceholderMap({
      ...(entry.clientName ? { clientName: entry.clientName } : {}),
      people: [entry.interviewer, ...(entry.interviewees ?? []), ...guesses.map((guess) => guess.label)],
    }),
    [content]
  );
  return { content, turns, placeholders, speakers: guesses.map((guess) => ({ label: guess.label, role: guess.role })) };
}

async function evaluateOne(entry: EvalTranscript, options: Required<EvalOptions>): Promise<TranscriptEval> {
  const { content, turns, placeholders, speakers } = evalTurns(entry);
  const metered = meteredClient(options.client, options.model);
  const extractor: FactWindowExtractor =
    options.adapter === "citations"
      ? citationsExtractor(metered.client, options.model)
      : structuredExtractor(metered.client, options.model);

  const windows = planFactWindows(turns);
  const proposals: ProposedFact[] = [];
  for (const window of windows) {
    const found = await extractor(
      window.map((turn) => ({ turnIndex: turn.index, text: renderTurnLine(turn, placeholders) }))
    );
    for (const fact of found) {
      proposals.push({
        ...fact,
        claim: restorePlaceholders(fact.claim, placeholders),
        quotes: fact.quotes.map((quote) => restorePlaceholders(quote, placeholders)),
      });
    }
  }
  const factsUsage = metered.reset();

  let proposedQuotes = 0;
  let verifiedQuotes = 0;
  let notClientOnly = 0;
  for (const proposal of proposals) {
    for (const quote of proposal.quotes) {
      proposedQuotes += 1;
      const located = locateQuote(content, turns, quote, proposal.turnIndexes);
      if (located.kind === "found") verifiedQuotes += 1;
      if (located.kind === "not_client_only") notClientOnly += 1;
    }
  }
  const verified = verifyFacts({ content, turns, proposals });

  let digests = entry.digest;
  if (!digests) {
    const texts = splitIntoWindows(content, CONDENSE_WINDOW_CHARS);
    const client = withPlaceholders(metered.client as unknown as GenerationClient, placeholders);
    const made: TranscriptDigest[] = [];
    for (const [index, text] of texts.entries()) {
      made.push(
        await condenseWindow(client, {
          text,
          label: entry.name,
          part: index + 1,
          totalParts: texts.length,
          modelId: options.model,
        })
      );
    }
    digests = made;
  }
  const digestUsage = metered.reset();

  const items = digestItems(digests);
  const byCategory: Record<string, { items: number; recalled: number }> = {};
  const missed: string[] = [];
  let recalled = 0;
  for (const item of items) {
    const bucket = (byCategory[item.category] ??= { items: 0, recalled: 0 });
    bucket.items += 1;
    if (recalledBy(item.text, verified.facts, options.recallThreshold)) {
      bucket.recalled += 1;
      recalled += 1;
    } else {
      missed.push(`${item.category}: ${item.text}`);
    }
  }
  const factText = verified.facts.map((fact) => [fact.claim, ...fact.quotes.map((quote) => quote.exactExcerpt)].join(" ")).join(" ");
  const factNumbers = new Set(numbersIn(factText));
  const digestNumbers = [...new Set(digests.flatMap((digest) => digest.resultsAndNumbers.flatMap(numbersIn)))];
  const numbersRecalled = digestNumbers.filter((number) => factNumbers.has(number)).length;

  return {
    name: entry.name,
    chars: content.length,
    turns: turns.length,
    speakers,
    windows: windows.length,
    facts: {
      proposed: proposals.length,
      kept: verified.facts.filter((fact) => fact.quotes.length > 0).length,
      context: verified.facts.filter((fact) => fact.quotes.length === 0).length,
      dropped: verified.counts.dropped,
    },
    quotes: { proposed: proposedQuotes, verified: verifiedQuotes, notClientOnly, rate: rate(verifiedQuotes, proposedQuotes) },
    recall: {
      digestItems: items.length,
      recalled,
      rate: rate(recalled, items.length),
      byCategory,
      numbers: digestNumbers.length,
      numbersRecalled,
      missed,
    },
    cost: { factsUsd: factsUsage.costUsd, digestUsd: digestUsage.costUsd },
  };
}

export async function runFactsEval(transcripts: readonly EvalTranscript[], options: EvalOptions): Promise<EvalReport> {
  const resolved: Required<EvalOptions> = {
    adapter: options.adapter ?? "citations",
    recallThreshold: options.recallThreshold ?? 0.5,
    ...options,
  } as Required<EvalOptions>;
  const results: TranscriptEval[] = [];
  for (const entry of transcripts) results.push(await evaluateOne(entry, resolved));
  const sum = (pick: (row: TranscriptEval) => number) => results.reduce((total, row) => total + pick(row), 0);
  return {
    model: resolved.model,
    adapter: resolved.adapter,
    transcripts: results,
    totals: {
      verifiedQuoteRate: rate(sum((row) => row.quotes.verified), sum((row) => row.quotes.proposed)),
      factRecall: rate(sum((row) => row.recall.recalled), sum((row) => row.recall.digestItems)),
      numberRecall: rate(sum((row) => row.recall.numbersRecalled), sum((row) => row.recall.numbers)),
      factsUsd: sum((row) => row.cost.factsUsd),
      digestUsd: sum((row) => row.cost.digestUsd),
    },
  };
}

/**
 * Why the CLI must not make the billable calls, or null when it may
 * (review 2026-09-25). A run on real transcripts without the client's
 * company name would send that name to the model (decision 26), so `--yes`
 * requires `--client`.
 */
export function evalRunRefusal(args: {
  yes: boolean;
  clientName?: string;
  estimateUsd: number;
  maxUsd: number;
  apiKey?: string;
}): string | null {
  if (!args.yes) return null;
  if (!args.clientName?.trim()) {
    return "Add --client with the client's company name, so it is hidden from the model like every other name.";
  }
  if (args.estimateUsd > args.maxUsd) return `Estimated cost is above --max-usd ${args.maxUsd}.`;
  if (!args.apiKey) return "Set ANTHROPIC_API_KEY for this billable evaluation.";
  return null;
}

/**
 * A rough upper estimate before any call: every window's input once for the
 * facts and once for the digest, plus a generous output allowance.
 */
export function estimateEvalCost(transcripts: readonly EvalTranscript[], model: string): { inputTokens: number; outputTokens: number; usd: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const entry of transcripts) {
    const { turns } = evalTurns(entry);
    const windows = planFactWindows(turns);
    const text = windows.flat().reduce((total, turn) => total + turn.cleanText.length + 24, 0);
    inputTokens += Math.ceil(text / 4) + windows.length * 800;
    outputTokens += windows.length * 3_000;
    if (!entry.digest) {
      inputTokens += Math.ceil(entry.text.length / 4) + 1_000;
      outputTokens += 6_000;
    }
  }
  return { inputTokens, outputTokens, usd: estimateCostFromTable(model, { inputTokens, outputTokens }) };
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export function formatReport(report: EvalReport): string {
  const lines = [
    `Transcript facts evaluation (${report.model}, ${report.adapter} mode)`,
    "",
    "| Transcript | Turns | Facts kept | Quotes verified | Fact recall vs digest | Numbers recalled | Cost (facts, digest) |",
    "|---|---|---|---|---|---|---|",
    ...report.transcripts.map(
      (row) =>
        `| ${row.name} | ${row.turns} | ${row.facts.kept} of ${row.facts.proposed} (${row.facts.context} context) | ${row.quotes.verified} of ${row.quotes.proposed} (${percent(row.quotes.rate)}) | ${row.recall.recalled} of ${row.recall.digestItems} (${percent(row.recall.rate)}) | ${row.recall.numbersRecalled} of ${row.recall.numbers} | $${row.cost.factsUsd.toFixed(3)}, $${row.cost.digestUsd.toFixed(3)} |`
    ),
    "",
    `Verified-quote rate: ${percent(report.totals.verifiedQuoteRate)}`,
    `Fact recall vs digest: ${percent(report.totals.factRecall)}`,
    `Number recall vs digest: ${percent(report.totals.numberRecall)}`,
    `Cost: facts $${report.totals.factsUsd.toFixed(3)}, digest $${report.totals.digestUsd.toFixed(3)}`,
  ];
  const missed = report.transcripts.flatMap((row) => row.recall.missed.map((item) => `- ${row.name}: ${item}`));
  if (missed.length > 0) lines.push("", "Digest items no fact covers:", ...missed);
  return lines.join("\n");
}
