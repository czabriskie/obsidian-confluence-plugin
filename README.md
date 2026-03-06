# Obsidian Confluence Sync Plugin

Two-way sync between a directory in your Obsidian vault and a Confluence space.

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
| **Sync Direction**      | Both ways / Push only / Pull only                             |
| **Conflict Strategy**   | Keep newer / Keep local / Keep remote                         |
| **Auto-Sync Interval**  | Minutes between automatic syncs (0 = disabled)                |

Click **Test Connection** to verify your credentials.

### Excluding files or folders

Right-click any file or folder inside your sync directory in the file explorer and choose **Toggle Confluence Sync Exclusion**. Excluded paths appear in the plugin settings where they can also be removed.

## Commands

| Command                                              | Description                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Confluence Sync: Sync all**                        | Full two-way sync (push then pull, respecting sync direction setting)          |
| **Confluence Sync: Push to Confluence**              | Push all local changes to Confluence                                           |
| **Confluence Sync: Pull from Confluence**            | Pull all remote changes into the vault                                         |
| **Confluence Sync: Push current file to Confluence** | Push only the active editor's file                                             |
| **Confluence Sync: Reset sync state**                | Clear all file↔page mappings and folder mappings (does not delete remote data) |
| **Confluence Sync: Delete unmanaged local files**    | Remove local files in the sync directory that are not tracked by the plugin    |

You can also click the **C** ribbon icon for a quick full sync.

## How It Works

### Push

1. Each `.md` file in the vault directory is hashed and compared against the last-synced hash.
2. If changed, the Markdown is converted to Confluence Storage Format and upserted via the REST API.
3. Sub-directories are created as "folder pages" (empty Confluence pages that act as parents).
4. If a file has moved to a different directory since the last sync, the Confluence page is re-parented to match.

### Pull

1. Child pages of the configured parent (and its managed sub-pages) are fetched from the Confluence API.
2. Only pages that are direct children of a known parent are considered — the plugin never pulls from outside its managed tree.
3. Each page's content hash is compared against the stored hash; changed pages are converted to Markdown and written to the vault.
4. Folder pages (pages whose sole purpose is to act as directory parents) are **not** pulled as files.

### Conflict Resolution

When both the local file and the remote page have changed since the last sync, the plugin applies the configured strategy:

- **Keep newer** – compares timestamps and keeps whichever was modified more recently
- **Keep local** – always pushes the local version
- **Keep remote** – always overwrites the local file

### Content Conversion

The converter (`src/converter.ts`) handles:

- Headings, bold, italic, strikethrough, inline code
- Fenced code blocks ↔ Confluence `code` macro
- Ordered and unordered lists
- Links and images
- Horizontal rules and blockquotes
- Obsidian-specific syntax stripping: wiki links (`[[…]]`), embeds (`![[…]]`), highlights (`==…==`), footnotes, callouts, tags
- YAML frontmatter removal
- XML special-character escaping

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
