# Obsidian Confluence Sync Plugin

Sync between a directory in your Obsidian vault and a Confluence space. The **local vault is the master** for file structure — creates, deletes, and moves always flow local → Confluence. Content updates to existing tracked pages flow both ways.

## Features

- **Two-way sync** – push Obsidian notes to Confluence pages and pull Confluence pages back as Markdown files
- **Directory structure preservation** – vault sub-folders are mirrored as Confluence "folder pages" so your hierarchy stays intact
- **File move detection** – moving a file to a different folder in Obsidian automatically re-parents the Confluence page
- **Conflict resolution** – configurable strategy: keep newer, keep local, or keep remote
- **Selective sync** – point the plugin at a specific vault subdirectory
- **Right-click exclusions** – exclude individual files or folders from sync via the file-explorer context menu
- **Auto-sync** – optional background sync on a configurable interval
- **Per-file push** – command to push only the currently active note
- **Sync state tracking** – avoids unnecessary API calls by tracking content hashes
- **404 recovery** – if a page is deleted on Confluence, the next push re-creates it automatically
- **Title-collision recovery** – if a page with the same title already exists, the plugin links to it instead of crashing
- **Cleanup command** – remove local files that were pulled by mistake and are not managed by the plugin

## Installation

### Manual (during development)

1. Build the plugin:
   ```bash
   npm install
   npm run build
   ```
2. Copy `main.js` and `manifest.json` to your vault's plugin directory:
   ```
   <vault>/.obsidian/plugins/obsidian-confluence-plugin/
   ```
3. Reload Obsidian and enable the plugin under **Settings → Community Plugins**.

## Configuration

Open **Settings → Confluence Sync** and fill in:

| Setting                 | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| **Confluence Base URL** | Your Confluence site, e.g. `https://myorg.atlassian.net/wiki` |
| **Atlassian Email**     | The email address on your Atlassian account                   |
| **API Token**           | Create one at https://id.atlassian.com/manage/api-tokens      |
| **Space Key**           | The short key for your Confluence space, e.g. `ENG`           |
| **Parent Page ID**      | (Optional) All synced pages are nested under this page        |
| **Vault Directory**     | Vault-relative folder to sync, e.g. `Confluence`              |
| **Sync Direction**      | Both / Push only / Pull only (see note below)                 |
| **Conflict Strategy**   | Keep newer / Keep local / Keep remote                         |
| **Auto-Sync Interval**  | Minutes between automatic syncs (0 = disabled)                |

Click **Test Connection** to verify your credentials.

> **Sync direction note:** "Both" does not mean fully bidirectional. The local vault is always the master for file structure. "Both" means: push all local changes to Confluence, then pull content updates for already-tracked pages back. New pages created in Confluence are never automatically imported as local files.

### Excluding files or folders

Right-click any file or folder inside your sync directory in the file explorer and choose **Toggle Confluence Sync Exclusion**. Excluded paths appear in the plugin settings where they can also be removed.

## Commands

| Command                                                       | Description                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Confluence Sync: Sync all**                                 | Push local changes then pull content updates for tracked pages                 |
| **Confluence Sync: Push to Confluence**                       | Push all local changes to Confluence                                           |
| **Confluence Sync: Pull from Confluence**                     | Pull content updates for already-tracked pages from Confluence                 |
| **Confluence Sync: Push current file to Confluence**          | Push only the active editor's file                                             |
| **Confluence Sync: Force push current file to Confluence**    | Push the active file ignoring hash cache (useful after converter changes)      |
| **Confluence Sync: Reset sync state**                         | Clear all file↔page mappings and folder mappings (does not delete remote data) |
| **Confluence Sync: Delete unmanaged local files**             | Remove local files in the sync directory that are not tracked by the plugin    |

You can also click the **C** ribbon icon for a quick full sync.

## How It Works

### Sync model

The **local vault is the master for file structure**. Creates, deletes, and moves only flow local → Confluence. Content updates to pages that are already tracked flow both ways (subject to the conflict strategy).

### Push

1. Each `.md` file in the vault directory is converted to Confluence Storage Format and its hash compared against the last-synced hash.
2. If changed (or the Confluence title needs updating), the page is created or updated via the REST API.
3. Sub-directories are created as “folder pages” (empty Confluence pages that act as parents).
4. If a file has moved to a different directory since the last sync, the Confluence page is re-parented to match.
5. **Waypoint files** (where the filename matches the parent folder) are pushed last so all their `[[wiki links]]` can be resolved to live Confluence URLs.
6. `[[wiki links]]` are resolved context-aware: `[[Page]]` inside `Daily Notes/` prefers `"Daily Notes/Page"` before falling back to the global `"Page"` title.

### Duplicate title disambiguation

Confluence enforces space-wide unique page titles. When two vault files share the same basename (e.g. `Daily Notes/Learning.md` and `SRE/Learning.md`), the plugin automatically prefixes the Confluence title with the immediate parent folder using `/` as separator:

- `Daily Notes/Learning.md` → Confluence title: `"Daily Notes/Learning"`
- `SRE/Learning.md` → Confluence title: `"SRE/Learning"`
- `Learning/Learning.md` (Waypoint — parent dir = filename) → keeps plain `"Learning"`

Local filenames are never changed.

### Pull

1. Child pages of the configured parent are fetched from the Confluence API.
2. Only pages that already have a local file tracked in the sync state are considered.
3. Each page’s content hash is compared against the stored hash; changed pages are converted to Markdown and written to the vault.
4. Folder pages and untracked Confluence pages are skipped — no new local files are created.

### Conflict Resolution

When both the local file and the remote page have changed since the last sync, the plugin applies the configured strategy:

- **Keep newer** – compares timestamps and keeps whichever was modified more recently
- **Keep local** – always pushes the local version
- **Keep remote** – always overwrites the local file

### Content Conversion

The converter (`src/converter.ts`) handles:

- Headings, bold, italic, strikethrough, inline code
- Fenced code blocks ↔ Confluence `code` macro
- Ordered and unordered lists (nested)
- Tables (GFM ↔ Confluence `<table>`)
- Links and images (including `![[image.png]]` → attachment macro)
- Horizontal rules and blockquotes
- Obsidian-specific syntax: `[[wiki links]]` (resolved to Confluence URLs), embeds (`![[...]]`), highlights (`==...==`), footnotes, callouts (`> [!NOTE]`), tags, Waypoint markers (`%% ... %%`)
- YAML frontmatter removal
- XML special-character escaping
- Optional `titleToUrl` map and `contextDir` for context-aware wiki link → URL resolution

## Development

```bash
# Install dependencies
npm install

# Watch mode (rebuilds on file changes)
npm run dev

# Production build (type-checks then bundles)
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

### Project Structure

```
src/
  main.ts               – Plugin entry point (extends Plugin)
  confluenceClient.ts   – Confluence REST API v1 client
  converter.ts          – Markdown ↔ Confluence Storage Format conversion
  syncEngine.ts         – Core sync orchestration (push/pull/conflict logic)
  syncStateManager.ts   – Persists file↔page mappings and content hashes
  settings.ts           – Settings interface, defaults, and settings tab UI
tests/
  converter.test.ts     – Unit tests for the format converter
  syncStateManager.test.ts – Unit tests for state management
```

## Notes

- The Markdown ↔ Storage Format conversion handles the most common constructs. For complex tables or Confluence-specific macros, extend `src/converter.ts`.
- API tokens are stored in Obsidian's plugin data file. Keep your vault private if it contains sensitive credentials.
- Sync state is stored in `data.json` under the keys `syncMap` (file records) and `folderMap` (folder page IDs).
- To start fresh: delete the synced pages in Confluence, run **Reset sync state**, then **Sync all**.

## Known Bugs

- **Image attachment 409 on re-push** — Re-uploading an image that already exists as a page attachment may occasionally produce a 409 error. Sync continues and no content is lost; the previously-uploaded attachment remains intact.
