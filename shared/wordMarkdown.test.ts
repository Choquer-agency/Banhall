import { describe, expect, it } from "vitest";
import { escapeMarks, quotableWordText, wordHtmlToMarkdown } from "./wordMarkdown";

describe("wordHtmlToMarkdown", () => {
  it("keeps headings, bold, italic and tables from mammoth's HTML", () => {
    const html =
      '<h1>Seal trials</h1><p>The seal <strong>held</strong> at <em>4.2 bar</em> in trial 3.</p><h2>Method</h2><p>Line one of the method.</p><table><tr><td><p>Trial</p></td><td><p>Pressure</p></td><td><p>Result</p></td></tr><tr><td><p>1</p></td><td><p>3.1 bar</p></td><td><p>leak</p></td></tr><tr><td><p>2</p></td><td><p>4.2 bar</p></td><td><p>held</p></td></tr></table><p>Under 5 * 3 = 15 and a_b_c name.</p>';
    expect(wordHtmlToMarkdown(html)).toBe(
      [
        "# Seal trials",
        "The seal **held** at *4.2 bar* in trial 3.",
        "## Method",
        "Line one of the method.",
        "| Trial | Pressure | Result |\n| --- | --- | --- |\n| 1 | 3.1 bar | leak |\n| 2 | 4.2 bar | held |",
        "Under 5 \\* 3 = 15 and a_b_c name.",
      ].join("\n\n")
    );
  });

  it("keeps spaces outside the marks and drops empty marks", () => {
    expect(wordHtmlToMarkdown("<p>The <strong>seal </strong>held<em> </em>.</p>")).toBe("The **seal** held .");
  });

  it("writes lists in order, nested ones indented under their item", () => {
    const html = "<ul><li>Trial A<ul><li>Run 1</li><li>Run 2</li></ul></li><li>Trial B</li></ul><ol><li>First</li><li>Second</li></ol>";
    expect(wordHtmlToMarkdown(html)).toBe(["- Trial A", "  - Run 1", "  - Run 2", "- Trial B", "1. First", "2. Second"].join("\n\n"));
  });

  it("decodes entities, keeps link text, drops pictures, and turns breaks into lines", () => {
    const html = '<p>R&amp;D &lt;cold&gt; &quot;soak&quot; &#39;rig&#39; &#x2265; 3</p><p><a href="https://example.com">the log</a><img src="data:x" /></p><p>one<br />two</p>';
    expect(wordHtmlToMarkdown(html)).toBe(["R&D \\<cold> \"soak\" 'rig' ≥ 3", "the log", "one\ntwo"].join("\n\n"));
  });

  it("reads the same plain words as the raw reader, with marks added", () => {
    const html = "<p>Alpha <strong>beta</strong> <em>gamma</em></p>";
    expect(wordHtmlToMarkdown(html).replace(/\*/g, "")).toBe("Alpha beta gamma");
  });
});

describe("quotableWordText", () => {
  it("removes bold and italic marks and keeps headings, tables and the document's own asterisks", () => {
    const html =
      '<h1>Seal trials</h1><p>The seal <strong>held</strong> at <em>4.2 bar</em>, 5 * 3 = 15, path C:\\rig.</p><table><tr><td><p>a|b</p></td><td><p>x</p></td></tr></table>';
    const markdown = wordHtmlToMarkdown(html);
    expect(markdown).toContain("5 \\* 3");
    expect(markdown).toContain("C:\\\\rig");
    expect(markdown).toContain("a\\|b");
    expect(quotableWordText(markdown)).toBe(
      ["# Seal trials", "The seal held at 4.2 bar, 5 * 3 = 15, path C:\\rig.", "| a|b | x |\n| --- | --- |"].join("\n\n")
    );
  });
});

describe("escapeMarks", () => {
  it("lets plain text joined to Word Markdown come back unchanged", () => {
    const note = "Note: 5 * 3 rigs, path C:\\data, a | b.";
    expect(quotableWordText(`${escapeMarks(note)}\n**Report**`)).toBe(`${note}\nReport`);
  });
});

describe("the document's own text is never read as Markdown (review, 2026-10-26)", () => {
  const html = [
    "<p>Use &lt;cold&gt; _literal_ marks, [a link](https://example.com) and ![probe](//example.invalid/pixel).</p>",
    "<p># not a heading</p>",
    "<p>1. not a list, and - not a bullet</p>",
    "<p>- dash first</p>",
    "<p>`code` ~~struck~~ &amp;copy; a|b C:\\data file_name</p>",
  ].join("");

  it("escapes every sign Markdown would read, and the quotable view gives the words back", () => {
    const markdown = wordHtmlToMarkdown(html);
    expect(markdown).toContain("Use \\<cold> \\_literal\\_ marks, \\[a link](https://example.com) and !\\[probe](//example.invalid/pixel).");
    expect(markdown).toContain("\\# not a heading");
    expect(markdown).toContain("1\\. not a list");
    expect(markdown).toContain("\\- dash first");
    expect(markdown).toContain("\\`code\\` \\~\\~struck\\~\\~ \\&copy; a\\|b C:\\\\data file_name");
    expect(quotableWordText(markdown)).toBe(
      [
        "Use <cold> _literal_ marks, [a link](https://example.com) and ![probe](//example.invalid/pixel).",
        "# not a heading",
        "1. not a list, and - not a bullet",
        "- dash first",
        "`code` ~~struck~~ &copy; a|b C:\\data file_name",
      ].join("\n\n")
    );
  });

  it("keeps a list or a table inside a cell in that cell", () => {
    const table =
      "<table><tr><td><p>Trial A</p></td><td><ul><li>held 4.2 bar</li><li>no leak</li></ul></td></tr>" +
      "<tr><td><p>Trial B</p></td><td><table><tr><td>run 1</td><td>failed</td></tr><tr><td>run 2</td><td>held</td></tr></table></td></tr></table>";
    expect(wordHtmlToMarkdown(table)).toBe(
      "| Trial A | held 4.2 bar; no leak |\n| --- | --- |\n| Trial B | run 1, failed; run 2, held |"
    );
  });

  it("moves punctuation at a mark's edge outside it, so the mark closes", () => {
    expect(wordHtmlToMarkdown("<p><strong>Note:</strong>Text and <em> (aside) </em>here.</p>")).toBe(
      "**Note**:Text and  (*aside*) here."
    );
    expect(quotableWordText(wordHtmlToMarkdown("<p><strong>Note:</strong>Text</p>"))).toBe("Note:Text");
  });

  it("never turns a tab-indented paragraph into a code block", () => {
    expect(wordHtmlToMarkdown("<p>\tThe seal <strong>held</strong> at 5 * 3.</p>")).toBe("The seal **held** at 5 \\* 3.");
  });
});
