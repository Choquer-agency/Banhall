import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  buildUploaderZipBytes,
  formatUploaderConfig,
  UPLOADER_CONFIG_NAME,
  UPLOADER_KIT_FILES,
} from "./uploaderKit";

const KIT_DIR = path.resolve(process.cwd(), "scripts/client-uploader");
const DEV_ONLY_ENTRIES = new Set([
  "DEV-HANDOFF.md",
  "setup.sh",
  "tests",
  "upload-log.txt",
  "uploader-config.json",
  ".DS_Store",
]);

describe("uploaderKit", () => {
  it("bundles every non-dev file in scripts/client-uploader byte-for-byte", () => {
    const diskEntries = fs
      .readdirSync(KIT_DIR)
      .filter((name) => !DEV_ONLY_ENTRIES.has(name) && !name.startsWith("._"))
      .sort();

    expect(UPLOADER_KIT_FILES.map((entry) => entry.name).sort()).toEqual(diskEntries);

    for (const entry of UPLOADER_KIT_FILES) {
      const disk = fs.readFileSync(path.join(KIT_DIR, entry.name), "utf8");
      expect(entry.content).toBe(disk);
    }
  });

  it("formats uploader-config.json matching setup.sh and rejects invalid config", () => {
    const key = "0123456789abcdef".repeat(4);
    const formatted = formatUploaderConfig({
      url: "https://demo.convex.site///",
      key: `  ${key}  `,
    });
    expect(formatted.endsWith("\n")).toBe(true);
    expect(JSON.parse(formatted)).toEqual({
      url: "https://demo.convex.site",
      key,
      root: "",
    });

    expect(() => formatUploaderConfig({ url: "http://demo.convex.site", key })).toThrow(/https:\/\//);
    expect(() => formatUploaderConfig({ url: "https://demo.convex.site", key: "too-short" })).toThrow(/too short/i);
  });

  it("builds a zip with all kit files, live config, and Unix regular-file exec permissions", async () => {
    const key = "fedcba9876543210".repeat(4);
    const bytes = await buildUploaderZipBytes({
      url: "https://demo.convex.site/",
      key,
    });

    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([
      "README.txt",
      "Run-Uploader.bat",
      "Run-Uploader.command",
      "banhall-uploader.ps1",
      "banhall-uploader.sh",
      "uploader-config.json",
      "uploader-lib.ps1",
    ]);

    expect(zip.files["setup.sh"]).toBeUndefined();
    expect(zip.files["DEV-HANDOFF.md"]).toBeUndefined();

    const configText = await zip.file(UPLOADER_CONFIG_NAME)!.async("string");
    expect(JSON.parse(configText)).toEqual({
      url: "https://demo.convex.site",
      key,
      root: "",
    });

    // Executable Mac launchers must keep regular-file S_IFREG + 0755; others 0644.
    const executables = new Set(["Run-Uploader.command", "banhall-uploader.sh"]);
    for (const [name, file] of Object.entries(zip.files)) {
      const expectedMode = executables.has(name) ? 0o100755 : 0o100644;
      expect(file.unixPermissions).toBe(expectedMode);
    }
  });
});
