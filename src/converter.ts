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

/** Image file extensions treated as embeddable attachments. */
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i;

/**
 * Returns the unique list of image filenames embedded via ![[...]] syntax.
 * These need to be uploaded as Confluence attachments before or after the page push.
 */
export function extractEmbeddedImages(markdown: string): string[] {
    const seen = new Set<string>();
    const re = /!\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
        const name = m[1].trim();
        if (IMAGE_EXTENSIONS.test(name)) seen.add(name);
    }
    return [...seen];
}

// ---------------------------------------------------------------------------
// Table conversion helper
// ---------------------------------------------------------------------------

/**
 * Converts GitHub-Flavored Markdown tables (including blank-line-separated
 * row style used by Obsidian) into Confluence storage format <table> elements.
 *
 * Handles:
 *   - Header row  → <th> cells in a <thead><tr>
 *   - Separator row (|---|---|) → skipped
 *   - Data rows   → <td> cells in <tbody><tr>
 *   - Blank lines between rows (Obsidian sometimes emits these)
 */
/**
 * Splits input into alternating [outside-cdata, cdata, outside-cdata, ...] segments,
 * applies `fn` only to the outside segments, then reassembles.
 * This prevents any regex-based converter from touching content inside CDATA sections.
 */
function applyOutsideCdata(input: string, fn: (s: string) => string): string {
    const parts = input.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
    return parts.map((part, i) => (i % 2 === 0 ? fn(part) : part)).join("");
}

/**
 * Escape XML special characters in a string that may contain HTML tags.
 * Only text nodes (content between tags) are escaped; tag markup is left intact.
 */
function escapeXmlTextNodes(html: string): string {
    // Split on HTML tags, escape only the text segments (even-indexed parts)
    return html.split(/(<[^>]+>)/).map((part, i) =>
        i % 2 === 0 ? escapeXmlText(part) : part
    ).join("");
}

function convertTables(input: string): string {
    // Collect contiguous pipe-delimited lines (ignoring blank lines within the block)
    // A table block is a sequence of lines where EVERY non-blank line starts with |
    return input.replace(
        /((?:^[ \t]*\|.+\|[ \t]*\n?(?:^[ \t]*\n)?)+)/gm,
        (block) => {
            // Split into non-blank pipe lines
            const rows = block
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.startsWith("|"));

            if (rows.length === 0) return block;

            // Detect separator row: all cells match /^[-:]+$/
            const isSeparator = (row: string) =>
                row.replace(/\|/g, "").trim().replace(/[\s\-:]/g, "") === "";

            // Parse a row string into cell text array.
            // Strip backtick wrappers so `code` values render as plain text in cells.
            const parseCells = (row: string): string[] =>
                row
                    .replace(/^\|/, "")
                    .replace(/\|$/, "")
                    .split("|")
                    .map((c) => c.trim().replace(/`([^`]+)`/g, "$1"));

            // Find header/separator split point
            const sepIdx = rows.findIndex(isSeparator);
            const headerRows = sepIdx > 0 ? rows.slice(0, sepIdx) : [rows[0]];
            const dataRows = sepIdx >= 0 ? rows.slice(sepIdx + 1) : rows.slice(1);

            let out = `<table><colgroup>${headerRows[0].split("|").slice(1, -1).map(() => "<col/>").join("")}</colgroup>`;

            // thead
            out += "<thead>";
            for (const row of headerRows) {
                out += "<tr>" + parseCells(row).map((c) => `<th><p>${escapeXmlText(c)}</p></th>`).join("") + "</tr>";
            }
            out += "</thead>";

            // tbody
            if (dataRows.length > 0) {
                out += "<tbody>";
                for (const row of dataRows) {
                    out += "<tr>" + parseCells(row).map((c) => `<td><p>${escapeXmlText(c)}</p></td>`).join("") + "</tr>";
                }
                out += "</tbody>";
            }

            out += "</table>";
            return out;
        }
    );
}

// ---------------------------------------------------------------------------
// List conversion helper
// ---------------------------------------------------------------------------

interface ListItem {
    indent: number;
    ordered: boolean;
    text: string;
}

/**
 * Converts markdown list blocks (possibly nested) into Confluence storage
 * format <ul>/<ol> with proper nesting.
 */
function convertLists(input: string): string {
    // Match a contiguous block of list lines (unordered or ordered, any indent)
    return input.replace(
        /((?:^[ \t]*(?:[-*+]|\d+\.) .+\n?)+)/gm,
        (block) => {
            const rawLines = block.replace(/\n$/, "").split("\n");
            const items: ListItem[] = rawLines.map((line) => {
                const m = line.match(/^([ \t]*)([-*+]|\d+\.) (.*)$/);
                if (!m) return { indent: 0, ordered: false, text: line };
                const indentStr = m[1].replace(/\t/g, "    "); // normalise tabs
                return {
                    indent: indentStr.length,
                    ordered: /\d+\./.test(m[2]),
                    text: m[3],
                };
            });

            function buildList(startIdx: number, minIndent: number): [string, number] {
                const firstItem = items[startIdx];
                const tag = firstItem.ordered ? "ol" : "ul";
                let out = `<${tag}>`;
                let i = startIdx;

                while (i < items.length && items[i].indent >= minIndent) {
                    const item = items[i];
                    if (item.indent > minIndent) {
                        // Deeper indent — this becomes a nested list inside the
                        // previous <li>. Walk back one to attach to that li.
                        // (buildList will be called recursively from within the li)
                        i++;
                        continue;
                    }

                    // Peek ahead: if the next item is deeper, build a sublist
                    // Item text may already contain inline HTML (strong, code, em)
                    // from earlier passes — escape only text nodes, not the tags.
                    let liContent = escapeXmlTextNodes(item.text);
                    let j = i + 1;
                    if (j < items.length && items[j].indent > item.indent) {
                        const [subList, nextIdx] = buildList(j, items[j].indent);
                        liContent += subList;
                        out += `<li>${liContent}</li>`;
                        i = nextIdx;
                    } else {
                        out += `<li>${liContent}</li>`;
                        i++;
                    }
                }

                out += `</${tag}>`;
                return [out, i];
            }

            const [result] = buildList(0, items[0].indent);
            return result;
        }
    );
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
    // Embedded images: ![[image.png]] → Confluence attachment macro (placeholder resolved after upload)
    html = html.replace(/!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp|ico))\]\]/gi,
        (_, filename) => `<ac:image><ri:attachment ri:filename="${filename}"/></ac:image>`
    );
    // Other embedded files (non-image): remove entirely
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

    // Code blocks (fenced).
    // The language token after the opening ``` may be:
    //   - absent          → ```\n
    //   - a single word   → ```bash\n
    //   - a multi-word string like "aws s3api ..." (when the user types the
    //     command inline after the fence) → treat the whole first line as the
    //     language hint but only store the first word as the language param.
    html = html.replace(
        /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm,
        (_, langLine, code) => {
            // Use only the first whitespace-delimited token as the language identifier
            const lang = langLine.trim().split(/\s+/)[0] ?? "";
            return (
                `<ac:structured-macro ac:name="code">` +
                (lang ? `<ac:parameter ac:name="language">${escapeXmlText(lang)}</ac:parameter>` : "") +
                `<ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body>` +
                `</ac:structured-macro>`
            );
        }
    );

    // Tables — must run before inline code/bold/italic so that backtick-wrapped
    // or bold cell content isn't pre-converted into HTML tags before we parse
    // the pipe structure. applyOutsideCdata ensures we never touch pipe chars
    // that happen to be inside a fenced code block's CDATA section.
    html = applyOutsideCdata(html, convertTables);

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

    // Lists — nested unordered and ordered, respecting indentation depth.
    // applyOutsideCdata ensures list-like lines inside code blocks are not converted.
    html = applyOutsideCdata(html, convertLists);

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

    // Paragraphs: wrap lines that are not already known block tags.
    // Lines inside a CDATA section (code macro bodies) must be left untouched.
    const BLOCK_TAG = /^<(h[1-6]|p|ul|ol|li|blockquote|hr|ac:|pre|div|table|colgroup|col|thead|tbody|tr|td|th)([ \t>\/>]|$)/i;
    const HAS_HTML = /<[a-zA-Z/]/;
    const lines = html.split("\n");
    const output: string[] = [];
    let insideCdata = false;

    for (const line of lines) {
        // Track entry/exit of CDATA sections so we never wrap their content
        if (!insideCdata && line.includes("<![CDATA[")) insideCdata = true;

        if (insideCdata) {
            output.push(line);
            if (line.includes("]]>")) insideCdata = false;
            continue;
        }

        const trimmed = line.trim();
        if (BLOCK_TAG.test(trimmed)) {
            output.push(line);
        } else if (trimmed === "") {
            output.push("");
        } else if (HAS_HTML.test(trimmed)) {
            // Line has inline HTML tags (strong, em, a, code, etc.) mixed with text.
            // Escape only the text nodes, leaving the tags intact.
            output.push(`<p>${escapeXmlTextNodes(trimmed)}</p>`);
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

    // Code macro — Confluence may emit parameters in any order and with extra
    // attributes, so we extract the language param separately if present.
    md = md.replace(
        /<ac:structured-macro ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
        (_, inner) => {
            const langMatch = inner.match(/<ac:parameter ac:name="language">([^<]+)<\/ac:parameter>/);
            const lang = langMatch ? langMatch[1].trim() : "";
            const cdataMatch = inner.match(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/);
            const code = cdataMatch ? cdataMatch[1] : "";
            return "```" + lang + "\n" + code + "```";
        }
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
