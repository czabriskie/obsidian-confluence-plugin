# Confluence Sync Plugin – Copilot Instructions

This is an Obsidian plugin written in TypeScript that provides two-way sync between an Obsidian vault directory and a Confluence space.

## Project Structure

- `src/main.ts` – Plugin entry point (extends `Plugin`)
- `src/confluenceClient.ts` – Confluence REST API v1 client (CRUD for pages)
- `src/converter.ts` – Markdown ↔ Confluence Storage Format conversion
- `src/syncEngine.ts` – Core sync orchestration (push/pull/conflict logic)
- `src/syncStateManager.ts` – Persists file path ↔ page ID mappings and content hashes
- `src/settings.ts` – Settings interface, defaults, and settings tab UI

## Tech Stack

- TypeScript, Obsidian API
- esbuild for bundling
- Confluence REST API v1 (Basic auth with API token)

## Conventions

- All source files live in `src/`
- The compiled output is `main.js` at the root
- Settings are stored via `plugin.loadData()` / `plugin.saveData()`
- Sync state is stored in `data.json` under the key `syncMap`
- Use `normalizePath` from obsidian for all vault paths
