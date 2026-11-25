/**
 * Client uploader kit zip builder (lazy-loaded on click from Get the uploader).
 *
 * Imports the kit scripts directly from scripts/client-uploader/ via Vite ?raw
 * so the in-app download always ships the exact latest scripts without manual
 * duplication. Sets Unix regular-file permissions (100755 on the Mac launchers,
 * 100644 on everything else) with platform: "UNIX" so macOS preserves the exec
 * bit on unzip, matching scripts/client-uploader/setup.sh.
 */
import readmeTxt from "../../../../scripts/client-uploader/README.txt?raw";
import runUploaderBat from "../../../../scripts/client-uploader/Run-Uploader.bat?raw";
import runUploaderCommand from "../../../../scripts/client-uploader/Run-Uploader.command?raw";
import banhallUploaderPs1 from "../../../../scripts/client-uploader/banhall-uploader.ps1?raw";
import uploaderLibPs1 from "../../../../scripts/client-uploader/uploader-lib.ps1?raw";
import banhallUploaderSh from "../../../../scripts/client-uploader/banhall-uploader.sh?raw";

export const UPLOADER_ZIP_NAME = "banhall-uploader.zip";
export const UPLOADER_CONFIG_NAME = "uploader-config.json";
export const MIN_INGEST_KEY_LENGTH = 32;

export type UploaderConfig = {
  url: string;
  key: string;
};

export type UploaderKitEntry = {
  name: string;
  content: string;
  executable: boolean;
};

/** Exact allowlist of kit files shipped inside banhall-uploader.zip (excludes setup.sh, DEV-HANDOFF.md, tests/). */
export const UPLOADER_KIT_FILES: readonly UploaderKitEntry[] = [
  { name: "README.txt", content: readmeTxt, executable: false },
  { name: "Run-Uploader.bat", content: runUploaderBat, executable: false },
  { name: "Run-Uploader.command", content: runUploaderCommand, executable: true },
  { name: "banhall-uploader.ps1", content: banhallUploaderPs1, executable: false },
  { name: "uploader-lib.ps1", content: uploaderLibPs1, executable: false },
  { name: "banhall-uploader.sh", content: banhallUploaderSh, executable: true },
];

/** Formats uploader-config.json to match scripts/client-uploader/setup.sh. */
export function formatUploaderConfig(config: UploaderConfig): string {
  const url = config.url.trim().replace(/\/+$/, "");
  const key = config.key.trim();
  if (!url.startsWith("https://")) {
    throw new Error("Upload address must start with https://.");
  }
  if (key.length < MIN_INGEST_KEY_LENGTH) {
    throw new Error("Uploader key is missing or too short.");
  }
  return `${JSON.stringify({ url, key, root: "" }, null, 2)}\n`;
}

/** Builds banhall-uploader.zip bytes with Unix regular-file modes preserved. */
export async function buildUploaderZipBytes(config: UploaderConfig): Promise<Uint8Array> {
  const configJson = formatUploaderConfig(config);
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const entry of UPLOADER_KIT_FILES) {
    zip.file(entry.name, entry.content, {
      unixPermissions: entry.executable ? "100755" : "100644",
    });
  }
  zip.file(UPLOADER_CONFIG_NAME, configJson, { unixPermissions: "100644" });
  return await zip.generateAsync({
    type: "uint8array",
    platform: "UNIX",
    compression: "DEFLATE",
  });
}

/** Builds banhall-uploader.zip and triggers a browser download. */
export async function downloadUploaderKit(config: UploaderConfig): Promise<void> {
  const [bytes, { saveAs }] = await Promise.all([
    buildUploaderZipBytes(config),
    import("file-saver"),
  ]);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "application/zip" });
  saveAs(blob, UPLOADER_ZIP_NAME);
}
