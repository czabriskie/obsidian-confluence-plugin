import { describe, it, expect } from "vitest";
import {
    markdownToConfluenceStorage,
    confluenceStorageToMarkdown,
    formatCommentsAsMarkdown,
    COMMENTS_SECTION_MARKER,
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

    it("escapes HTML tags inside inline code", () => {
        const result = markdownToConfluenceStorage("Video embedded via Stream `<iframe>` tag.");
        expect(result).toContain("<code>&lt;iframe&gt;</code>");
        expect(result).not.toContain("<code><iframe></code>");
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

    it("converts nested unordered lists", () => {
        const md = "- top\n  - child\n  - child2\n- other";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<ul><li>top<ul><li>child</li><li>child2</li></ul></li><li>other</li></ul>");
    });

    it("converts deeply nested lists", () => {
        const md = "- a\n  - b\n    - c\n  - d";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<ul><li>a<ul><li>b<ul><li>c</li></ul></li><li>d</li></ul></li></ul>");
    });

    it("converts nested ordered lists", () => {
        const md = "1. first\n   1. sub\n   2. sub2\n2. second";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<ol><li>first<ol><li>sub</li><li>sub2</li></ol></li><li>second</li></ol>");
    });

    it("converts unchecked checkbox to task list", () => {
        const md = "- [ ] Buy groceries\n- [ ] Walk the dog";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<ac:task-list>");
        expect(result).toContain("<ac:task-id>");
        expect(result).toContain("<ac:task-status>incomplete</ac:task-status>");
        expect(result).toContain('<span class="placeholder-inline-tasks">Buy groceries</span>');
        expect(result).toContain('<span class="placeholder-inline-tasks">Walk the dog</span>');
    });

    it("converts checked checkbox to complete task", () => {
        const md = "- [x] Done item";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<ac:task-status>complete</ac:task-status>");
        expect(result).toContain('<span class="placeholder-inline-tasks">Done item</span>');
    });

    it("converts mixed checkboxes", () => {
        const md = "- [x] First\n- [ ] Second\n- [x] Third";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<ac:task-list>");
        expect((result.match(/<ac:task>/g) || []).length).toBe(3);
    });

    it("does not convert checkboxes inside code blocks", () => {
        const md = "```\n- [ ] not a task\n```";
        const result = markdownToConfluenceStorage(md);
        expect(result).not.toContain("<ac:task-list>");
    });

    it("converts links", () => {
        const md = "[click here](https://example.com)";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<a href="https://example.com">click here</a>');
    });

    it("auto-links bare URLs in table cells", () => {
        const md = "| Key | Value |\n|---|---|\n| Jira | https://zontal.atlassian.net/browse/ZSPACE-32230 |";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<a href="https://zontal.atlassian.net/browse/ZSPACE-32230">');
    });

    it("auto-links bare URLs in plain text paragraphs", () => {
        const md = "Visit https://example.com for details.";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<a href="https://example.com">https://example.com</a>');
    });

    it("does not double-link markdown links", () => {
        const md = "[click](https://example.com)";
        const result = markdownToConfluenceStorage(md);
        const matches = result.match(/href="https:\/\/example\.com"/g) || [];
        expect(matches.length).toBe(1);
    });

    it("converts links with title attribute", () => {
        const md = '[MR](https://gitlab.com/org/repo/-/merge_requests/405 "https://gitlab.com/org/repo/-/merge_requests/405")';
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<a href="https://gitlab.com/org/repo/-/merge_requests/405">MR</a>');
        expect(result).not.toContain('href="https://gitlab.com/org/repo/-/merge_requests/405 ');
    });

    it("converts multiple inline links with complex URLs", () => {
        const md = 'Could someone take a look at the [MR](https://gitlab.com/zontal/infrastructure/gitlab-ci-resources/-/merge_requests/405 "https://gitlab.com/zontal/infrastructure/gitlab-ci-resources/-/merge_requests/405") for that?';
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<a href="https://gitlab.com/zontal/infrastructure/gitlab-ci-resources/-/merge_requests/405">MR</a>');
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

    it("converts Warning callout to Confluence warning macro", () => {
        const md = "> [!Warning] This Didn't seem to Actually do Anything. Root Cause still unknown";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<ac:structured-macro ac:name="warning">');
        expect(result).toContain('<ac:parameter ac:name="title">This Didn\'t seem to Actually do Anything. Root Cause still unknown</ac:parameter>');
        expect(result).not.toContain("<blockquote>");
    });

    it("converts Note callout to Confluence note macro", () => {
        const md = "> [!Note] Important information";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<ac:structured-macro ac:name="note">');
        expect(result).toContain('<ac:parameter ac:name="title">Important information</ac:parameter>');
    });

    it("converts Info callout to Confluence info macro", () => {
        const md = "> [!Info] For your information";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<ac:structured-macro ac:name="info">');
        expect(result).toContain('<ac:parameter ac:name="title">For your information</ac:parameter>');
    });

    it("converts Tip callout to Confluence tip macro", () => {
        const md = "> [!Tip] Pro tip here";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<ac:structured-macro ac:name="tip">');
        expect(result).toContain('<ac:parameter ac:name="title">Pro tip here</ac:parameter>');
    });

    it("converts multi-line callout with body content", () => {
        const md = "> [!Warning] Title\n> First line\n> Second line";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<ac:structured-macro ac:name="warning">');
        expect(result).toContain('<ac:parameter ac:name="title">Title</ac:parameter>');
        expect(result).toContain('<ac:rich-text-body><p>First line Second line</p></ac:rich-text-body>');
    });

    it("converts callout without title", () => {
        const md = "> [!Note]\n> Just the content without a title";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<ac:structured-macro ac:name="note">');
        expect(result).toContain('<ac:rich-text-body><p>Just the content without a title</p></ac:rich-text-body>');
        expect(result).not.toContain('<ac:parameter ac:name="title">');
    });

    it("converts callout with inline formatting in body", () => {
        const md = "> [!Info] Title\n> This has **bold** and *italic* and `code`";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain('<ac:structured-macro ac:name="info">');
        expect(result).toContain('<strong>bold</strong>');
        expect(result).toContain('<em>italic</em>');
        expect(result).toContain('<code>code</code>');
    });

    it("maps various callout types to appropriate Confluence macros", () => {
        expect(markdownToConfluenceStorage("> [!danger] text")).toContain('<ac:structured-macro ac:name="warning">');
        expect(markdownToConfluenceStorage("> [!error] text")).toContain('<ac:structured-macro ac:name="warning">');
        expect(markdownToConfluenceStorage("> [!bug] text")).toContain('<ac:structured-macro ac:name="warning">');
        expect(markdownToConfluenceStorage("> [!success] text")).toContain('<ac:structured-macro ac:name="tip">');
        expect(markdownToConfluenceStorage("> [!example] text")).toContain('<ac:structured-macro ac:name="info">');
    });

    it("converts a simple table", () => {
        const md = "| Key | Value |\n|---|---|\n| foo | bar |";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<table>");
        expect(result).toContain("<thead>");
        expect(result).toContain("<th><p>Key</p></th>");
        expect(result).toContain("<th><p>Value</p></th>");
        expect(result).toContain("<tbody>");
        expect(result).toContain("<td><p>foo</p></td>");
        expect(result).toContain("<td><p>bar</p></td>");
    });

    it("converts a table with blank-line-separated rows (Obsidian style)", () => {
        const md = "| Key | Op | Val |\n\n|---|---|---|\n\n| arch | In | amd64 |\n\n| os | In | linux |";
        const result = markdownToConfluenceStorage(md);
        expect(result).toContain("<table>");
        expect(result).toContain("<th><p>Key</p></th>");
        expect(result).toContain("<td><p>arch</p></td>");
        expect(result).toContain("<td><p>os</p></td>");
        // separator row must not appear as a data row
        expect(result).not.toContain("<td><p>---</p></td>");
    });

    it("escapes HTML-like content in backtick-wrapped table cells", () => {
        const md = "| Block | Purpose |\n|---|---|\n| `<script id=\"Cookiebot\">` | Consent manager |\n| `<noscript><iframe src=\"...\">` | Fallback |";
        const result = markdownToConfluenceStorage(md);
        // Backtick-wrapped HTML-like values must be XML-escaped, not left as raw tags
        expect(result).toContain("&lt;script id=");
        expect(result).toContain("&lt;noscript&gt;&lt;iframe");
        expect(result).not.toContain("<script");
        expect(result).not.toContain("<noscript>");
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

    it("resolves wiki link to Confluence URL when page is in the map", () => {
        const map = new Map([["my page", "https://wiki.example.com/pages/viewpage.action?pageId=123"]]);
        const result = markdownToConfluenceStorage("See [[My Page]] for details", map);
        expect(result).toContain('<a href="https://wiki.example.com/pages/viewpage.action?pageId=123">My Page</a>');
    });

    it("resolves wiki link alias to Confluence URL", () => {
        const map = new Map([["my page", "https://wiki.example.com/pages/viewpage.action?pageId=123"]]);
        const result = markdownToConfluenceStorage("See [[My Page|the page]] for details", map);
        expect(result).toContain('<a href="https://wiki.example.com/pages/viewpage.action?pageId=123">the page</a>');
    });

    it("falls back to plain text for wiki links not in the map", () => {
        const map = new Map([["other page", "https://wiki.example.com/pages/viewpage.action?pageId=999"]]);
        const result = markdownToConfluenceStorage("See [[Unknown Page]] for details", map);
        expect(result).not.toContain("<a href");
        expect(result).toContain("Unknown Page");
    });

    it("resolves wiki link with file extension to Confluence URL", () => {
        const map = new Map([["my page", "https://wiki.example.com/pages/viewpage.action?pageId=123"]]);
        const result = markdownToConfluenceStorage("See [[My Page.md]] for details", map);
        expect(result).toContain('<a href="https://wiki.example.com/pages/viewpage.action?pageId=123">My Page</a>');
    });

    it("resolves path-prefixed wiki link using last segment", () => {
        const map = new Map([["my page", "https://wiki.example.com/pages/viewpage.action?pageId=123"]]);
        const result = markdownToConfluenceStorage("See [[Folder/My Page]] for details", map);
        expect(result).toContain('<a href="https://wiki.example.com/pages/viewpage.action?pageId=123">My Page</a>');
    });

    it("converts Obsidian image embeds to ac:image macro", () => {
        const md = "Check ![[embedded-file.png]] here";
        const result = markdownToConfluenceStorage(md);
        expect(result).not.toContain("![[");
        expect(result).toContain('<ac:image><ri:attachment ri:filename="embedded-file.png"/></ac:image>');
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

    it("strips Waypoint markers and preserves wiki links inside as Confluence links", () => {
        const map = new Map([
            ["s3 bucket cleanup", "https://wiki.example.com/pages/viewpage.action?pageId=1"],
            ["source control management", "https://wiki.example.com/pages/viewpage.action?pageId=2"],
        ]);
        const md = [
            "%% Begin Waypoint %%",
            "- [[S3 Bucket Cleanup]]",
            "- [[Source Control Management]]",
            "- [[Unknown Page]]",
            "%% End Waypoint %%",
        ].join("\n");
        const result = markdownToConfluenceStorage(md, map);
        expect(result).not.toContain("%% Begin Waypoint %%");
        expect(result).not.toContain("%% End Waypoint %%");
        expect(result).toContain('<a href="https://wiki.example.com/pages/viewpage.action?pageId=1">S3 Bucket Cleanup</a>');
        expect(result).toContain('<a href="https://wiki.example.com/pages/viewpage.action?pageId=2">Source Control Management</a>');
        expect(result).toContain("Unknown Page");
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

    it("converts task list to checkboxes", () => {
        const storage = '<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body><span class="placeholder-inline-tasks">Buy milk</span></ac:task-body></ac:task><ac:task><ac:task-id>2</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body><span class="placeholder-inline-tasks">Walk dog</span></ac:task-body></ac:task></ac:task-list>';
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("- [ ] Buy milk");
        expect(result).toContain("- [x] Walk dog");
    });

    it("converts task list without IDs or spans (legacy format)", () => {
        const storage = '<ac:task-list><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>No id</ac:task-body></ac:task></ac:task-list>';
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("- [ ] No id");
    });

    it("converts tables to markdown", () => {
        const storage = "<table><thead><tr><th><p>Name</p></th><th><p>Value</p></th></tr></thead><tbody><tr><td><p>A</p></td><td><p>1</p></td></tr><tr><td><p>B</p></td><td><p>2</p></td></tr></tbody></table>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("| Name | Value |");
        expect(result).toContain("| --- | --- |");
        expect(result).toContain("| A | 1 |");
        expect(result).toContain("| B | 2 |");
    });

    it("converts tables with links in cells", () => {
        const storage = '<table><thead><tr><th><p>Field</p></th><th><p>Link</p></th></tr></thead><tbody><tr><td><p>Jira</p></td><td><p><a href="https://example.com">ticket</a></p></td></tr></tbody></table>';
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("| Jira | [ticket](https://example.com) |");
    });

    it("converts tables without thead", () => {
        const storage = "<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("| A | B |");
        expect(result).toContain("| 1 | 2 |");
    });

    it("decodes named HTML entities (mdash, rarr, sect, etc.)", () => {
        const storage = "<p>a &mdash; b &rarr; c &sect; d &ndash; e</p>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("a — b → c § d – e");
    });

    it("decodes numeric character references", () => {
        const storage = "<p>&#169; &#x2603;</p>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("©");
        expect(result).toContain("☃");
    });

    it("separates headings from surrounding content", () => {
        const storage = "<p>Before</p><h1>Title</h1><p>After</p>";
        const result = confluenceStorageToMarkdown(storage);
        // Heading must be on its own line, not concatenated
        expect(result).toMatch(/Before\n+# Title\n+After/);
    });

    it("converts attachment images to Obsidian embed", () => {
        const storage = '<ac:image><ri:attachment ri:filename="diagram.png"/></ac:image>';
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("![[diagram.png]]");
    });

    it("converts br tags to newlines", () => {
        const storage = "<p>line one<br/>line two</p>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("line one\nline two");
    });

    it("converts nested lists", () => {
        const storage = "<ul><li>top<ul><li>child</li><li>child2</li></ul></li><li>other</li></ul>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("- top");
        expect(result).toContain("  - child");
        expect(result).toContain("  - child2");
        expect(result).toContain("- other");
    });

    it("converts ordered lists", () => {
        const storage = "<ol><li>first</li><li>second</li></ol>";
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("1. first");
        expect(result).toContain("2. second");
    });

    it("converts info/note/warning macros to callouts", () => {
        const storage = '<ac:structured-macro ac:name="note"><ac:parameter ac:name="title">Important</ac:parameter><ac:rich-text-body><p>Check this</p></ac:rich-text-body></ac:structured-macro>';
        const result = confluenceStorageToMarkdown(storage);
        expect(result).toContain("> [!NOTE] Important");
        expect(result).toContain("> Check this");
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

// ─── Comments ───────────────────────────────────────────────────────────────────────

describe("formatCommentsAsMarkdown", () => {
    it("returns empty string for no comments", () => {
        expect(formatCommentsAsMarkdown([])).toBe("");
    });

    it("formats a single comment with author and body", () => {
        const result = formatCommentsAsMarkdown([
            { author: "Alice", body: "<p>Looks good!</p>", createdAt: "2025-01-15T10:30:00Z" },
        ]);
        expect(result).toContain(COMMENTS_SECTION_MARKER);
        expect(result).toContain("## Comments");
        expect(result).toContain("> **Alice**");
        expect(result).toContain("> Looks good!");
    });

    it("formats multiple comments", () => {
        const result = formatCommentsAsMarkdown([
            { author: "Alice", body: "<p>First</p>", createdAt: "2025-01-15T10:30:00Z" },
            { author: "Bob", body: "<p>Second</p>", createdAt: "2025-01-15T11:00:00Z" },
        ]);
        expect(result).toContain("> **Alice**");
        expect(result).toContain("> **Bob**");
        expect(result).toContain("> First");
        expect(result).toContain("> Second");
    });

    it("converts HTML in comment body to markdown", () => {
        const result = formatCommentsAsMarkdown([
            { author: "Eve", body: "<p>Check <strong>this</strong> out</p>", createdAt: "" },
        ]);
        expect(result).toContain("> Check **this** out");
    });
});

describe("comments section stripping on push", () => {
    it("strips comments section from markdown before converting", () => {
        const md = `# Title\n\nSome content\n\n${COMMENTS_SECTION_MARKER}\n## Comments\n\n> **Alice** — Jan 15, 2025\n> Great work!`;
        const storage = markdownToConfluenceStorage(md);
        expect(storage).toContain("Title");
        expect(storage).toContain("Some content");
        expect(storage).not.toContain("Comments");
        expect(storage).not.toContain("Alice");
        expect(storage).not.toContain("Great work");
    });

    it("handles markdown with no comments section", () => {
        const md = "# Title\n\nContent";
        const storage = markdownToConfluenceStorage(md);
        expect(storage).toContain("Title");
        expect(storage).toContain("Content");
    });
});
