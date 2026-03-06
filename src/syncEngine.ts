/**
 * Orchestrates two-way sync between the vault directory and Confluence.
 *
 * Strategy:
 *  - Obsidian → Confluence: if local file changed since last sync, push update.
 *  - Confluence → Obsidian: if remote page changed since last sync, pull update.
 *  - Conflict (both changed): the configured conflict strategy wins.
 *
 * "Changed" is determined by comparing a content hash stored in SyncStateManager.
 */

import { TFile, TFolder, Vault, normalizePath } from "obsidian";
import { ConfluenceClient, ConfluencePage } from "./confluenceClient";
import {
    markdownToConfluenceStorage,
    confluenceStorageToMarkdown,
} from "./converter";
import { SyncStateManager, SyncRecord } from "./syncStateManager";
import { ConfluenceSyncSettings } from "./settings";

export type ConflictStrategy = "local" | "remote" | "newer";
export type SyncDirection = "both" | "push" | "pull";

export interface SyncResult {
    pushed: string[];
    pulled: string[];
    conflicts: string[];
    errors: Array<{ path: string; error: string }>;
}

export class SyncEngine {
    /**
     * Transient cache for folder pages we *found* (but didn't create) during the
     * current sync session.  Keyed by vault-relative dir path → Confluence page ID.
     * NOT persisted — does NOT contribute to pull's "known folder" set, so pages
     * under externally-managed folders (e.g. "Old") are never auto-pulled.
     */
    private _foundFolderCache = new Map<string, string>();

    constructor(
        private vault: Vault,
        private client: ConfluenceClient,
        private state: SyncStateManager,
        private settings: ConfluenceSyncSettings
    ) { }

    async sync(): Promise<SyncResult> {
        const result: SyncResult = {
            pushed: [],
            pulled: [],
            conflicts: [],
            errors: [],
        };

        const direction: SyncDirection = this.settings.syncDirection;
        console.log(`[ConfluenceSync] Starting sync. Direction: ${direction}, Vault dir: "${this.settings.vaultDirectory}"`);

        // Reset transient folder cache for this sync session
        this._foundFolderCache.clear();

        // ── 1. Collect local files ────────────────────────────────────────
        const localFiles = await this.collectLocalFiles();
        console.log(`[ConfluenceSync] Found ${localFiles.length} local markdown file(s):`, localFiles.map(f => f.path));

        // ── 2. Push local → remote ────────────────────────────────────────
        // Push first so that folder pages exist in Confluence (and in folderMap)
        // before we fetch remote pages for pull.  This also means newly-pushed
        // pages will have sync records when pull runs, preventing them being
        // pulled back down as "new" files.
        if (direction === "both" || direction === "push") {
            for (const file of localFiles) {
                if (this.isExcluded(file.path)) {
                    console.log(`[ConfluenceSync] ⏭ Excluded: ${file.path}`);
                    continue;
                }
                try {
                    console.log(`[ConfluenceSync] Pushing: ${file.path}`);
                    const pushed = await this.pushFile(file, result);
                    if (pushed) {
                        result.pushed.push(file.path);
                        console.log(`[ConfluenceSync] ✅ Pushed: ${file.path}`);
                    } else {
                        console.log(`[ConfluenceSync] ⏭ Skipped (no change): ${file.path}`);
                    }
                } catch (e) {
                    console.error(`[ConfluenceSync] ❌ Push failed for ${file.path}:`, e);
                    result.errors.push({ path: file.path, error: String(e) });
                }
            }
        }

        // ── 3. Collect remote pages (after push, so folderMap is up-to-date) ──
        let remotePages: Array<ConfluencePage & { ancestorIds: string[]; ancestorTitles: string[] }> = [];
        if (direction === "both" || direction === "pull") {
            try {
                remotePages = await this.fetchRemotePages();
                console.log(`[ConfluenceSync] Found ${remotePages.length} remote page(s):`, remotePages.map(p => p.title));
            } catch (e) {
                console.error(`[ConfluenceSync] Failed to fetch remote pages:`, e);
                result.errors.push({ path: "<remote>", error: String(e) });
                return result;
            }
        }

        // ── 4. Pull remote → local ────────────────────────────────────────
        if (direction === "both" || direction === "pull") {
            // Before pulling content pages, seed folderMap with any intermediate
            // folder pages discovered in the remote ancestor chains.  This ensures
            // pages at depth 2+ pass the isDirectChild check even after a reset.
            await this.seedFolderMapFromRemoteAncestors(remotePages);

            for (const page of remotePages) {
                // Determine where this page would land locally and skip if excluded
                const prospectivePath = this.buildLocalPathFromAncestors(
                    page.title, page.ancestorIds, page.ancestorTitles
                );
                // Also check the prospective directory (in case a folder is excluded)
                const prospectiveDir = prospectivePath.split("/").slice(0, -1).join("/");
                if (this.isExcluded(prospectivePath) || this.isExcluded(prospectiveDir)) {
                    console.log(`[ConfluenceSync] ⏭ Excluded (pull): ${page.title}`);
                    continue;
                }
                try {
                    const pulled = await this.pullPage(page, result, page.ancestorIds, page.ancestorTitles);
                    if (pulled) result.pulled.push(page.title);
                } catch (e) {
                    console.error(`[ConfluenceSync] ❌ Pull failed for "${page.title}":`, e);
                    result.errors.push({
                        path: page.title,
                        error: String(e),
                    });
                }
            }
        }

        await this.state.save();
        console.log(`[ConfluenceSync] Done. Pushed: ${result.pushed.length}, Pulled: ${result.pulled.length}, Conflicts: ${result.conflicts.length}, Errors: ${result.errors.length}`);
        return result;
    }

    // ── Local → Remote ────────────────────────────────────────────────────

    private async pushFile(
        file: TFile,
        result: SyncResult
    ): Promise<boolean> {
        const content = await this.vault.read(file);
        const record = this.state.get(file.path);

        // Check if this file was moved from another path — match by title
        // against existing sync records. If found, treat as a move (reparent)
        // rather than a brand-new file.
        if (!record) {
            const title = this.titleFromFile(file);
            const movedFrom = this.findRecordByTitle(title);
            if (movedFrom) {
                const { path: oldPath, record: oldRecord } = movedFrom;
                console.log(`[ConfluenceSync] Detected move: "${oldPath}" → "${file.path}"`);

                // Resolve the new parent from the file's current directory
                const newParentId = await this.resolveParentId(file);

                // Fetch current remote state
                let remotePage;
                try {
                    remotePage = await this.client.getPage(oldRecord.confluencePageId);
                } catch (e: any) {
                    if (String(e).includes("404") || String(e).includes("not found")) {
                        // Page deleted remotely, let it fall through to create path
                        this.state.delete(oldPath);
                        return this.pushFile(file, result);
                    }
                    throw e;
                }

                const storageBody = markdownToConfluenceStorage(content);
                const parentToUse = newParentId ?? remotePage.parentId;
                console.log(`[ConfluenceSync] Re-parenting "${title}" from parent ${oldRecord.confluenceParentId} → ${parentToUse}`);

                const page = await this.client.updatePage(
                    oldRecord.confluencePageId,
                    title,
                    storageBody,
                    remotePage.version,
                    parentToUse
                );

                // Remove old path record, set new path record
                this.state.delete(oldPath);
                this.state.set(file.path, {
                    confluencePageId: page.id,
                    confluenceTitle: page.title,
                    confluenceVersion: page.version,
                    confluenceParentId: page.parentId,
                    lastSyncedAt: new Date().toISOString(),
                    contentHash: SyncStateManager.hash(page.body),
                });
                return true;
            }
        }

        if (!record) {
            // Brand new local file – create on Confluence under the correct parent
            const expectedParentId = await this.resolveParentId(file);
            const storageBody = markdownToConfluenceStorage(content);
            const title = this.titleFromFile(file);

            // Guard: if the resolved parent IS a page with the same title as this
            // file (e.g. folder "foo" and file "foo/foo.md" share the same name),
            // Confluence would reject setting a page as its own parent.  Instead,
            // treat that folder page as the content page for this file.
            const folderPageForSameName = expectedParentId
                ? await this.client.getPageByTitle(title, undefined).then(p =>
                    p && p.id === expectedParentId ? p : null
                ).catch(() => null)
                : null;
            if (folderPageForSameName) {
                console.log(`[ConfluenceSync] File shares name with its folder page — updating folder page ${folderPageForSameName.id} with content`);
                const updated = await this.client.updatePage(
                    folderPageForSameName.id, title, storageBody,
                    folderPageForSameName.version, folderPageForSameName.parentId
                );
                this.state.set(file.path, {
                    confluencePageId: updated.id,
                    confluenceTitle: updated.title,
                    confluenceVersion: updated.version,
                    confluenceParentId: updated.parentId,
                    lastSyncedAt: new Date().toISOString(),
                    contentHash: SyncStateManager.hash(updated.body),
                });
                return true;
            }

            let page;
            try {
                page = await this.client.createPage(title, storageBody, expectedParentId);
            } catch (e: any) {
                // Title collision – a page with this name already exists in the space.
                // Find it and link it to this local file instead of failing.
                if (String(e).includes("already exists")) {
                    const existing = await this.client.getPageByTitle(title, expectedParentId)
                        ?? await this.client.getPageByTitle(title);
                    if (existing) {
                        console.log(`[ConfluenceSync] Linking "${title}" to existing page ${existing.id}`);
                        this.state.set(file.path, {
                            confluencePageId: existing.id,
                            confluenceTitle: existing.title,
                            confluenceVersion: existing.version,
                            confluenceParentId: existing.parentId,
                            lastSyncedAt: new Date().toISOString(),
                            contentHash: SyncStateManager.hash(existing.body),
                        });
                        return true;
                    }
                }
                throw e;
            }
            this.state.set(file.path, {
                confluencePageId: page.id,
                confluenceTitle: page.title,
                confluenceVersion: page.version,
                confluenceParentId: page.parentId,
                lastSyncedAt: new Date().toISOString(),
                contentHash: SyncStateManager.hash(page.body),
            });
            return true;
        }

        // Existing record – check content changerkdown converted to storage
        // against the stored hash (which is always a storage-body hash).
        const storageBodyForCheck = markdownToConfluenceStorage(content);
        const storageHash = SyncStateManager.hash(storageBodyForCheck);
        const localChanged = storageHash !== record.contentHash;

        // Only check re-parenting if we have a recorded parent to compare against.
        // On first sync after this field was added the value will be undefined,
        // so we skip the reparent check and just backfill it below.
        const resolvedParentId = record.confluenceParentId !== undefined
            ? await this.resolveParentId(file)
            : undefined;
        // Guard: if the resolved parent IS the file's own page (same-name folder),
        // treat it as no reparent needed — the page is already its own container.
        const isSameNameFolder = resolvedParentId !== undefined
            && resolvedParentId === record.confluencePageId;
        if (isSameNameFolder) {
            console.log(`[ConfluenceSync] Same-name folder detected for "${file.path}" — page ${record.confluencePageId} is its own folder`);
        }
        const expectedParentId = isSameNameFolder
            ? record.confluenceParentId
            : resolvedParentId;
        const needsReparent = !isSameNameFolder
            && expectedParentId !== undefined
            && expectedParentId !== record.confluenceParentId;

        if (!localChanged && !needsReparent) {
            // Lazily backfill confluenceParentId if it was missing
            if (record.confluenceParentId === undefined) {
                try {
                    const remotePage = await this.client.getPage(record.confluencePageId);
                    this.state.set(file.path, {
                        ...record,
                        confluenceParentId: remotePage.parentId,
                    });
                } catch {
                    // Page was deleted remotely — clear the record so next sync recreates it
                    this.state.delete(file.path);
                }
            }
            return false;
        }

        // Need to fetch remote to check for conflicts and get current version.
        // If the page was deleted on Confluence, recreate it from scratch.
        let remotePage;
        try {
            remotePage = await this.client.getPage(record.confluencePageId);
        } catch (e: any) {
            if (String(e).includes("404") || String(e).includes("not found")) {
                console.log(`[ConfluenceSync] Remote page deleted — recreating: ${file.path}`);
                this.state.delete(file.path);
                return this.pushFile(file, result);
            }
            throw e;
        }
        const remoteHash = SyncStateManager.hash(remotePage.body);
        const remoteChanged = remoteHash !== record.contentHash;

        if (localChanged && remoteChanged) {
            result.conflicts.push(file.path);
            const strategy = this.settings.conflictStrategy;
            if (strategy === "remote") return false;
            if (strategy === "newer") {
                const localMtime = file.stat.mtime;
                const remoteMtime = new Date(remotePage.updatedAt).getTime();
                if (remoteMtime > localMtime) return false;
            }
        }

        if (needsReparent) {
            console.log(`[ConfluenceSync] Re-parenting "${remotePage.title}" to parent ${expectedParentId}`);
        }

        const storageBody = markdownToConfluenceStorage(content);
        const title = this.titleFromFile(file);
        const page = await this.client.updatePage(
            record.confluencePageId,
            title,
            storageBody,
            remotePage.version,
            needsReparent ? expectedParentId : (remotePage.parentId ?? record.confluenceParentId)
        );
        this.state.set(file.path, {
            confluencePageId: page.id,
            confluenceTitle: page.title,
            confluenceVersion: page.version,
            confluenceParentId: page.parentId,
            lastSyncedAt: new Date().toISOString(),
            contentHash: SyncStateManager.hash(page.body),
        });
        return true;
    }

    // ── Remote → Local ────────────────────────────────────────────────────

    private async pullPage(
        page: ConfluencePage,
        result: SyncResult,
        ancestorIds: string[] = [],
        ancestorTitles: string[] = []
    ): Promise<boolean> {
        // Skip folder/container pages — they represent directories, not content files.
        const allFolderPageIds = new Set(Object.values(this.state.allFolders()));
        if (allFolderPageIds.has(page.id)) {
            console.log(`[ConfluenceSync] ⏭ Skipping folder page in pull: "${page.title}" (${page.id})`);
            return false;
        }

        const remoteHash = SyncStateManager.hash(page.body);

        // Find existing local mapping
        const localPath = this.state.findByPageId(page.id);

        if (localPath) {
            const record = this.state.get(localPath)!;

            // No remote change
            if (record.contentHash === remoteHash) return false;

            const file = this.vault.getAbstractFileByPath(localPath);

            if (file instanceof TFile) {
                const localContent = await this.vault.read(file);
                const localStorageHash = SyncStateManager.hash(markdownToConfluenceStorage(localContent));
                const localChanged = localStorageHash !== record.contentHash;

                if (localChanged) {
                    // Conflict – already recorded during push phase; honour strategy
                    const strategy = this.settings.conflictStrategy;
                    if (strategy === "local") return false;
                    if (strategy === "newer") {
                        const localMtime = file.stat.mtime;
                        const remoteMtime = new Date(page.updatedAt).getTime();
                        if (localMtime > remoteMtime) return false;
                    }
                }
            }

            const markdown = confluenceStorageToMarkdown(page.body);
            if (file instanceof TFile) {
                await this.vault.modify(file, markdown);
            } else {
                const targetPath = this.buildLocalPathFromAncestors(page.title, ancestorIds, ancestorTitles);
                await this.ensureFolder(targetPath);
                await this.vault.create(targetPath, markdown);
            }

            this.state.set(localPath, {
                ...record,
                confluenceParentId: page.parentId,
                confluenceVersion: page.version,
                lastSyncedAt: new Date().toISOString(),
                contentHash: remoteHash,
            });
            return true;
        }

        // Brand new remote page – only create a local file if this page sits
        // directly under the configured sync root or under a folder page we
        // manage. Pre-existing deep pages in Confluence that were never part of
        // this sync should not be auto-imported.
        const rootParentId = this.settings.confluenceParentPageId;
        const directParent = page.parentId;
        const isDirectChild = directParent === rootParentId
            || (directParent !== undefined && allFolderPageIds.has(directParent));

        if (!isDirectChild) {
            console.log(`[ConfluenceSync] ⏭ Skipping unmanaged remote page: "${page.title}" (parent ${directParent})`);
            return false;
        }

        // Create the local file
        const markdown = confluenceStorageToMarkdown(page.body);
        const targetPath = this.buildLocalPathFromAncestors(page.title, ancestorIds, ancestorTitles);
        await this.ensureFolder(targetPath);
        const existing = this.vault.getAbstractFileByPath(targetPath);
        if (existing instanceof TFile) {
            await this.vault.modify(existing, markdown);
        } else {
            await this.vault.create(targetPath, markdown);
        }
        this.state.set(targetPath, {
            confluencePageId: page.id,
            confluenceTitle: page.title,
            confluenceVersion: page.version,
            confluenceParentId: page.parentId,
            lastSyncedAt: new Date().toISOString(),
            contentHash: remoteHash,
        });
        return true;
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /**
     * Walk the ancestor chains of all fetched remote pages and register any
     * intermediate pages (those that sit between the sync root and a content
     * page) into folderMap.  This is needed so that content pages at depth 2+
     * pass the isDirectChild check in pullPage even after a sync-state reset.
     *
     * We look up each intermediate ancestor by ID to get its local vault path,
     * then store it in folderMap keyed by the vault directory it maps to.
     */
    private async seedFolderMapFromRemoteAncestors(
        remotePages: Array<{ ancestorIds: string[]; ancestorTitles: string[] }>
    ): Promise<void> {
        const rootParentId = this.settings.confluenceParentPageId;
        const root = this.resolveSyncRoot();
        const existingFolderIds = new Set(Object.values(this.state.allFolders()));

        // Collect unique intermediate ancestor IDs (those after the root parent)
        const toRegister = new Map<string, string>(); // pageId → title
        for (const page of remotePages) {
            const startIdx = rootParentId ? page.ancestorIds.indexOf(rootParentId) : -1;
            if (startIdx < 0) continue;
            // Segments between root parent and the page itself are folder pages
            const intermediateIds = page.ancestorIds.slice(startIdx + 1);
            const intermediateTitles = page.ancestorTitles.slice(startIdx + 1);
            for (let i = 0; i < intermediateIds.length; i++) {
                const id = intermediateIds[i];
                if (!existingFolderIds.has(id)) {
                    toRegister.set(id, intermediateTitles[i]);
                }
            }
        }

        if (toRegister.size === 0) return;

        // For each intermediate ancestor, build its vault path from its own
        // ancestor chain and store it in folderMap.
        for (const page of remotePages) {
            const startIdx = rootParentId ? page.ancestorIds.indexOf(rootParentId) : -1;
            if (startIdx < 0) continue;
            const intermediateIds = page.ancestorIds.slice(startIdx + 1);
            const intermediateTitles = page.ancestorTitles.slice(startIdx + 1);

            let accPath = root;
            for (let i = 0; i < intermediateIds.length; i++) {
                const id = intermediateIds[i];
                const title = intermediateTitles[i];
                const safeTitle = title.replace(/[/\\:*?"<>|]/g, "-");
                accPath = normalizePath(`${accPath}/${safeTitle}`);

                if (!this.state.getFolder(accPath)) {
                    console.log(`[ConfluenceSync] Seeding folderMap: "${title}" (${id}) → ${accPath}`);
                    this.state.setFolder(accPath, id);
                }
            }
        }
    }

    private async collectLocalFiles(): Promise<TFile[]> {
        // Support both vault-relative paths and absolute paths
        let folderPath = this.settings.vaultDirectory;
        const vaultBasePath = (this.vault.adapter as any).basePath as string | undefined;
        if (vaultBasePath && folderPath.startsWith(vaultBasePath)) {
            folderPath = folderPath.slice(vaultBasePath.length).replace(/^\//, "");
        }
        const folder = normalizePath(folderPath);
        console.log(`[ConfluenceSync] Resolved vault folder: "${folder}"`);
        const abstractFolder = this.vault.getAbstractFileByPath(folder);

        if (!(abstractFolder instanceof TFolder)) return [];

        const files: TFile[] = [];
        const recurse = (f: TFolder) => {
            for (const child of f.children) {
                if (child instanceof TFile && child.extension === "md") {
                    files.push(child);
                } else if (child instanceof TFolder) {
                    recurse(child);
                }
            }
        };
        recurse(abstractFolder);
        return files;
    }

    private async fetchRemotePages(): Promise<Array<ConfluencePage & { ancestorIds: string[]; ancestorTitles: string[] }>> {
        const rootParentId = this.settings.confluenceParentPageId;

        // listPages with an ancestor filter returns ALL descendants of that page.
        const children = await this.client.listPages(
            rootParentId || undefined
        );

        // The set of folder page IDs we've created or found — these have no .md file.
        const folderPageIds = new Set([
            ...Object.values(this.state.allFolders()),
            ...this._foundFolderCache.values(),
        ]);

        const pages: Array<ConfluencePage & { ancestorIds: string[]; ancestorTitles: string[] }> = [];
        for (const c of children) {
            // Skip folder/container pages (pages we created or found for subdirectories)
            if (folderPageIds.has(c.id)) {
                console.log(`[ConfluenceSync] Skipping folder page: "${c.title}"`);
                continue;
            }

            // If a parent is configured, only include pages that are
            // descendants of it — i.e. the parent ID appears in their ancestor chain.
            // If no parent is configured, include all pages in the space.
            if (rootParentId && !c.ancestorIds.includes(rootParentId)) {
                continue;
            }

            try {
                const fullPage = await this.client.getPage(c.id);
                pages.push({
                    ...fullPage,
                    ancestorIds: c.ancestorIds,
                    ancestorTitles: c.ancestorTitles,
                });
            } catch {
                // skip pages we can't read
            }
        }
        return pages;
    }

    private titleFromFile(file: TFile): string {
        return file.basename;
    }

    /**
     * Find an existing sync record by Confluence title.
     * Used to detect file moves (path changed but title stayed the same).
     */
    private findRecordByTitle(title: string): { path: string; record: SyncRecord } | null {
        const all = this.state.all();
        for (const [path, record] of Object.entries(all)) {
            if (record.confluenceTitle === title) {
                return { path, record };
            }
        }
        return null;
    }

    private buildLocalPath(title: string): string {
        const dir = this.resolveSyncRoot();
        const safeName = title.replace(/[/\\:*?"<>|]/g, "-");
        return normalizePath(`${dir}/${safeName}.md`);
    }

    /**
     * Build the local path for a pulled page, placing it in the correct
     * subdirectory based on its Confluence ancestor chain.
     *
     * The ancestor chain from listPages includes ALL ancestors (space root,
     * parent-of-parent-page, etc.).  We only want the segments that sit
     * *below* the configured parent page, so we strip everything up to and
     * including confluenceParentPageId from the chain.
     */
    private buildLocalPathFromAncestors(
        title: string,
        ancestorIds: string[],
        ancestorTitles: string[]
    ): string {
        const root = this.resolveSyncRoot();
        const rootParentId = this.settings.confluenceParentPageId;

        // Find where the configured root parent sits in the ancestor chain.
        // Everything at that index and below (inclusive) is stripped — we only
        // want the folder segments that sit *between* the root parent and the page.
        let startIdx = -1;
        if (rootParentId) {
            startIdx = ancestorIds.indexOf(rootParentId);
        }

        // Segments after the root parent = intermediate folder page titles,
        // which become the subdirectory names on disk.
        const relSegments = startIdx >= 0
            ? ancestorTitles.slice(startIdx + 1)
            : [];

        const safeName = title.replace(/[/\\:*?"<>|]/g, "-");
        const safeSegments = relSegments.map((s) => s.replace(/[/\\:*?"<>|]/g, "-"));

        const parts = [root, ...safeSegments, `${safeName}.md`];
        return normalizePath(parts.join("/"));
    }

    private async ensureFolder(filePath: string): Promise<void> {
        const parts = filePath.split("/");
        parts.pop(); // remove filename
        const dir = parts.join("/");
        if (!dir) return;
        const existing = this.vault.getAbstractFileByPath(dir);
        if (!existing) {
            await this.vault.createFolder(dir);
        }
    }

    /**
     * Walk the file's directory path relative to the sync root.
     * For each subfolder segment, ensure a Confluence page exists (creating
     * it if needed) and return the ID of the immediate parent folder page.
     */
    private async resolveParentId(file: TFile): Promise<string | undefined> {
        const rootParentId = this.settings.confluenceParentPageId || undefined;

        // Get the sync root folder path (vault-relative)
        let rootFolder = this.settings.vaultDirectory;
        const vaultBasePath = (this.vault.adapter as any).basePath as string | undefined;
        if (vaultBasePath && rootFolder.startsWith(vaultBasePath)) {
            rootFolder = rootFolder.slice(vaultBasePath.length).replace(/^\//, "");
        }
        rootFolder = normalizePath(rootFolder);

        // Get the file's directory (vault-relative)
        const fileDir = normalizePath(file.parent?.path ?? "");

        // If the file is directly in the root folder, use the configured parent
        if (fileDir === rootFolder) {
            return rootParentId;
        }

        // Build the list of directory segments between rootFolder and fileDir
        // e.g. rootFolder = "1 Projects/Confluence"
        //      fileDir     = "1 Projects/Confluence/One on Ones (Jens and Cam)"
        //      segments    = ["One on Ones (Jens and Cam)"]
        const relativePath = fileDir.slice(rootFolder.length).replace(/^\//, "");
        const segments = relativePath.split("/").filter(Boolean);

        let currentParentId = rootParentId;
        let accumulatedPath = rootFolder;

        for (const segment of segments) {
            accumulatedPath = normalizePath(`${accumulatedPath}/${segment}`);

            // Check if we already have a Confluence page for this folder
            // Prefer the persistent folderMap (pages we created), then the transient
            // found-cache, so that found-but-not-created folders don't end up in the
            // persistent store and don't pollute pull's "known folder" set.
            const cachedCreated = this.state.getFolder(accumulatedPath);
            if (cachedCreated) {
                currentParentId = cachedCreated;
                continue;
            }
            const cachedFound = this._foundFolderCache.get(accumulatedPath);
            if (cachedFound) {
                currentParentId = cachedFound;
                continue;
            }

            // Try to find the folder page on Confluence by title
            const existing = await this.client.getPageByTitle(segment, currentParentId);
            if (existing) {
                // If this path exists as a real local directory, treat it as a
                // managed folder (persist to folderMap).  This covers the case
                // where a folder page was created on a previous sync but folderMap
                // was later cleared (e.g. after a reset).
                // If the local directory does NOT exist, store only in the transient
                // cache so we don't accidentally pull unrelated Confluence pages.
                const localDirExists = !!this.vault.getAbstractFileByPath(accumulatedPath);
                if (localDirExists) {
                    this.state.setFolder(accumulatedPath, existing.id);
                    console.log(`[ConfluenceSync] Found folder page "${segment}" (${existing.id}) — persisted (local dir exists)`);
                } else {
                    this._foundFolderCache.set(accumulatedPath, existing.id);
                    console.log(`[ConfluenceSync] Found (unmanaged) folder page "${segment}" (${existing.id}) — not persisted`);
                }
                currentParentId = existing.id;
                continue;
            }

            // Create the folder page with empty body
            const folderPage = await this.client.createPage(
                segment,
                "<p></p>",
                currentParentId
            );
            // Store in the persistent folderMap — we OWN this page.
            this.state.setFolder(accumulatedPath, folderPage.id);
            currentParentId = folderPage.id;
            console.log(`[ConfluenceSync] Created folder page "${segment}" (${folderPage.id})`);
        }

        return currentParentId;
    }

    /** Resolve the vault-relative root sync folder. */
    private resolveSyncRoot(): string {
        let rootFolder = this.settings.vaultDirectory;
        const vaultBasePath = (this.vault.adapter as any).basePath as string | undefined;
        if (vaultBasePath && rootFolder.startsWith(vaultBasePath)) {
            rootFolder = rootFolder.slice(vaultBasePath.length).replace(/^\//, "");
        }
        return normalizePath(rootFolder);
    }

    /**
     * Delete local files that were pulled from unmanaged parts of the Confluence
     * tree (e.g. an "Old" folder that existed before this plugin was set up).
     *
     * A file is considered "unmanaged" when its vault-relative path contains a
     * subdirectory segment (between the sync root and the file) that is NOT in
     * the persistent folderMap.  Files sitting directly in the sync root are
     * always considered managed.
     *
     * Returns the list of paths that were deleted.
     */
    async deleteUnmanagedLocalFiles(): Promise<string[]> {
        const root = this.resolveSyncRoot();
        const managedFolderPaths = new Set(Object.keys(this.state.allFolders()));
        const deleted: string[] = [];

        const allLocal = await this.collectLocalFiles();
        for (const file of allLocal) {
            const fileDir = normalizePath(file.parent?.path ?? "");

            // Files directly in the sync root are managed
            if (fileDir === root) continue;

            // Get the path of the immediate parent directory
            // If that directory is NOT in folderMap, the file is unmanaged
            if (!managedFolderPaths.has(fileDir)) {
                console.log(`[ConfluenceSync] Deleting unmanaged local file: ${file.path}`);
                // Remove from sync state too
                this.state.delete(file.path);
                await this.vault.trash(file, true);
                deleted.push(file.path);
            }
        }

        // Also delete empty unmanaged folders left behind
        await this.cleanupEmptyUnmanagedFolders(root, managedFolderPaths);

        // Prune folderMap entries for directories that no longer exist in the vault
        for (const dirPath of Object.keys(this.state.allFolders())) {
            const exists = this.vault.getAbstractFileByPath(dirPath);
            if (!exists) {
                console.log(`[ConfluenceSync] Pruning stale folderMap entry: ${dirPath}`);
                this.state.deleteFolder(dirPath);
            }
        }

        await this.state.save();
        return deleted;
    }

    /** Recursively remove empty folders under the sync root that are NOT in folderMap. */
    private async cleanupEmptyUnmanagedFolders(
        root: string,
        managedFolderPaths: Set<string>
    ): Promise<void> {
        const rootFolder = this.vault.getAbstractFileByPath(root);
        if (!(rootFolder instanceof TFolder)) return;

        const recurse = async (folder: TFolder): Promise<boolean> => {
            // Recurse into children first
            let hasChildren = false;
            for (const child of [...folder.children]) {
                if (child instanceof TFolder) {
                    const childHasChildren = await recurse(child);
                    if (childHasChildren) hasChildren = true;
                } else {
                    hasChildren = true; // has a file
                }
            }
            // Don't delete the sync root itself
            if (folder.path === root) return hasChildren;
            // Only delete if empty AND not managed
            if (!hasChildren && !managedFolderPaths.has(folder.path)) {
                console.log(`[ConfluenceSync] Removing empty unmanaged folder: ${folder.path}`);
                await this.vault.trash(folder, true);
                return false;
            }
            return hasChildren;
        };

        await recurse(rootFolder);
    }

    /** Returns true if the given vault-relative path is excluded from sync. */
    private isExcluded(path: string): boolean {
        const excluded: string[] = (this.settings as any).excludedPaths ?? [];
        return excluded.some(
            (ex: string) => path === ex || path.startsWith(ex + "/")
        );
    }
}
