/**
 * Converts between Obsidian Markdown and Confluence Storage Format (XHTML).
 *
 * This is intentionally simple: a full round-trip converter would require
 * a proper parser. The functions here handle the most common Markdown
 * constructs. For richer conversion, you can swap in a library such as
 * `markdown-it` + a Confluence renderer.
 */

// ---------------------------------------------------------------------------
// Markdown → Confluence Storage Format
// ---------------------------------------------------------------------------

/** Escape characters that are invalid in XML text nodes. */
function escapeXmlText(text: string): string {
    return text
        .replace(/&(?![a-zA-Z#]\w{0,6};)/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

export function markdownToConfluenceStorage(markdown: string): string {
    let html = markdown;

    // Front-matter: strip YAML front-matter block (---...---) at the top
    html = html.replace(/^---[\s\S]*?---\n?/, "");

    // ── Obsidian-specific syntax ──────────────────────────────────────────
    // Callouts: > [!NOTE] Title → bold label in blockquote
    html = html.replace(/^> \[!(\w+)\]\s*(.*)/gm, (_, type, title) =>
        `> **${type}${title ? ": " + title : ""}**`
    );
    // Embedded files: ![[file]] → remove entirely
    html = html.replace(/!\[\[[^\]]*\]\]/g, "");
    // Wiki links with file extensions: [[File.ext|Alias]] or [[File.ext]] → just alias/filename without ext
    html = html.replace(/\[\[([^\]|]+\.[a-zA-Z0-9]+)\s*\|([^\]]+)\]\]/g, "$2");
    html = html.replace(/\[\[([^\]|]+\.[a-zA-Z0-9]+)\]\]/g, (_, f) => f.replace(/\.[^.]+$/, ""));
    // Regular wiki links: [[Page|Alias]] → Alias, [[Page]] → Page
    html = html.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
    html = html.replace(/\[\[([^\]]+)\]\]/g, "$1");
    // Highlights: ==text== → bold
    html = html.replace(/==(.+?)==/g, "**$1**");
    // Footnote references: [^1] → remove markers
    html = html.replace(/\[\^\w+\]/g, "");
    html = html.replace(/^\[\^\w+\]:.+$/gm, "");
    // Obsidian tags: standalone #tag (not headings) → plain text
    html = html.replace(/(?<=\s|^)#([a-zA-Z][a-zA-Z0-9_/-]*)/gm, "$1");
    // Normalize tabs to spaces (tab-indented lists cause XML issues)
    html = html.replace(/\t/g, "    ");

    // Headings
    html = html.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
    html = html.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
    html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // Code blocks (fenced)
    html = html.replace(
        /```(\w*)\n([\s\S]*?)```/g,
        (_, lang, code) => {
            const language = lang || "none";
            return (
                `<ac:structured-macro ac:name="code">` +
                (lang ? `<ac:parameter ac:name="language">${language}</ac:parameter>` : "") +
                `<ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body>` +
                `</ac:structured-macro>`
            );
        }
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/_(.+?)_/g, "<em>$1</em>");

    // Strikethrough
    html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

    // Horizontal rule
    html = html.replace(/^(?:---|\*\*\*|___)\s*$/gm, "<hr/>");

    // Blockquote
    html = html.replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>");

    // Unordered lists — handle indented items by flattening to single level
    html = html.replace(
        /((?:^[ ]*[-*+] .+\n?)+)/gm,
        (block) => {
            const items = block.trim().split("\n")
                .map((l) => `<li>${escapeXmlText(l.replace(/^[ ]*[-*+] /, ""))}</li>`)
                .join("");
            return `<ul>${items}</ul>`;
        }
    );

    // Ordered lists — flatten indented items
    html = html.replace(
        /((?:^[ ]*\d+\. .+\n?)+)/gm,
        (block) => {
            const items = block.trim().split("\n")
                .map((l) => `<li>${escapeXmlText(l.replace(/^[ ]*\d+\. /, ""))}</li>`)
                .join("");
            return `<ol>${items}</ol>`;
        }
    );

    // Images  ![alt](url)
    html = html.replace(
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        '<ac:image><ri:url ri:value="$2"/></ac:image>'
    );

    // Links  [text](url)
    html = html.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2">$1</a>'
    );

    // Paragraphs: wrap lines that are not already known block tags
    const BLOCK_TAG = /^<(h[1-6]|p|ul|ol|li|blockquote|hr|ac:|pre|div|table|tr|td|th)([\s>\/]|$)/i;
    const HAS_HTML = /<[a-zA-Z/]/;
    const lines = html.split("\n");
    const output: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (BLOCK_TAG.test(trimmed)) {
            output.push(line);
        } else if (trimmed === "") {
            output.push("");
        } else if (HAS_HTML.test(trimmed)) {
            // Line already has inline HTML tags (strong, em, a, code, etc.) — wrap as-is
            output.push(`<p>${trimmed}</p>`);
        } else {
            // Plain text — escape XML special chars
            output.push(`<p>${escapeXmlText(trimmed)}</p>`);
        }
    }

    return output.join("\n");
}

// ---------------------------------------------------------------------------
// Confluence Storage Format → Markdown
// ---------------------------------------------------------------------------

export function confluenceStorageToMarkdown(storage: string): string {
    let md = storage;

    // Code macro
    md = md.replace(
        /<ac:structured-macro ac:name="code"[^>]*>(?:<ac:parameter ac:name="language">(\w+)<\/ac:parameter>)?<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body><\/ac:structured-macro>/g,
        (_, lang, code) => "```" + (lang || "") + "\n" + code + "```"
    );

    // Headings
    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1");
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1");
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1");
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1");
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "##### $1");
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "###### $1");

    // Bold / Italic / Strikethrough / Code
    md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
    md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
    md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
    md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
    md = md.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

    // Blockquote
    md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
        return inner.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "> $1");
    });

    // Lists
    md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, inner) => {
        return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
    });
    md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
        let idx = 0;
        return inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, text: string) => `${++idx}. ${text}\n`);
    });

    // Images
    md = md.replace(/<ac:image[^>]*><ri:url ri:value="([^"]+)"[^/]*\/><\/ac:image>/gi, "![]($1)");

    // Links
    md = md.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

    // Horizontal rule
    md = md.replace(/<hr\s*\/?>/gi, "---");

    // Paragraphs
    md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");

    // Strip any remaining HTML tags
    md = md.replace(/<[^>]+>/g, "");

    // Decode common HTML entities
    md = md
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");

    // Collapse excessive blank lines
    md = md.replace(/\n{3,}/g, "\n\n").trim();

    return md;
}
