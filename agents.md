# Confluence Sync Plugin — Agent Context

> This file provides deep context for AI agents (Copilot, etc.) working on this codebase.
> Keep it updated when significant architectural changes are made.

---

## Project Summary

An Obsidian plugin that syncs between a vault directory and a Confluence Cloud space. Written in TypeScript, compiled with esbuild, uses the Confluence REST API v1.

**Sync model — local vault is the master:**
- **File structure (creates, deletes, moves)** — local → Confluence only. New pages created in Confluence are never auto-imported as local files.
- **Content updates** — bidirectional. If a tracked page changes in Confluence, the local file is updated on the next sync.

- **Repo**: `czabriskie/obsidian-confluence-plugin` (GitHub, branch: `main`)
- **Obsidian plugin ID**: `obsidian-confluence-plugin`
- **Manifest**: `manifest.json` at repo root
- **Compiled output**: `main.js` at repo root (checked in for Obsidian to load)

---

## Build & Deploy

```bash
npm run build     # tsc type-check + esbuild bundle → main.js
npm test          # vitest run (66 tests across tests/)
```

**Deploy to vault:**
```bash
cp -p main.js manifest.json ~/Vaults/ZONTAL/.obsidian/plugins/obsidian-confluence-plugin/
```

Then **Cmd+R** in Obsidian to reload, or use the "Reload app without saving" command.

---

## Source Files (`src/`)

### `main.ts` — Plugin entry point
- Extends Obsidian `Plugin`
- Registers all commands and the ribbon button
- Manages auto-sync timer (`setInterval`)
- Builds `ConfluenceClient` from settings; rebuilds on settings save
- Key methods:
  - `runSync(direction?)` — full sync via `SyncEngine.sync()`
  - `pushCurrentFile(file, force?)` — single-file push via `SyncEngine.pushFileDirect()`
  - `toggleExclusion(path)` — adds/removes a path from `settings.excludedPaths`

**Commands registered:**
| Command ID | Name |
|---|---|
| `confluence-sync-all` | Sync all (push & pull) |
| `confluence-push` | Push to Confluence |
| `confluence-pull` | Pull from Confluence |
| `confluence-push-current` | Push current file to Confluence |
| `confluence-force-push-current` | Force push current file (ignores cached hash) |
| `confluence-reset-sync-state` | Reset sync state (re-sync everything) |
| `confluence-delete-unmanaged-files` | Delete unmanaged local files |

**Context menu**: Files/folders inside the sync directory get an "Exclude from Confluence sync" / "Resume Confluence sync" item.

---

### `confluenceClient.ts` — Confluence REST API v1 client

All network calls go through this class. Most use Obsidian's `requestUrl()` (bypasses CORS). Attachment uploads use **Node's `https` module directly** (see note below).

**Constructor:** `new ConfluenceClient({ baseUrl, email, apiToken, spaceKey })`
- `baseUrl`: e.g. `https://yoursite.atlassian.net/wiki`
- Auth: `Basic base64(email:apiToken)`

**Key methods:**

| Method | Description |
|---|---|
| `getPage(pageId)` | Fetch a page by ID, returns `ConfluencePage` |
| `getPageByTitle(title, parentId?)` | Search by title within the space |
| `getChildPages(parentId)` | List immediate children |
| `getAllDescendants(parentId)` | Recursively fetch all descendants |
| `createPage(title, body, parentId?)` | Create a new page in storage format |
| `updatePage(pageId, title, body, version, parentId?)` | Update page content + reparent |
| `movePage(pageId, newParentId)` | Change a page's parent |
| `deletePage(pageId)` | Delete a page |
| `getSpace()` | Validate connectivity, returns `ConfluenceSpace` |
| `uploadAttachment(pageId, filename, data: ArrayBuffer, mimeType)` | Upload/replace a file attachment |

**⚠️ Critical: `uploadAttachment` uses `require("https")`**

`requestUrl` and `fetch` both fail for multipart uploads:
- `fetch` → blocked by CORS from `app://obsidian.md` origin
- `requestUrl` → Chromium's network stack manipulates the `Content-Type` boundary, causing Atlassian's XSRF check to fail with 403

**Solution**: Use Node's built-in `https` module via `require("https")`. This is available in Electron (which Obsidian runs on) and sends headers exactly as specified — no header manipulation, no CORS restrictions. The multipart body is built manually as a `Uint8Array`.

The required header to bypass Atlassian's XSRF on attachments is `X-Atlassian-Token: no-check`.

---

### `converter.ts` — Markdown ↔ Confluence Storage Format

**`markdownToConfluenceStorage(markdown, titleToUrl?, contextDir?): string`**

Key transformations (in order):
1. Strip YAML front-matter (`---...---`)
2. Strip `%% ... %%` Obsidian comment markers (Waypoint plugin uses these)
3. Obsidian callouts (`> [!NOTE]`) → bold label in blockquote
4. `![[image.png]]` → `<ac:image><ri:attachment ri:filename="..."/></ac:image>`
5. Other `![[...]]` embeds → deleted
6. Wiki links (`[[Page|Alias]]`, `[[File.ext]]`) — resolved to `<a href="...">` via `titleToUrl` map
   - `contextDir` (the file's immediate parent folder, lowercased) is tried first as `"contextDir/title"` to prefer sibling-directory matches over global ones
   - Falls back to plain text if not in map
6. Headings
7. Code fences → `<ac:structured-macro ac:name="code">` with CDATA
   - Regex: `/^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm` (captures full first line, uses first token as language)
8. **Tables** (`convertTables`) — runs here, before inline passes, so pipe chars and backtick/bold cell content aren't pre-converted
   - Header row → `<thead><tr><th>` cells; separator row (`|---|`) skipped; data rows → `<tbody><tr><td>`
   - Backtick-wrapped cell values have backticks stripped (rendered as plain text)
   - Wrapped in `applyOutsideCdata()` so pipe chars inside code blocks are safe
9. Inline code → `<code>`
10. Bold, italic, strikethrough
    - `**text**` / `__text__` → `<strong>`
    - `*text*` → `<em>`
    - `_text_` → `<em>` — uses `(?<!\w)_(.+?)_(?!\w)` to avoid matching underscores inside identifiers/URLs (e.g. `merge_requests`)
11. Horizontal rules → `<hr/>`
12. Blockquotes → `<blockquote><p>...</p></blockquote>`
    - Handles `>text` (no space) and `> text` (with space)
    - Consecutive `>` lines merged into one block
    - Content passed through `escapeXmlTextNodes()` to preserve inline HTML from prior passes
13. **Lists** (`convertLists`) — nested `<ul>`/`<ol>` built recursively from indentation depth
    - Wrapped in `applyOutsideCdata()` so `- item` lines inside code blocks are not converted
    - Item text uses `escapeXmlTextNodes()` (not `escapeXmlText`) so inline HTML tags already present from bold/code passes are preserved
14. Links → `<a href="...">` — regex `([^)\s]+)(?:\s+"[^"]*")?` strips optional title attribute (`[text](url "title")` → `<a href="url">text</a>`)
15. Paragraphs — wraps remaining lines in `<p>`:
    - Skips lines inside `<![CDATA[...]]>` blocks
    - Lines with inline HTML use `escapeXmlTextNodes()` to escape only text nodes, preserving `<strong>`, `<code>`, `<a>` etc.
    - Plain-text lines use `escapeXmlText()`

**Helper functions:**
- `applyOutsideCdata(input, fn)` — splits on CDATA boundaries, applies `fn` only to non-CDATA segments, reassembles. Used by `convertTables` and `convertLists` to prevent processing content inside code blocks.
- `escapeXmlText(text)` — escapes `&`, `<`, `>` in plain text strings.
- `escapeXmlTextNodes(html)` — splits on `(<[^>]+>)` boundaries, escapes only the text segments. Use this when the string may already contain HTML tags from prior passes.
- `convertTables(input)` — GFM table → Confluence `<table>` with `<thead>`/`<tbody>`.
- `convertLists(input)` — recursive nested list builder from indented markdown.

**`confluenceStorageToMarkdown(html): string`**

Reverse transformation for pull. Notable:
- Code macro → fenced code block (extracts language and CDATA content independently)
- `<ac:image>` → `![[filename]]`
- Strips remaining HTML tags

**`extractEmbeddedImages(markdown): string[]`**

Returns unique image filenames from `![[...]]` syntax. Used by `SyncEngine.uploadPageImages()` to know which files to upload as attachments.

---

### `syncEngine.ts` — Core sync orchestration (~1100 lines)

**`SyncEngine` class constructor:** `new SyncEngine(vault, client, state, settings)`

**`sync(): Promise<SyncResult>`** — sync (local is structure master)
- Reads all `.md` files under `settings.vaultDirectory`
- Skips excluded paths (`settings.excludedPaths`)
- **Pre-pass**: renames any Confluence pages whose stored title no longer matches `titleFromFile()` (via `preRenameStalePages`)
- **Push order**: non-Waypoint files first, then Waypoint files last — ensures all linked pages have Confluence records before Waypoints resolve wiki links
- Push logic: compare `SyncStateManager.hash(storageBody)` vs stored `contentHash`; also triggers on title rename (`needsTitleRename`)
- Pull logic: only updates **already-tracked** local files — never creates new local files from Confluence pages
- Conflict resolution via `settings.conflictStrategy` (`"local"` / `"remote"` / `"newer"`)
- Handles folder hierarchy: creates Confluence "folder pages" for vault subdirectories, caches in `SyncStateManager.setFolder()`

**`pushFileDirect(file, force?): Promise<SyncResult>`** — single-file push
- `force=false`: normal hash-based skip
- `force=true`: bypasses all hash/state checks, calls `updatePage` directly
  - If page returns 404 (deleted in Confluence), clears the state record and falls through to create path
- Calls `uploadPageImages()` after every successful create/update

**`uploadPageImages(pageId, markdown, sourceFile): Promise<void>`**
- Calls `extractEmbeddedImages(markdown)` to get image filenames
- Finds each image in the vault by `file.name` or `file.path`
- Reads binary with `vault.readBinary()`
- Calls `client.uploadAttachment()`

**`deleteUnmanagedLocalFiles(): Promise<string[]>`**
- Finds local `.md` files under the sync root that have no `SyncRecord`
- Deletes them from the vault

**Stale folder recovery (`StaleFolderError`)**
- When a folder page's parent ID no longer exists in Confluence, a `StaleFolderError` is thrown
- `evictStaleFolderEntries(staleParentId)` removes affected entries from `folderMap`
- The folder is then recreated fresh on the next push

---

### `syncStateManager.ts` — Persistence layer

Stored in `data.json` under two keys:
- `syncMap`: `Record<vaultPath, SyncRecord>` — file ↔ page ID mapping
- `folderMap`: `Record<vaultDirPath, confluencePageId>` — directory ↔ folder page ID

**`SyncRecord` fields:**
```typescript
{
    confluencePageId: string;
    confluenceTitle: string;
    confluenceVersion: number;
    confluenceParentId?: string;
    lastSyncedAt: string;       // ISO timestamp
    contentHash: string;        // djb2 hex hash of markdown content
}
```

**`SyncStateManager.hash(content)`** — djb2 hash, good enough for change detection.

---

### `settings.ts` — Settings interface & UI

**`ConfluenceSyncSettings`:**
| Field | Type | Default | Notes |
|---|---|---|---|
| `confluenceBaseUrl` | string | `""` | e.g. `https://org.atlassian.net/wiki` |
| `confluenceEmail` | string | `""` | Atlassian account email |
| `confluenceApiToken` | string | `""` | Atlassian API token (not password) |
| `confluenceSpaceKey` | string | `""` | e.g. `ENG` |
| `confluenceParentPageId` | string | `""` | Root parent page for all synced content |
| `vaultDirectory` | string | `"Confluence"` | Vault-relative path to sync |
| `conflictStrategy` | `"local"\|"remote"\|"newer"` | `"newer"` | Conflict resolution |
| `syncDirection` | `"both"\|"push"\|"pull"` | `"both"` | Default sync direction |
| `autoSyncIntervalMinutes` | number | `0` | 0 = disabled |
| `excludedPaths` | string[] | `[]` | Vault-relative paths excluded from sync |

Settings tab includes a **Test Connection** button that calls `client.getSpace()`.

---

## Tests (`tests/`)

| File | Count | What's covered |
|---|---|---|
| `converter.test.ts` | ~30 | Push/pull conversion, code blocks, images, round-trips |
| `syncStateManager.test.ts` | ~14 | CRUD, persistence, hash |

Run with `npm test` (vitest).

---

## Known Gotchas & Design Decisions

1. **Attachment uploads must use `require("https")`** — not `requestUrl`, not `fetch`. See `confluenceClient.ts` note above. This is Electron-specific.

2. **Code fence CDATA** — the paragraph-wrapping pass in `converter.ts` tracks an `insideCdata` flag to skip lines between `<![CDATA[` and `]]>`. Without this, code block content gets wrapped in `<p>` tags.

3. **Folder pages** — Confluence doesn't have "folders". The plugin creates real Confluence pages as folder placeholders. Their IDs are stored in `folderMap`. Stale entries (from deleted Confluence pages) are evicted and recreated.

4. **`normalizePath`** — always use Obsidian's `normalizePath` for vault paths (handles platform separators, leading slashes, etc.).

5. **`vaultDirectory` may be absolute** — `main.ts` strips the vault `basePath` prefix when computing whether a file is inside the sync root (for the context menu). Always compare vault-relative paths.

6. **`requestUrl` vs `fetch`** — use `requestUrl` for all API calls except attachments. `fetch` is blocked by CORS from `app://obsidian.md`. `requestUrl` routes through Electron's main process.

7. **Confluence REST API v1** — the plugin uses v1 (`/rest/api/...`), not v2. The v2 API has different endpoint paths and response shapes.

8. **Auth** — Basic auth with `email:apiToken` base64 encoded. The API token is created at https://id.atlassian.com/manage-profile/security/api-tokens. It is NOT the user's password.

9. **Confluence enforces space-wide unique page titles** — not just per parent. When multiple local files share the same basename (e.g. `Daily Notes/Learning.md` and `SRE/Learning.md`), `titleFromFile()` disambiguates by prefixing the immediate parent directory using `/` as separator (e.g. `"Daily Notes/Learning"`). Waypoint files (where `file.basename === file.parent.name`) are exempt and keep the plain basename.

10. **Waypoint files pushed last** — Files identified as Waypoints (index pages whose name matches their parent folder) are pushed after all other files in `sync()`. This ensures all their wiki link targets already have Confluence page IDs in state, so `buildTitleToUrl()` can resolve links to `<a href="...">` correctly.

11. **`contextDir` for wiki link resolution** — `markdownToConfluenceStorage()` accepts an optional `contextDir` (the file's immediate parent folder name, lowercased). This is used to prefer sibling-directory disambiguation matches: `[[Learning]]` inside `Daily Notes/` resolves to `"daily notes/learning"` before falling back to the global `"learning"`. Use `file.parent?.name.toLowerCase()` — do NOT use the full sync-root-relative path.

12. **Pull is content-only** — `pullPage()` only updates files that already exist in the local sync state. It never creates new local files from Confluence pages. The local vault is the authoritative source for file structure.

## Known Bugs

- **Image attachment 409 on re-push** — Uploading an image attachment that already exists on a page can still produce a 409 error in some cases. The `uploadAttachment()` method attempts to detect existing attachments via `getAttachmentId()` and use `PUT .../data` for updates, but this does not always prevent the conflict. Non-blocking: the console logs the error and sync continues.


