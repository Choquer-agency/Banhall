import { afterEach, describe, expect, it, vi } from "vitest";

const saved: Array<{ blob: Blob; name: string }> = [];
vi.mock("file-saver", () => ({ saveAs: (blob: Blob, name: string) => saved.push({ blob, name }) }));
// Node's JSZip reads no Blob (no FileReader); the browser suite uses the real one.
vi.mock("jszip", () => ({
  default: class {
    names: string[] = [];
    file(name: string) {
      this.names.push(name);
    }
    async generateAsync() {
      return new Blob([this.names.join(",")], { type: "application/zip" });
    }
  },
}));

import { downloadOriginals, eachLimited, TooMuchToDownloadError } from "./downloadOriginals";

/** Download original for several files (2026-11-04): bounded, four at a time, within a size budget. */
afterEach(() => {
  saved.length = 0;
  vi.restoreAllMocks();
});

function files(count: number, bytes = 10) {
  return Array.from({ length: count }, (_, i) => ({ fileName: `f${i}.txt`, url: `https://files.test/${i}`, bytes }));
}

describe("downloadOriginals", () => {
  it("refuses more than 200 files before fetching anything", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(downloadOriginals(files(201), "zip")).rejects.toThrow("Too much to download at once. Select fewer files.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses originals over the size budget, by their known sizes and by what arrives", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new Blob(["x".repeat(60)])));
    await expect(downloadOriginals(files(3, 400), "zip", { maxBytes: 1000 })).rejects.toBeInstanceOf(TooMuchToDownloadError);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Sizes unknown: the fetched bytes are counted.
    await expect(downloadOriginals(files(3, 0), "zip", { maxBytes: 100 })).rejects.toBeInstanceOf(TooMuchToDownloadError);
    expect(saved).toEqual([]);
  });

  it("fetches at most four at a time and saves one zip", async () => {
    let running = 0;
    let most = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return new Response(new Blob(["bytes"]));
    });
    await downloadOriginals(files(12), "Cedarline files");
    expect(most).toBe(4);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe("Cedarline files.zip");
    expect(await saved[0]!.blob.text()).toBe(files(12).map((file) => file.fileName).join(","));
  });
});

describe("eachLimited", () => {
  it("stops starting new work after a failure and throws it", async () => {
    const started: number[] = [];
    await expect(
      eachLimited([0, 1, 2, 3, 4, 5], 2, async (item) => {
        started.push(item);
        if (item === 1) throw new Error("boom");
        await new Promise((resolve) => setTimeout(resolve, 5));
      })
    ).rejects.toThrow("boom");
    expect(started.length).toBeLessThan(6);
  });
});
