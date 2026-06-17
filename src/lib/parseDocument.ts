"use client";

export type ParsedFileType = "txt" | "md" | "pdf" | "docx" | "other";

export interface ParsedDocument {
  fileName: string;
  fileType: ParsedFileType;
  content: string;
}

/**
 * Extract plain text from an uploaded file entirely in the browser.
 * Supports .txt / .md (read directly), .docx (mammoth), and .pdf (pdf.js).
 * Anything else is read as text on a best-effort basis.
 */
export async function parseFileToText(file: File): Promise<ParsedDocument> {
  const name = file.name;
  const lower = name.toLowerCase();

  if (lower.endsWith(".txt")) {
    return { fileName: name, fileType: "txt", content: await file.text() };
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return { fileName: name, fileType: "md", content: await file.text() };
  }

  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { fileName: name, fileType: "docx", content: result.value.trim() };
  }

  if (lower.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    // Same-origin worker (copied into /public) — reliable, no CDN/CORS.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({
      data: arrayBuffer,
      useSystemFonts: true,
    }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      text += strings + "\n\n";
    }
    return { fileName: name, fileType: "pdf", content: text.trim() };
  }

  // Fallback — try to read as text.
  try {
    return { fileName: name, fileType: "other", content: await file.text() };
  } catch {
    return { fileName: name, fileType: "other", content: "" };
  }
}
