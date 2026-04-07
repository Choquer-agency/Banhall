import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  BorderStyle,
  AlignmentType,
  SectionType,
} from "docx";
import { saveAs } from "file-saver";

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

/**
 * Export a Tiptap JSON document to a Word .docx file.
 * Strips QA scorecard, gap callouts, and other UI-only elements.
 * Produces a clean, formal report suitable for CRA submission.
 */
export async function exportToDocx(
  content: string,
  filename: string
): Promise<void> {
  const doc = JSON.parse(content) as TiptapNode;
  if (!doc.content) throw new Error("Invalid document");

  const children: Paragraph[] = [];
  let isFirstHeading = true;

  for (const node of doc.content) {
    // Skip QA scorecard (codeBlock with JSON)
    if (node.type === "codeBlock") continue;

    switch (node.type) {
      case "heading": {
        const level = (node.attrs?.level as number) ?? 2;
        const text = extractPlainText(node);

        // Skip QA-related headings
        if (text.toLowerCase().includes("qa scorecard")) continue;

        if (level === 1) {
          children.push(
            new Paragraph({
              text,
              heading: HeadingLevel.TITLE,
              spacing: { after: 200 },
            })
          );
          isFirstHeading = false;
        } else if (level === 2) {
          // Add spacing before section headings (except first)
          if (!isFirstHeading) {
            children.push(new Paragraph({ spacing: { before: 400 } }));
          }
          children.push(
            new Paragraph({
              text,
              heading: HeadingLevel.HEADING_1,
              spacing: { after: 200 },
              border: {
                bottom: {
                  style: BorderStyle.SINGLE,
                  size: 1,
                  color: "CCCCCC",
                },
              },
            })
          );
          isFirstHeading = false;
        } else {
          children.push(
            new Paragraph({
              text,
              heading: HeadingLevel.HEADING_2,
              spacing: { after: 120 },
            })
          );
        }
        break;
      }

      case "paragraph": {
        const runs = buildTextRuns(node);
        // Skip empty paragraphs
        if (runs.length === 0) {
          children.push(new Paragraph({ spacing: { after: 120 } }));
          break;
        }

        // Check if entire paragraph is a GAP marker — skip it
        const plainText = extractPlainText(node);
        if (plainText.match(/^\[GAP:.*\]$/)) continue;

        children.push(
          new Paragraph({
            children: runs,
            spacing: { after: 200, line: 360 },
            alignment: AlignmentType.JUSTIFIED,
          })
        );
        break;
      }

      case "horizontalRule": {
        children.push(
          new Paragraph({
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 1,
                color: "CCCCCC",
              },
            },
            spacing: { before: 200, after: 200 },
          })
        );
        break;
      }

      case "blockquote": {
        const quoteText = extractPlainText(node);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: quoteText,
                italics: true,
                color: "666666",
              }),
            ],
            indent: { left: 720 },
            spacing: { after: 200, line: 360 },
          })
        );
        break;
      }

      case "bulletList":
      case "orderedList": {
        if (node.content) {
          for (const item of node.content) {
            const itemText = extractPlainText(item);
            children.push(
              new Paragraph({
                children: [new TextRun({ text: itemText, font: "Georgia" })],
                bullet: node.type === "bulletList" ? { level: 0 } : undefined,
                numbering:
                  node.type === "orderedList"
                    ? { reference: "default-numbering", level: 0 }
                    : undefined,
                spacing: { after: 80 },
              })
            );
          }
        }
        break;
      }
    }
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Georgia",
            size: 22, // 11pt
            color: "333333",
          },
          paragraph: {
            spacing: { line: 360 },
          },
        },
        heading1: {
          run: {
            font: "Calibri",
            size: 28, // 14pt
            bold: true,
            color: "1A1A2E",
          },
        },
        heading2: {
          run: {
            font: "Calibri",
            size: 24, // 12pt
            bold: true,
            color: "333333",
          },
        },
        title: {
          run: {
            font: "Calibri",
            size: 36, // 18pt
            bold: true,
            color: "1A1A2E",
          },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          type: SectionType.CONTINUOUS,
          page: {
            margin: {
              top: 1440, // 1 inch
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  saveAs(blob, `${filename}.docx`);
}

function extractPlainText(node: TiptapNode): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content.map(extractPlainText).join("");
}

function buildTextRuns(node: TiptapNode): TextRun[] {
  if (!node.content) return [];

  const runs: TextRun[] = [];

  for (const child of node.content) {
    if (child.type === "text" && child.text) {
      // Skip GAP markers in inline text
      if (child.marks?.some((m) => m.attrs?.color === "#FEF3C7")) {
        continue;
      }

      const bold = child.marks?.some((m) => m.type === "bold") ?? false;
      const italic = child.marks?.some((m) => m.type === "italic") ?? false;
      const underline = child.marks?.some((m) => m.type === "underline")
        ? {}
        : undefined;

      runs.push(
        new TextRun({
          text: child.text,
          bold,
          italics: italic,
          underline,
          font: "Georgia",
          size: 22,
        })
      );
    } else if (child.content) {
      runs.push(...buildTextRuns(child));
    }
  }

  return runs;
}
