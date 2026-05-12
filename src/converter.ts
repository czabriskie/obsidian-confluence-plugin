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

/** Marker that delimits the auto-generated comments section in local files. */
export const COMMENTS_SECTION_MARKER = "%% confluence-comments %%";

/** Auto-link bare URLs that aren't already inside an href or <a> tag. */
function autoLinkUrls(text: string): string {
    return text.replace(
        /(?<!href=")(?<!<a[^>]*>)(https?:\/\/[^\s<>"']+)/g,
        '<a href="$1">$1</a>'
    );
}

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
            // Escape the inner content so HTML-like values (e.g. `<script>`) don't
            // pass through as raw tags.
            const parseCells = (row: string): string[] =>
                row
                    .replace(/^\|/, "")
                    .replace(/\|$/, "")
                    .split("|")
                    .map((c) => c.trim().replace(/`([^`]+)`/g, (_, inner) => escapeXmlText(inner)));

            // Find header/separator split point
            const sepIdx = rows.findIndex(isSeparator);
            const headerRows = sepIdx > 0 ? rows.slice(0, sepIdx) : [rows[0]];
            const dataRows = sepIdx >= 0 ? rows.slice(sepIdx + 1) : rows.slice(1);

            let out = `<table><colgroup>${headerRows[0].split("|").slice(1, -1).map(() => "<col/>").join("")}</colgroup>`;

            // thead
            out += "<thead>";
            for (const row of headerRows) {
                out += "<tr>" + parseCells(row).map((c) => `<th><p>${escapeXmlTextNodes(autoLinkUrls(c))}</p></th>`).join("") + "</tr>";
            }
            out += "</thead>";

            // tbody
            if (dataRows.length > 0) {
                out += "<tbody>";
                for (const row of dataRows) {
                    out += "<tr>" + parseCells(row).map((c) => `<td><p>${escapeXmlTextNodes(autoLinkUrls(c))}</p></td>`).join("") + "</tr>";
                }
                out += "</tbody>";
            }

            out += "</table>";
            return out;
        }
    );
}

// ---------------------------------------------------------------------------
// Task list (checkbox) conversion helper
// ---------------------------------------------------------------------------

/**
 * Converts contiguous blocks of Obsidian checkbox lines (`- [ ]` / `- [x]`)
 * into Confluence task list macros.
 */
function convertTaskLists(input: string): string {
    let taskIdCounter = 1;
    return input.replace(
        /((?:^[ \t]*- \[[xX ]\] .+\n?)+)/gm,
        (block) => {
            const lines = block.replace(/\n$/, "").split("\n");
            const tasks = lines.map((line) => {
                const m = line.match(/^[ \t]*- \[([xX ])\] (.*)$/);
                if (!m) return "";
                const checked = m[1].toLowerCase() === "x";
                const status = checked ? "complete" : "incomplete";
                const text = escapeXmlTextNodes(m[2]);
                const id = taskIdCounter++;
                return `<ac:task><ac:task-id>${id}</ac:task-id><ac:task-status>${status}</ac:task-status><ac:task-body><span class="placeholder-inline-tasks">${text}</span></ac:task-body></ac:task>`;
            });
            return `<ac:task-list>${tasks.join("")}</ac:task-list>`;
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

export function markdownToConfluenceStorage(
    markdown: string,
    titleToUrl: Map<string, string> = new Map(),
    contextDir?: string
): string {
    let html = markdown;

    // Front-matter: strip YAML front-matter block (---...---) at the top
    html = html.replace(/^---[\s\S]*?---\n?/, "");

    // Comments section: strip the auto-generated Confluence comments block
    // so it is never pushed back as page body content.
    const commentsIdx = html.indexOf(COMMENTS_SECTION_MARKER);
    if (commentsIdx !== -1) {
        html = html.substring(0, commentsIdx).trimEnd() + "\n";
    }

    // ── Obsidian-specific syntax ──────────────────────────────────────────
    // Obsidian comment markers (%% ... %%) — strip the markers but keep content
    // between them (e.g. Waypoint plugin TOC). The markers are invisible in
    // Obsidian preview and have no meaning in Confluence.
    html = html.replace(/^%%[^\n]*%%\s*$/gm, "");

    // Callouts: > [!NOTE] Title → Confluence info/warning/note macro
    // Handle multi-line callouts by matching entire blocks
    html = html.replace(
        /^> \[!(\w+)\](?: ([^\n]*))?$\n?((?:^> [^\n]*$\n?)*)/gm,
        (match, type, title, bodyLines) => {
            // Map Obsidian callout types to Confluence macro names
            const typeMap: Record<string, string> = {
                "note": "note",
                "info": "info",
                "tip": "tip",
                "success": "tip",
                "warning": "warning",
                "caution": "warning",
                "danger": "warning",
                "error": "warning",
                "bug": "warning",
                "example": "info",
                "quote": "info",
                "abstract": "info",
                "summary": "info",
                "todo": "info",
                "question": "info",
                "faq": "info"
            };
            
            const macroName = typeMap[type.toLowerCase()] || "info";
            
            // Extract and clean body content
            let body = "";
            if (bodyLines) {
                body = bodyLines
                    .split("\n")
                    .map((line: string) => line.replace(/^> ?/, "").trim())
                    .filter((line: string) => line.length > 0)
                    .join(" ");
            }
            
            // Build the macro
            let macro = `<ac:structured-macro ac:name="${macroName}">`;
            
            if (title && title.trim()) {
                macro += `<ac:parameter ac:name="title">${escapeXmlText(title.trim())}</ac:parameter>`;
            }
            
            if (body) {
                // Process body content as markdown (inline elements only)
                body = body
                    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                    .replace(/\*(.+?)\*/g, "<em>$1</em>")
                    .replace(/`(.+?)`/g, "<code>$1</code>")
                    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
                macro += `<ac:rich-text-body><p>${escapeXmlTextNodes(body)}</p></ac:rich-text-body>`;
            }
            
            macro += `</ac:structured-macro>`;
            return macro;
        }
    );
    // Embedded images: ![[image.png]] → Confluence attachment macro (placeholder resolved after upload)
    html = html.replace(/!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp|ico))\]\]/gi,
        (_, filename) => `<ac:image><ri:attachment ri:filename="${filename}"/></ac:image>`
    );
    // Other embedded files (non-image): remove entirely
    html = html.replace(/!\[\[[^\]]*\]\]/g, "");

    // Wiki links — resolve to Confluence URL if the page is in the sync map,
    // otherwise fall back to plain text (alias or page name).
    // Context-aware: if contextDir is provided (the directory of the source file
    // relative to the sync root), try "contextDir/title" first. This lets
    // [[Learning]] inside Site Reliability Engineering/ resolve to
    // "site reliability engineering/learning" rather than the global "learning".
    const resolveWikiUrl = (lookup: string): string | undefined => {
        const key = lookup.trim().toLowerCase();
        if (contextDir) {
            const ctxKey = `${contextDir.toLowerCase()}/${key}`;
            const ctxUrl = titleToUrl.get(ctxKey);
            if (ctxUrl) return ctxUrl;
        }
        return titleToUrl.get(key);
    };

    // [[File.ext|Alias]] / [[File.ext]] — strip extension, then resolve
    html = html.replace(/\[\[([^\]|]+\.[a-zA-Z0-9]+)\s*\|([^\]]+)\]\]/g, (_, _file, alias) => {
        const title = _file.replace(/\.[^.]+$/, "");
        const url = resolveWikiUrl(title);
        return url ? `<a href="${url}">${escapeXmlText(alias)}</a>` : escapeXmlText(alias);
    });
    html = html.replace(/\[\[([^\]|]+\.[a-zA-Z0-9]+)\]\]/g, (_, f) => {
        const title = f.replace(/\.[^.]+$/, "");
        const url = resolveWikiUrl(title);
        return url ? `<a href="${url}">${escapeXmlText(title)}</a>` : escapeXmlText(title);
    });
    // [[Page|Alias]] / [[Page]] — resolve by page name
    html = html.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, page, alias) => {
        // Support path-prefixed links like [[Folder/Page|Alias]] — try full path first, then last segment
        const segments = page.split("/");
        const lastName = segments[segments.length - 1];
        const url = resolveWikiUrl(page)
            ?? resolveWikiUrl(lastName);
        return url ? `<a href="${url}">${escapeXmlText(alias)}</a>` : escapeXmlText(alias);
    });
    html = html.replace(/\[\[([^\]]+)\]\]/g, (_, page) => {
        const segments = page.split("/");
        const lastName = segments[segments.length - 1];
        const url = resolveWikiUrl(page)
            ?? resolveWikiUrl(lastName);
        // Use only the last path segment as the display text (matches Obsidian behaviour)
        const display = lastName;
        return url ? `<a href="${url}">${escapeXmlText(display)}</a>` : escapeXmlText(display);
    });
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
    // The opening ``` may appear mid-line (e.g. in a list item like
    // "- CSP errors ```\n...```"), so we allow optional leading text before
    // the opening fence. The leading text is preserved before the macro.
    html = html.replace(
        /^([ \t]*(?:[^\n`]*)?)```([^\n]*)\n([\s\S]*?)^[ \t]*```[ \t]*$/gm,
        (_, prefix, langLine, code) => {
            // Use only the first whitespace-delimited token as the language identifier
            const lang = langLine.trim().split(/\s+/)[0] ?? "";
            return (
                (prefix.trim() ? escapeXmlText(prefix.trim()) + "\n" : "") +
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

    // Inline code — escape XML chars so that angle brackets in code spans
    // (e.g. `<iframe>`, `Array<T>`) don't produce invalid XHTML.
    html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeXmlText(code)}</code>`);

    // Bold / Italic / Strikethrough — wrapped in applyOutsideCdata so that
    // content inside code block CDATA sections is never modified.
    html = applyOutsideCdata(html, (segment) => {
        // Bold
        segment = segment.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
        segment = segment.replace(/__(.+?)__/g, "<strong>$1</strong>");
        // Italic
        // Note: _word_ italics require a non-word-char boundary so that underscores
        // inside identifiers (merge_requests, snake_case) are not treated as italic markers.
        segment = segment.replace(/\*(.+?)\*/g, "<em>$1</em>");
        segment = segment.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>");
        // Strikethrough
        segment = segment.replace(/~~(.+?)~~/g, "<del>$1</del>");
        return segment;
    });

    // Horizontal rule
    html = html.replace(/^(?:---|\*\*\*|___)\s*$/gm, "<hr/>");

    // Blockquote — handle optional space after >, multi-line blocks, and inline HTML
    // from prior passes (bold/code/italic). Consecutive > lines are merged into one
    // <blockquote> so a paragraph-length quote doesn't produce multiple nested blocks.
    html = html.replace(
        /((?:^> ?.*\n?)+)/gm,
        (block) => {
            const inner = block
                .split("\n")
                .filter((l) => l.trim() !== "")
                .map((l) => l.replace(/^> ?/, "").trim())
                .join(" ");
            return `<blockquote><p>${escapeXmlTextNodes(inner)}</p></blockquote>`;
        }
    );

    // Task lists (checkboxes) — convert before general list conversion so
    // `- [ ]` / `- [x]` lines don't get consumed as plain <ul> items.
    // Confluence uses <ac:task-list> / <ac:task> / <ac:task-status> macros.
    html = applyOutsideCdata(html, convertTaskLists);

    // Lists — nested unordered and ordered, respecting indentation depth.
    // applyOutsideCdata ensures list-like lines inside code blocks are not converted.
    html = applyOutsideCdata(html, convertLists);

    // Images  ![alt](url)
    html = html.replace(
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        '<ac:image><ri:url ri:value="$2"/></ac:image>'
    );

    // Links  [text](url) or [text](url "title") — strip optional title
    html = html.replace(
        /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
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
            // Plain text — escape XML special chars, then auto-link bare URLs
            output.push(`<p>${autoLinkUrls(escapeXmlText(trimmed))}</p>`);
        }
    }

    return output.join("\n");
}

// ---------------------------------------------------------------------------
// Confluence Storage Format → Markdown
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HTML → Markdown helpers
// ---------------------------------------------------------------------------

/**
 * Decode common HTML named entities and numeric character references to their
 * Unicode equivalents.
 */
function decodeHtmlEntities(text: string): string {
    const NAMED: Record<string, string> = {
        "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
        "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
        "&mdash;": "—", "&ndash;": "–",
        "&rarr;": "→", "&larr;": "←", "&darr;": "↓", "&uarr;": "↑", "&harr;": "↔",
        "&laquo;": "«", "&raquo;": "»", "&lsaquo;": "‹", "&rsaquo;": "›",
        "&ldquo;": "\u201C", "&rdquo;": "\u201D", "&lsquo;": "\u2018", "&rsquo;": "\u2019",
        "&bull;": "•", "&hellip;": "…", "&sect;": "§",
        "&copy;": "©", "&reg;": "®", "&trade;": "™",
        "&deg;": "°", "&plusmn;": "±", "&times;": "×", "&divide;": "÷",
        "&frac12;": "½", "&frac14;": "¼", "&frac34;": "¾",
    };
    for (const [entity, char] of Object.entries(NAMED)) {
        text = text.replaceAll(entity, char);
    }
    // Numeric character references
    text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
    text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
    return text;
}

/**
 * Find the index *after* the closing tag that matches the open tag at position
 * `searchFrom` (which points just after the opening tag).  Handles nesting.
 * Returns -1 if no match is found.
 */
function findClosingTag(html: string, tag: string, searchFrom: number): number {
    let depth = 1;
    const re = new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, "gi");
    re.lastIndex = searchFrom;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        if (m[1] === "/") {
            depth--;
            if (depth === 0) return m.index + m[0].length;
        } else {
            depth++;
        }
    }
    return -1;
}

/**
 * Convert inline HTML (bold, italic, code, links) to markdown equivalents and
 * strip any remaining HTML tags.
 */
function inlineHtmlToMd(text: string): string {
    text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
    text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
    text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
    text = text.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
    text = text.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");
    text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
    text = text.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
    text = text.replace(/<br\s*\/?>/gi, " ");
    text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1");
    text = text.replace(/<[^>]+>/g, "");
    return text.replace(/\n+/g, " ").trim();
}

/**
 * Convert a Confluence `<table>` element's inner HTML to a GFM markdown table.
 */
function confluenceTableToMarkdown(tableHtml: string): string {
    function extractRows(html: string): string[][] {
        const rows: string[][] = [];
        const trRe = /<tr[^>]*>/gi;
        let trMatch: RegExpExecArray | null;
        while ((trMatch = trRe.exec(html)) !== null) {
            const trStart = trMatch.index + trMatch[0].length;
            const trEnd = findClosingTag(html, "tr", trStart);
            if (trEnd === -1) continue;
            const trInner = html.substring(trStart, trEnd - "</tr>".length);

            const cells: string[] = [];
            const cellRe = /<(th|td)[^>]*>/gi;
            let cellMatch: RegExpExecArray | null;
            while ((cellMatch = cellRe.exec(trInner)) !== null) {
                const tag = cellMatch[1];
                const cStart = cellMatch.index + cellMatch[0].length;
                const cEnd = findClosingTag(trInner, tag, cStart);
                if (cEnd === -1) continue;
                const raw = trInner.substring(cStart, cEnd - `</${tag}>`.length);
                cells.push(decodeHtmlEntities(inlineHtmlToMd(raw)));
                cellRe.lastIndex = cEnd;
            }
            if (cells.length > 0) rows.push(cells);
            trRe.lastIndex = trEnd;
        }
        return rows;
    }

    // Collect rows from <thead> then <tbody>, falling back to bare <tr>s
    let rows: string[][] = [];
    const theadMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    if (theadMatch) rows.push(...extractRows(theadMatch[1]));
    const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (tbodyMatch) rows.push(...extractRows(tbodyMatch[1]));
    if (rows.length === 0) rows = extractRows(tableHtml);
    if (rows.length === 0) return "";

    // Pad all rows to the same number of columns
    const maxCols = Math.max(...rows.map((r) => r.length));
    rows.forEach((r) => { while (r.length < maxCols) r.push(""); });

    let out = "\n\n";
    out += "| " + rows[0].join(" | ") + " |\n";
    out += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
    for (let i = 1; i < rows.length; i++) {
        out += "| " + rows[i].join(" | ") + " |\n";
    }
    return out + "\n";
}

/**
 * Convert a Confluence `<ul>` or `<ol>` element (including nested lists)
 * into indented markdown list lines.
 */
function confluenceListToMarkdown(listHtml: string, indent: number = 0): string {
    const isOrdered = /^<ol/i.test(listHtml.trim());
    const tag = isOrdered ? "ol" : "ul";

    // Strip outer tag to get inner content
    const openMatch = listHtml.match(new RegExp(`^<${tag}[^>]*>`, "i"));
    if (!openMatch) return listHtml;
    const innerStart = openMatch[0].length;
    const closeIdx = findClosingTag(listHtml, tag, innerStart);
    if (closeIdx === -1) return listHtml;
    const inner = listHtml.substring(innerStart, closeIdx - `</${tag}>`.length);

    // Find each top-level <li> in inner
    const liRe = /<li[^>]*>/gi;
    const items: string[] = [];
    let liMatch: RegExpExecArray | null;
    while ((liMatch = liRe.exec(inner)) !== null) {
        const contentStart = liMatch.index + liMatch[0].length;
        const endIdx = findClosingTag(inner, "li", contentStart);
        if (endIdx === -1) break;
        items.push(inner.substring(contentStart, endIdx - "</li>".length));
        liRe.lastIndex = endIdx;
    }

    const prefix = "  ".repeat(indent);
    const lines: string[] = [];
    items.forEach((item, idx) => {
        let text = item;
        let nestedMd = "";

        // Find and extract nested <ul>/<ol> lists
        const nestedRe = /<(ul|ol)[^>]*>/gi;
        const nesteds: Array<{ start: number; end: number; html: string }> = [];
        let nm: RegExpExecArray | null;
        while ((nm = nestedRe.exec(text)) !== null) {
            const nTag = nm[1];
            const nStart = nm.index;
            const nEnd = findClosingTag(text, nTag, nm.index + nm[0].length);
            if (nEnd === -1) continue;
            nesteds.push({ start: nStart, end: nEnd, html: text.substring(nStart, nEnd) });
            nestedRe.lastIndex = nEnd;
        }

        // Remove nested list HTML from item text (process from end to preserve indices)
        for (let i = nesteds.length - 1; i >= 0; i--) {
            nestedMd = confluenceListToMarkdown(nesteds[i].html, indent + 1) +
                (nestedMd ? "\n" + nestedMd : "");
            text = text.substring(0, nesteds[i].start) + text.substring(nesteds[i].end);
        }

        const cleanText = decodeHtmlEntities(inlineHtmlToMd(text));
        const marker = isOrdered ? `${idx + 1}.` : "-";
        lines.push(`${prefix}${marker} ${cleanText}`);
        if (nestedMd) lines.push(nestedMd);
    });

    return lines.join("\n");
}

/**
 * Find and replace all top-level occurrences of a given tag using proper
 * nesting-aware matching, applying `convert` to each match.
 */
function replaceTopLevelTag(
    html: string,
    tag: string,
    convert: (matched: string) => string
): string {
    const re = new RegExp(`<${tag}[^>]*>`, "gi");
    let result = "";
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        const startIdx = m.index;
        const closeIdx = findClosingTag(html, tag, m.index + m[0].length);
        if (closeIdx === -1) continue;
        result += html.substring(lastEnd, startIdx);
        result += convert(html.substring(startIdx, closeIdx));
        lastEnd = closeIdx;
        re.lastIndex = closeIdx;
    }
    result += html.substring(lastEnd);
    return result;
}

// ---------------------------------------------------------------------------
// Confluence Storage Format → Markdown  (public)
// ---------------------------------------------------------------------------

export function confluenceStorageToMarkdown(storage: string): string {
    let md = storage;

    // ── Structured macros (must be processed before generic tag stripping) ──

    // Task lists → Obsidian checkboxes
    md = md.replace(
        /<ac:task-list>([\s\S]*?)<\/ac:task-list>/gi,
        (_, inner) => {
            return inner.replace(
                /<ac:task>\s*(?:<ac:task-id>\d+<\/ac:task-id>\s*)?<ac:task-status>([^<]+)<\/ac:task-status>\s*<ac:task-body>\s*(?:<span[^>]*>)?([\s\S]*?)(?:<\/span>)?\s*<\/ac:task-body>\s*<\/ac:task>/gi,
                (_: string, status: string, body: string) => {
                    const checked = status.trim().toLowerCase() === "complete";
                    return `- [${checked ? "x" : " "}] ${body.trim()}\n`;
                }
            );
        }
    );

    // Code macro → fenced code block (extract before other transforms)
    md = md.replace(
        /<ac:structured-macro ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
        (_, inner) => {
            const langMatch = inner.match(/<ac:parameter ac:name="language">([^<]+)<\/ac:parameter>/);
            const lang = langMatch ? langMatch[1].trim() : "";
            const cdataMatch = inner.match(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/);
            const code = cdataMatch ? cdataMatch[1] : "";
            return "\n\n```" + lang + "\n" + code + "```\n\n";
        }
    );

    // Info / note / warning / tip macros → Obsidian callouts
    md = md.replace(
        /<ac:structured-macro ac:name="(info|note|warning|tip)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
        (_, type, inner) => {
            const typeMap: Record<string, string> = {
                info: "INFO", note: "NOTE", warning: "WARNING", tip: "TIP",
            };
            const calloutType = typeMap[type] || type.toUpperCase();
            const titleMatch = inner.match(/<ac:parameter ac:name="title">([^<]+)<\/ac:parameter>/);
            const title = titleMatch ? " " + titleMatch[1].trim() : "";
            const bodyMatch = inner.match(/<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/);
            let body = bodyMatch ? inlineHtmlToMd(bodyMatch[1]).trim() : "";
            let result = `> [!${calloutType}]${title}`;
            if (body) {
                result += "\n" + body.split("\n").map((l: string) => `> ${l}`).join("\n");
            }
            return "\n\n" + result + "\n\n";
        }
    );

    // Strip any remaining structured macros
    md = md.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/g, "");

    // ── Images ────────────────────────────────────────────────────────────

    // Attachment images → ![[filename]]
    md = md.replace(
        /<ac:image[^>]*>\s*<ri:attachment ri:filename="([^"]+)"[^/]*\/>\s*<\/ac:image>/gi,
        "![[$1]]"
    );

    // URL images → ![](url)
    md = md.replace(/<ac:image[^>]*>\s*<ri:url ri:value="([^"]+)"[^/]*\/>\s*<\/ac:image>/gi, "![]($1)");

    // ── Tables (nesting-aware) ────────────────────────────────────────────

    md = replaceTopLevelTag(md, "table", confluenceTableToMarkdown);

    // ── Headings (add surrounding newlines for separation) ────────────────

    md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n");
    md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n");
    md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n");
    md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n\n#### $1\n\n");
    md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n\n##### $1\n\n");
    md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n\n###### $1\n\n");

    // ── Inline formatting ─────────────────────────────────────────────────

    md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
    md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
    md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
    md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
    md = md.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");
    md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

    // ── Block elements ────────────────────────────────────────────────────

    // Blockquote
    md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
        const text = inner.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1").trim();
        return "\n\n" + text.split("\n").map((l: string) => `> ${l}`).join("\n") + "\n\n";
    });

    // Lists (nesting-aware)
    md = replaceTopLevelTag(md, "ul", (html) => "\n\n" + confluenceListToMarkdown(html) + "\n\n");
    md = replaceTopLevelTag(md, "ol", (html) => "\n\n" + confluenceListToMarkdown(html) + "\n\n");

    // Links
    md = md.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

    // Horizontal rule
    md = md.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

    // Line breaks
    md = md.replace(/<br\s*\/?>/gi, "\n");

    // Paragraphs → content + double newline
    md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");

    // Strip any remaining HTML tags (colgroup, col, div, span, etc.)
    md = md.replace(/<[^>]+>/g, "");

    // ── Entity decoding ───────────────────────────────────────────────────

    md = decodeHtmlEntities(md);

    // ── Whitespace cleanup ────────────────────────────────────────────────

    md = md.replace(/\n{3,}/g, "\n\n").trim();

    return md;
}

// ---------------------------------------------------------------------------
// Inline comment marker preservation
// ---------------------------------------------------------------------------

/**
 * Extract inline comment markers from a Confluence storage-format body.
 * Returns an array of { ref, text } objects where `ref` is the UUID and
 * `text` is the plain text content inside the marker (HTML tags stripped).
 */
function extractInlineCommentMarkers(
    storageBody: string
): Array<{ ref: string; markedHtml: string; plainText: string }> {
    const markers: Array<{ ref: string; markedHtml: string; plainText: string }> = [];
    const re = /<ac:inline-comment-marker\s+ac:ref="([^"]+)">([\s\S]*?)<\/ac:inline-comment-marker>/g;
    let m;
    while ((m = re.exec(storageBody)) !== null) {
        const ref = m[1];
        const markedHtml = m[2];
        // Strip HTML tags to get plain text for matching
        const plainText = markedHtml.replace(/<[^>]+>/g, "").trim();
        if (plainText) {
            markers.push({ ref, markedHtml, plainText });
        }
    }
    return markers;
}

/**
 * Strip all inline comment marker tags from a Confluence storage body,
 * keeping only the inner content. Used for clean comparison.
 */
export function stripInlineCommentMarkers(storageBody: string): string {
    return storageBody.replace(
        /<ac:inline-comment-marker\s+ac:ref="[^"]*">([\s\S]*?)<\/ac:inline-comment-marker>/g,
        "$1"
    );
}

/**
 * Re-apply inline comment markers from an old Confluence storage body into
 * a new one. For each marker found in `oldBody`, searches for the same
 * plain text in `newBody` and wraps the first match with the marker tag.
 *
 * This preserves inline comments when pushing updated content, as long as
 * the commented text still exists (possibly wrapped in different HTML tags).
 */
export function preserveInlineCommentMarkers(
    oldBody: string,
    newBody: string
): string {
    const markers = extractInlineCommentMarkers(oldBody);
    if (markers.length === 0) return newBody;

    let result = newBody;
    for (const { ref, plainText } of markers) {
        // Skip if this marker ref is already in the new body
        if (result.includes(`ac:ref="${ref}"`)) continue;

        // Escape regex special chars in the plain text
        const escaped = plainText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        // Try to find the plain text inside an HTML tag's content in the new body.
        // We look for the text that might be inside tags like <p>, <strong>, <td>, etc.
        // Strategy: find the text as a substring and wrap the innermost occurrence.
        const textIdx = result.indexOf(plainText);
        if (textIdx !== -1) {
            // Wrap just the plain text with the marker
            result =
                result.substring(0, textIdx) +
                `<ac:inline-comment-marker ac:ref="${ref}">${plainText}</ac:inline-comment-marker>` +
                result.substring(textIdx + plainText.length);
            continue;
        }

        // Fallback: try matching with whitespace flexibility
        const flexPattern = new RegExp(
            escaped.replace(/\s+/g, "\\s+")
        );
        const flexMatch = flexPattern.exec(result);
        if (flexMatch) {
            const idx = flexMatch.index;
            const matchedText = flexMatch[0];
            result =
                result.substring(0, idx) +
                `<ac:inline-comment-marker ac:ref="${ref}">${matchedText}</ac:inline-comment-marker>` +
                result.substring(idx + matchedText.length);
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Comment formatting
// ---------------------------------------------------------------------------

/**
 * Extract a map of inline comment marker ref UUIDs → highlighted plain text
 * from a Confluence storage-format body.
 */
export function extractInlineMarkerTexts(
    storageBody: string
): Map<string, string> {
    const map = new Map<string, string>();
    const re = /<ac:inline-comment-marker\s+ac:ref="([^"]+)">([\s\S]*?)<\/ac:inline-comment-marker>/g;
    let m;
    while ((m = re.exec(storageBody)) !== null) {
        const plainText = m[2].replace(/<[^>]+>/g, "").trim();
        if (plainText) {
            map.set(m[1], plainText);
        }
    }
    return map;
}

/**
 * Find the 1-based line and column of `needle` in `text`.
 * Returns `{ line, col }` or null if not found.
 */
function findTextPosition(
    text: string,
    needle: string
): { line: number; col: number } | null {
    const idx = text.indexOf(needle);
    if (idx === -1) return null;
    const before = text.substring(0, idx);
    const line = before.split("\n").length;
    const lastNewline = before.lastIndexOf("\n");
    const col = idx - lastNewline; // 1-based (distance from last newline)
    return { line, col };
}

/**
 * Format Confluence page comments as a markdown section to append to a
 * pulled file.  The section is wrapped in Obsidian comment markers (%%)
 * so the push converter can strip it before uploading.
 *
 * Each comment is rendered as a blockquote with the author and date.
 * Inline comments include the highlighted text and its position (line:col)
 * in the local markdown for easy correlation.
 */
export function formatCommentsAsMarkdown(
    comments: Array<{ author: string; body: string; createdAt: string; markerRef?: string }>,
    storageBody?: string,
    localMarkdown?: string,
): string {
    if (comments.length === 0) return "";

    // Build marker ref → highlighted text map if we have the storage body
    const markerTexts = storageBody
        ? extractInlineMarkerTexts(storageBody)
        : new Map<string, string>();

    const lines: string[] = [
        "",
        COMMENTS_SECTION_MARKER,
        "## Comments",
        "",
    ];

    for (const c of comments) {
        const date = c.createdAt
            ? new Date(c.createdAt).toLocaleString("en-US", {
                  year: "numeric", month: "short", day: "numeric",
                  hour: "2-digit", minute: "2-digit",
              })
            : "";
        const bodyMd = confluenceStorageToMarkdown(c.body).trim();

        // Build location info for inline comments
        let locationInfo = "";
        if (c.markerRef) {
            const highlightedText = markerTexts.get(c.markerRef);
            if (highlightedText && localMarkdown) {
                const pos = findTextPosition(localMarkdown, highlightedText);
                if (pos) {
                    locationInfo = ` \u{1F4CC} L${pos.line}:${pos.col} \u201C${highlightedText}\u201D`;
                } else {
                    locationInfo = ` \u{1F4CC} \u201C${highlightedText}\u201D`;
                }
            } else if (highlightedText) {
                locationInfo = ` \u{1F4CC} \u201C${highlightedText}\u201D`;
            }
        }

        lines.push(`> **${c.author}** \u2014 ${date}${locationInfo}`);
        for (const bodyLine of bodyMd.split("\n")) {
            lines.push(`> ${bodyLine}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}
