import { describe, expect, it, vi } from "vitest";
import { isModelProviderUrl, providerRefusingFetch } from "./providerNetworkGuard";

describe("provider network guard", () => {
  it("recognizes the model provider hosts and nothing else", () => {
    expect(isModelProviderUrl("https://openrouter.ai/api/v1/chat/completions")).toBe(true);
    expect(isModelProviderUrl("https://openrouter.ai/api/v1/models")).toBe(true);
    expect(isModelProviderUrl("https://api.anthropic.com/v1/messages")).toBe(true);
    expect(isModelProviderUrl("https://eu.openrouter.ai/api/v1/chat/completions")).toBe(true);
    expect(isModelProviderUrl("https://artificialanalysis.ai/api/v2/data/llms/models")).toBe(false);
    expect(isModelProviderUrl("https://notopenrouter.ai/x")).toBe(false);
    expect(isModelProviderUrl("https://anthropic.com/news")).toBe(false);
    expect(isModelProviderUrl("not a url")).toBe(false);
  });

  it("refuses provider requests in every input form and passes other hosts through", async () => {
    const base = vi.fn(async () => new Response("ok"));
    const refused: string[] = [];
    const guarded = providerRefusingFetch(base as unknown as typeof fetch, (href) => refused.push(href));
    await expect(guarded("https://api.anthropic.com/v1/messages")).rejects.toThrow(/refused/);
    await expect(guarded(new URL("https://openrouter.ai/api/v1/chat/completions"))).rejects.toThrow(/refused/);
    await expect(guarded(new Request("https://openrouter.ai/api/v1/models"))).rejects.toThrow(/refused/);
    expect(refused).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://openrouter.ai/api/v1/chat/completions",
      "https://openrouter.ai/api/v1/models",
    ]);
    expect(base).not.toHaveBeenCalled();
    expect(await (await guarded("https://example.com/data")).text()).toBe("ok");
    expect(base).toHaveBeenCalledTimes(1);
  });
});
