import { describe, it, expect } from "vitest";
import {
    markdownToConfluenceStorage,
    confluenceStorageToMarkdown,
} from "../src/converter";

// ─── markdownToConfluenceStorage ─────────────────────────────────────────────

describe("markdownToConfluenceStorage", () => {
    it("converts headings", () => {
        expect(markdownToConfluenceStorage("# Title")).toContain("<h1>Title</h1>");
        expect(markdownToConfluenceStorage("## Sub")).toContain("<h2>Sub</h2>");
        expect(markdownToConfluenceStorage("### Sub2")).toContain("<h3>Sub2</h3>");
    });

    it("converts bold and italic", () => {
        const result = markdownToConfluenceStorage("**bold** and *italic*");
        expect(result).toContain("<strong>bold</strong>");
        expect(result).toContain("<em>italic</em>");
    });

    it("converts strikethrough", () => {
        expect(markdownToConfluenceStorage("~~gone~~")).toContain("<del>gone</del>");
    });

    it("converts inline code", () => {
        expect(markdownToConfluenceStorage("use `npm install`")).toContain(
            "<code>npm install</code>"
        );
    });

    it("converts fenced code blocks to Confluence code macro", () => {
        const md = "```python\nprint('hi')\n```";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('ac:name="code"');
        expect(result).toContain('ac:name="language">python</ac:parameter>');
        expect(result).toContain("print('hi')");
    });

    it("converts unordered lists", () => {
        const md = "- one\n- two\n- three";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<ul>");
        expect(result).toContain("<li>one</li>");
        expect(result).toContain("<li>two</li>");
    });

    it("converts ordered lists", () => {
        const md = "1. first\n2. second";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<ol>");
        expect(result).toContain("<li>first</li>");
    });

    it("converts links", () => {
        const md = "[click here](https://example.com)";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<a href="https://example.com">click here</a>');
    });

    it("converts images", () => {
        const md = "![alt](https://example.com/img.png)";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("ac:image");
        expect(result).toContain("https://example.com/img.png");
    });

    it("converts horizontal rules", () => {
        expect(markdownToConfluenceStorage("---")).toContain("<hr/>");
    });

    it("converts blockquotes", () => {
        const md = "> quoted text";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<blockquote>");
        expect(result).toContain("quoted text");
    });

    it("escapes XML special characters in plain text", () => {
        const md = "a < b & c > d";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("a &lt; b &amp; c &gt; d");
    });

    it("strips YAML frontmatter", () => {
        const md = "---\ntitle: Test\n---\n# Hello";
        const result = markdownToConfluenceStorage(md);
        expect(result).not.toContain("title: Test");
        expect(result).toContain("<h1>Hello</h1>");
    });

    it("strips Obsidian wiki links", () => {
        const md = "See [[My Page]] for details";
        const result = markdownToConfluenceStorage(md);
        expect(result).not.toContain("[[");
        expect(result).toContain("My Page");
    });

    it("strips wiki links with aliases", () => {
        const md = "See [[My Page|the page]] for details";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("the page");
        expect(result).not.toContain("My Page");
    });

    it("strips Obsidian embeds", () => {
        const md = "Check ![[embedded-file.png]] here";
        const result = markdownToConfluenceStorage(md);
        expect(result).not.toContain("![[");
        expect(result).not.toContain("embedded-file");
    });

    it("converts Obsidian highlights to bold", () => {
        const md = "this is ==important== text";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<strong>important</strong>");
    });

    it("strips footnote references", () => {
        const md = "Some text[^1] more\n\n[^1]: footnote def";
        const result = markdownToConfluenceStorage(md);
        expect(result).not.toContain("[^1]");
    });

    it("normalizes tabs to spaces", () => {
        const md = "- \tindented";
        const result = markdownToConfluenceStorage(md);
        expect(result).not.toContain("\t");
    });

    it("wraps plain text lines in paragraphs", () => {
        const md = "Just a simple line of text";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<p>");
    });
});

// ─── confluenceStorageToMarkdown ─────────────────────────────────────────────

describe("confluenceStorageToMarkdown", () => {
    it("converts headings", () => {
        expect(confluenceStorageToMarkdown("<h1>Title</h1>")).toContain("# Title");
        expect(confluenceStorageToMarkdown("<h2>Sub</h2>")).toContain("## Sub");
        expect(confluenceStorageToMarkdown("<h3>Sub3</h3>")).toContain("### Sub3");
    });

    it("converts bold and italic", () => {
        const result = confluenceStorageToMarkdown(
            "<strong>bold</strong> and <em>italic</em>"
        );
        expect(result).toContain("**bold**");
        expect(result).toContain("*italic*");
    });

    it("converts strikethrough", () => {
        expect(confluenceStorageToMarkdown("<del>gone</del>")).toContain("~~gone~~");
    });

    it("converts inline code", () => {
        expect(confluenceStorageToMarkdown("<code>foo</code>")).toContain("`foo`");
    });

    it("converts Confluence code macro to fenced code block", () => {
        const storage =
            '<ac:structured-macro ac:name="code">' +
            '<ac:parameter ac:name="language">js</ac:parameter>' +
            "<ac:plain-text-body><![CDATA[console.log('hi')]]></ac:plain-text-body>" +
            "</ac:structured-macro>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("```js");
        expect(result).toContain("console.log('hi')");
    });

    it("converts unordered lists", () => {
        const storage = "<ul><li>a</li><li>b</li></ul>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("- a");
        expect(result).toContain("- b");
    });

    it("converts ordered lists", () => {
        const storage = "<ol><li>first</li><li>second</li></ol>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("1. first");
        expect(result).toContain("2. second");
    });

    it("converts links", () => {
        const storage = '<a href="https://example.com">link</a>';
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("[link](https://example.com)");
    });

    it("converts images", () => {
        const storage =
            '<ac:image><ri:url ri:value="https://example.com/img.png"/></ac:image>';
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("![](https://example.com/img.png)");
    });

    it("converts horizontal rules", () => {
        expect(confluenceStorageToMarkdown("<hr/>")).toContain("---");
    });

    it("converts paragraphs", () => {
        const result = confluenceStorageToMarkdown("<p>Hello world</p>");
        expect(result).toContain("Hello world");
    });

    it("converts blockquotes", () => {
        const storage = "<blockquote><p>quoted</p></blockquote>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("> quoted");
    });

    it("decodes HTML entities", () => {
        const storage = "<p>a &amp; b &lt; c &gt; d</p>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("a & b < c > d");
    });

    it("strips remaining HTML tags", () => {
        const storage = "<p><span class='x'>text</span></p>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("text");
        expect(result).not.toContain("<span");
    });

    it("collapses excessive blank lines", () => {
        const storage = "<p>a</p>\n\n\n\n<p>b</p>";
        const result = confluenceStorageToMarkdown(storage);
        const blankRuns = result.match(/\n{3,}/g);
        expect(blankRuns).toBeNull();
    });
});

// ─── Round-trip stability ────────────────────────────────────────────────────

describe("round-trip", () => {
    it("headings survive a round-trip", () => {
        const md = "# Hello World";
        const storage = markdownToConfluenceStorage(md);
        const backToMd = confluenceStorageToMarkdown(storage);
        expect(backToMd).toContain("# Hello World");
    });

    it("bold text survives a round-trip", () => {
        const md = "This is **important**";
        const storage = markdownToConfluenceStorage(md);
        const backToMd = confluenceStorageToMarkdown(storage);
        expect(backToMd).toContain("**important**");
    });

    it("links survive a round-trip", () => {
        const md = "[example](https://example.com)";
        const storage = markdownToConfluenceStorage(md);
        const backToMd = confluenceStorageToMarkdown(storage);
        expect(backToMd).toContain("[example](https://example.com)");
    });
});
