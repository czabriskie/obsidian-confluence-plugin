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
    extractEmbeddedImages,
    COMMENTS_SECTION_MARKER,
    formatCommentsAsMarkdown,
    preserveInlineCommentMarkers,
    stripInlineCommentMarkers,
} from "./converter";
import { SyncStateManager, SyncRecord } from "./syncStateManager";
import { ConfluenceSyncSettings } from "./settings";
import { ConfluenceComment } from "./confluenceClient";

export type ConflictStrategy = "local" | "remote" | "newer";
export type SyncDirection = "both" | "push" | "pull";

export interface SyncResult {
    pushed: string[];
    pulled: string[];
    deleted: string[];
    conflicts: string[];
    errors: Array<{ path: string; error: string }>;
}

/** Sentinel error thrown when a folder page's parent no longer exists in Confluence. */
class StaleFolderError extends Error {
    constructor(public readonly segment: string, public readonly staleParentId: string | undefined) {
        super(`Stale folder parent ${staleParentId} for segment "${segment}"`);
        this.name = "StaleFolderError";
    }
}

export class SyncEngine {
    /**
     * Transient cache for folder pages we *found* (but didn't create) during the
     * current sync session.  Keyed by vault-relative dir path → Confluence page ID.
     * NOT persisted — does NOT contribute to pull's "known folder" set, so pages
     * under externally-managed folders (e.g. "Old") are never auto-pulled.
     */
    private _foundFolderCache = new Map<string, string>();

    /**
     * Basenames that appear in more than one directory under the sync root.
     * When a basename is in this set, titleFromFile() prefixes it with the
     * immediate parent directory so the Confluence page title is unique within
     * the space. (Confluence enforces space-wide title uniqueness.)
     * Local filenames are never affected — only the Confluence page title.
     */
    private _ambiguousBasenames = new Set<string>();

    constructor(
        private vault: Vault,
        private client: ConfluenceClient,
        private state: SyncStateManager,
        private settings: ConfluenceSyncSettings
    ) { }

    /**
     * Build a map of page title (lowercased) → Confluence page URL from the
     * current sync state. Used to resolve [[wiki links]] in markdown.
     */
    /**
     * Returns the immediate parent folder name of `file`, lowercased.
     * Used as `contextDir` for wiki link resolution in markdownToConfluenceStorage.
     * Disambiguated Confluence titles use the format "ParentDir/basename", so
     * matching against just the parent folder name is sufficient.
     */
    private contextDirForFile(file: TFile): string {
        return (file.parent?.name ?? "").toLowerCase();
    }

    private buildTitleToUrl(): Map<string, string> {
        const base = this.settings.confluenceBaseUrl.replace(/\/$/, "");
        const map = new Map<string, string>();
        for (const record of Object.values(this.state.all())) {
            const url = `${base}/pages/viewpage.action?pageId=${record.confluencePageId}`;
            map.set(record.confluenceTitle.trim().toLowerCase(), url);
        }
        return map;
    }

    async sync(): Promise<SyncResult> {
        const result: SyncResult = {
            pushed: [],
            pulled: [],
            deleted: [],
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
        this._ambiguousBasenames = this.computeAmbiguousBasenames(localFiles);

        // Pre-pass: rename any Confluence pages whose stored title no longer
        // matches the title we'd compute for them now (e.g. separator changed,
        // or disambiguation was just introduced). Doing this before any creates
        // ensures the title space is clean regardless of processing order.
        await this.preRenameStalePages(localFiles);

        // ── 2. Delete Confluence pages for files removed locally ───────────
        if (direction === "both" || direction === "push") {
            await this.deleteObsoletePages(localFiles, result);
            if (result.deleted.length > 0) {
                console.log(`[ConfluenceSync] Deleted ${result.deleted.length} obsolete page(s):`, result.deleted);
            }
        }

        // ── 3. Push local → remote ────────────────────────────────────────
        // Push first so that folder pages exist in Confluence (and in folderMap)
        // before we fetch remote pages for pull.  This also means newly-pushed
        // pages will have sync records when pull runs, preventing them being
        // pulled back down as "new" files.
        //
        // Waypoint files (same basename as parent dir) are pushed LAST so that
        // all the pages they link to already have Confluence records in state,
        // making wiki link → URL resolution complete and correct.
        if (direction === "both" || direction === "push") {
            const isWaypoint = (f: TFile) => {
                const parts = f.path.split("/");
                const parentDir = parts.length >= 2 ? parts[parts.length - 2] : "";
                return parentDir === f.basename;
            };
            const nonWaypoints = localFiles.filter(f => !isWaypoint(f));
            const waypoints    = localFiles.filter(f =>  isWaypoint(f));
            const orderedFiles = [...nonWaypoints, ...waypoints];

            for (const file of orderedFiles) {
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

        // ── 4. Collect remote pages (after push, so folderMap is up-to-date) ──
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

        // ── 5. Pull remote → local ────────────────────────────────────────
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
        console.log(`[ConfluenceSync] Done. Pushed: ${result.pushed.length}, Pulled: ${result.pulled.length}, Deleted: ${result.deleted.length}, Conflicts: ${result.conflicts.length}, Errors: ${result.errors.length}`);
        return result;
    }

    // ── Local → Remote ────────────────────────────────────────────────────

    private async pushFile(
        file: TFile,
        result: SyncResult,
        force = false
    ): Promise<boolean> {
        const content = await this.vault.read(file);

        // Block push if file contains unresolved conflict markers
        if (content.includes("<<<<<<< LOCAL") || content.includes(">>>>>>> CONFLUENCE")) {
            throw new Error(
                `"${file.basename}" has unresolved conflict markers. Resolve them before syncing.`
            );
        }

        const record = this.state.get(file.path);

        // Check if this file was moved from another path — match by title against
        // existing sync records where the original file no longer exists.
        // Guard: if another file at oldPath still exists, this is a duplicate name
        // (not a move) — skip move logic entirely.
        if (!record) {
            const title = this.titleFromFile(file);
            const movedFrom = this.findRecordByTitle(title);
            if (movedFrom && !this.vault.getAbstractFileByPath(movedFrom.path)) {
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

                const storageBody = preserveInlineCommentMarkers(
                    remotePage.body,
                    markdownToConfluenceStorage(content, this.buildTitleToUrl(), this.contextDirForFile(file))
                );
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
                    contentHash: SyncStateManager.hash(storageBody),
                });
                await this.uploadPageImages(page.id, content, file);
                await this.refreshLocalComments(file, page.id);
                return true;
            }
        }

        if (!record) {
            // Brand new local file – create on Confluence under the correct parent
            const expectedParentId = await this.resolveParentId(file);
            const titleToUrl = this.buildTitleToUrl();
            const storageBody = markdownToConfluenceStorage(content, titleToUrl, this.contextDirForFile(file));
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
                    contentHash: SyncStateManager.hash(storageBody),
                });
                await this.refreshLocalComments(file, updated.id);
                return true;
            }

            let page;
            try {
                page = await this.client.createPage(title, storageBody, expectedParentId);
            } catch (e: any) {
                // Stale folder parent — evict and retry so the hierarchy is rebuilt.
                if (this.isParentNotExistError(e) || e instanceof StaleFolderError) {
                    this.evictStaleFolderEntries(expectedParentId);
                    console.warn(
                        `[ConfluenceSync] Parent page deleted for "${file.path}" — evicting stale folder entries and retrying`
                    );
                    return this.pushFile(file, result);
                }
                // Title collision – a page with this name already exists in the space.
                // Only link to it if no other local file already owns that page ID.
                if (String(e).includes("already exists")) {
                    const existing = await this.client.getPageByTitle(title, expectedParentId)
                        ?? await this.client.getPageByTitle(title);
                    if (existing) {
                        const alreadyOwned = this.state.findByPageId(existing.id);
                        if (alreadyOwned && alreadyOwned !== file.path) {
                            // Another local file owns this page. Check whether
                            // disambiguation has now assigned that file a new
                            // prefixed title (e.g. a Waypoint file is claiming
                            // the plain basename, displacing the previous owner).
                            // If so, rename the displaced page first, then retry.
                            const otherFile = this.vault.getAbstractFileByPath(alreadyOwned);
                            console.log(
                                `[ConfluenceSync] Displacement check: alreadyOwned="${alreadyOwned}" ` +
                                `otherFile=${otherFile ? "found (" + otherFile.constructor.name + ")" : "NOT FOUND"} ` +
                                `existing.title="${existing.title}"`
                            );
                            if (otherFile instanceof TFile) {
                                const otherNewTitle = this.titleFromFile(otherFile);
                                console.log(`[ConfluenceSync] Displacement otherNewTitle="${otherNewTitle}" vs existing.title="${existing.title}"`);
                                if (otherNewTitle !== existing.title) {
                                    console.log(
                                        `[ConfluenceSync] Renaming displaced page "${existing.title}" → "${otherNewTitle}" ` +
                                        `(owned by "${alreadyOwned}") to free up title for "${file.path}"`
                                    );
                                    const updated = await this.client.updatePage(
                                        existing.id,
                                        otherNewTitle,
                                        existing.body,
                                        existing.version,
                                        existing.parentId
                                    );
                                    const otherRecord = this.state.get(alreadyOwned)!;
                                    this.state.set(alreadyOwned, {
                                        ...otherRecord,
                                        confluenceTitle: updated.title,
                                        confluenceVersion: updated.version,
                                    });
                                    // Title is now free — retry creating this file's page.
                                    return this.pushFile(file, result);
                                }
                            }
                            // Another local file owns this page — don't steal it.
                            // Re-throw so the caller surfaces the error.
                            throw new Error(
                                `Confluence page "${title}" (${existing.id}) is already linked to "${alreadyOwned}". ` +
                                `Rename one of the files to give it a unique title.`
                            );
                        }
                        console.log(`[ConfluenceSync] Linking "${title}" to existing page ${existing.id}`);
                        this.state.set(file.path, {
                            confluencePageId: existing.id,
                            confluenceTitle: existing.title,
                            confluenceVersion: existing.version,
                            confluenceParentId: existing.parentId,
                            lastSyncedAt: new Date().toISOString(),
                            contentHash: SyncStateManager.hash(storageBody),
                        });
                        await this.refreshLocalComments(file, existing.id);
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
                contentHash: SyncStateManager.hash(storageBody),
            });
            await this.uploadPageImages(page.id, content, file);
            await this.refreshLocalComments(file, page.id);
            return true;
        }
        // against the stored hash (which is always a storage-body hash).
        const storageBodyForCheck = markdownToConfluenceStorage(content, this.buildTitleToUrl(), this.contextDirForFile(file));
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

        // Check if the disambiguation title has changed (e.g. separator changed,
        // or the file was previously synced before disambiguation was introduced).
        const currentTitle = this.titleFromFile(file);
        const needsTitleRename = currentTitle !== record.confluenceTitle;
        if (needsTitleRename) {
            console.log(`[ConfluenceSync] Title rename needed for "${file.path}": "${record.confluenceTitle}" → "${currentTitle}"`);
        }

        if (!localChanged && !needsReparent && !needsTitleRename && !force) {
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

        const plainStorageBody = markdownToConfluenceStorage(content, this.buildTitleToUrl(), this.contextDirForFile(file));
        const storageBody = preserveInlineCommentMarkers(
            remotePage.body,
            plainStorageBody
        );
        const title = this.titleFromFile(file);
        let page;
        try {
            page = await this.client.updatePage(
                record.confluencePageId,
                title,
                storageBody,
                remotePage.version,
                needsReparent ? expectedParentId : (remotePage.parentId ?? record.confluenceParentId)
            );
        } catch (e: any) {
            // The parent page no longer exists on Confluence (e.g. a folder page
            // was deleted).  Evict all stale folderMap entries, clear this file's
            // record, and retry so the folder hierarchy gets recreated.
            if (this.isParentNotExistError(e) || e instanceof StaleFolderError) {
                const parentId = needsReparent
                    ? expectedParentId
                    : (remotePage.parentId ?? record.confluenceParentId);
                this.evictStaleFolderEntries(parentId);
                this.state.delete(file.path);
                console.warn(
                    `[ConfluenceSync] Parent page deleted for "${file.path}" — evicting stale folder entries and retrying`
                );
                return this.pushFile(file, result);
            }
            throw e;
        }
        // Store the hash of the *plain* conversion (without inline comment markers)
        // because the change-detection check computes hash(markdownToConfluenceStorage(...))
        // — without markers. Using the same basis prevents false re-pushes.
        this.state.set(file.path, {
            confluencePageId: page.id,
            confluenceTitle: page.title,
            confluenceVersion: page.version,
            confluenceParentId: page.parentId,
            lastSyncedAt: new Date().toISOString(),
            contentHash: SyncStateManager.hash(plainStorageBody),
        });
        await this.uploadPageImages(page.id, content, file);
        await this.refreshLocalComments(file, page.id);
        return true;
    }

    /**
     * Re-fetch Confluence comments and ensure they're appended to the local file.
     * Strips any existing comments section first to avoid duplicates.
     */
    private async refreshLocalComments(file: TFile, pageId: string): Promise<void> {
        try {
            const remotePage = await this.client.getPage(pageId);
            const comments = await this.client.getPageComments(pageId);

            const localRaw = await this.vault.read(file);
            const markerIdx = localRaw.indexOf(COMMENTS_SECTION_MARKER);
            const contentWithoutComments = (markerIdx !== -1
                ? localRaw.substring(0, markerIdx)
                : localRaw
            ).trimEnd();

            const commentsSection = comments.length > 0
                ? formatCommentsAsMarkdown(comments, remotePage.body, contentWithoutComments)
                : "";

            const newContent = contentWithoutComments + commentsSection;
            if (newContent !== localRaw) {
                await this.vault.modify(file, newContent);
            }
        } catch (e) {
            console.warn(`[ConfluenceSync] Failed to refresh comments for "${file.path}":`, e);
        }
    }

    /**
     * Force-push a single file regardless of whether the content hash has changed.
     * Useful when the converter has been fixed and the stored hash is stale.
     */
    async pushFileDirect(file: TFile, force = false): Promise<SyncResult> {
        this._foundFolderCache.clear();
        this._ambiguousBasenames = this.computeAmbiguousBasenames(await this.collectLocalFiles());
        const result: SyncResult = { pushed: [], pulled: [], deleted: [], conflicts: [], errors: [] };
        try {
            if (force) {
                // Force push: reconcile with Confluence first.
                // Pull remote content and compare — if they differ, insert
                // conflict markers so the user can resolve before pushing.
                const record = this.state.get(file.path);
                let pageId: string | undefined;
                if (record) {
                    pageId = record.confluencePageId;
                } else {
                    const existing = await this.client.getPageByTitle(file.basename);
                    if (existing) pageId = existing.id;
                }

                if (pageId) {
                    // Remote page exists — check if it changed since our last sync
                    const remotePage = await this.client.getPage(pageId);

                    // If the remote version matches what we last synced with,
                    // there are no remote changes to reconcile — just push.
                    const remoteChanged = !record || record.confluenceVersion < remotePage.version;

                    if (remoteChanged) {
                        // Remote was edited since our last sync — show both
                        // versions so the user can reconcile before pushing.
                        const remoteMarkdown = confluenceStorageToMarkdown(remotePage.body);

                        let commentsSection = "";
                        try {
                            const comments = await this.client.getPageComments(pageId);
                            if (comments.length > 0) {
                                commentsSection = formatCommentsAsMarkdown(comments, remotePage.body, remoteMarkdown);
                            }
                        } catch (e) {
                            console.warn(`[ConfluenceSync] Failed to fetch comments for force push reconcile:`, e);
                        }

                        const localRaw = await this.vault.read(file);
                        const markerIdx = localRaw.indexOf(COMMENTS_SECTION_MARKER);
                        const localContent = (markerIdx !== -1
                            ? localRaw.substring(0, markerIdx)
                            : localRaw
                        ).trimEnd();
                        const remoteContent = remoteMarkdown.trimEnd();

                        const finalContent = [
                            "<<<<<<< LOCAL",
                            localContent,
                            "=======",
                            remoteContent,
                            ">>>>>>> CONFLUENCE",
                            commentsSection,
                        ].join("\n");
                        await this.vault.modify(file, finalContent);

                        // Store the remote version so the next force push
                        // knows we've already shown this diff to the user.
                        this.state.set(file.path, {
                            confluencePageId: remotePage.id,
                            confluenceTitle: remotePage.title,
                            confluenceVersion: remotePage.version,
                            confluenceParentId: remotePage.parentId,
                            lastSyncedAt: new Date().toISOString(),
                            contentHash: record?.contentHash ?? "",
                        });

                        result.conflicts.push(file.path);
                        console.log(`[ConfluenceSync] Force push "${file.path}": remote v${remotePage.version} > synced v${record?.confluenceVersion} — conflict markers inserted, push aborted`);
                        await this.state.save();
                        return result;
                    }
                    console.log(`[ConfluenceSync] Force push "${file.path}": remote v${remotePage.version} matches synced version — proceeding with push`);
                }

                // Content matches (or no remote page yet) — proceed with force push
                const pushed = await this.pushFile(file, result, true);
                if (pushed) result.pushed.push(file.path);
            } else {
                const pushed = await this.pushFile(file, result, false);
                if (pushed) result.pushed.push(file.path);
            }
        } catch (e) {
            console.error(`[ConfluenceSync] Force push error:`, e);
            result.errors.push({ path: file.path, error: String(e) });
        }
        await this.state.save();
        return result;
    }

    /**
     * Pull a single file from Confluence with reconciliation.
     * - If local and remote content are identical, just refresh comments + state.
     * - If they differ, insert git-style conflict markers so the user can
     *   review both versions and manually resolve.
     * - Comments are always appended (they're read-only / stripped on push).
     */
    async pullFileDirect(file: TFile): Promise<SyncResult> {
        this._foundFolderCache.clear();
        const result: SyncResult = { pushed: [], pulled: [], deleted: [], conflicts: [], errors: [] };

        try {
            const record = this.state.get(file.path);
            let pageId: string | undefined;

            if (record) {
                pageId = record.confluencePageId;
            } else {
                // No sync record — try to find by title
                const title = file.basename;
                const existing = await this.client.getPageByTitle(title);
                if (existing) {
                    pageId = existing.id;
                }
            }

            if (!pageId) {
                result.errors.push({ path: file.path, error: "No Confluence page found for this file" });
                await this.state.save();
                return result;
            }

            const remotePage = await this.client.getPage(pageId);
            const remoteMarkdown = confluenceStorageToMarkdown(remotePage.body);

            // Fetch comments
            let commentsSection = "";
            try {
                const comments = await this.client.getPageComments(pageId);
                if (comments.length > 0) {
                    commentsSection = formatCommentsAsMarkdown(comments, remotePage.body, remoteMarkdown);
                }
            } catch (e) {
                console.warn(`[ConfluenceSync] Failed to fetch comments for pull:`, e);
            }

            // Read local content, stripping the comments section
            const localRaw = await this.vault.read(file);
            const markerIdx = localRaw.indexOf(COMMENTS_SECTION_MARKER);
            const localContent = (markerIdx !== -1
                ? localRaw.substring(0, markerIdx)
                : localRaw
            ).trimEnd();

            // Check if remote changed since our last sync (version-based).
            // Content comparison is unreliable due to Confluence HTML normalization.
            const remoteChanged = !record || record.confluenceVersion < remotePage.version;

            let finalContent: string;

            if (!remoteChanged) {
                // Remote hasn't changed — just refresh comments
                finalContent = localContent + commentsSection;
                console.log(`[ConfluenceSync] Force pull "${file.path}": remote v${remotePage.version} matches synced version, refreshing comments`);
            } else {
                // Remote was edited — insert conflict markers for the user to resolve
                const remoteContent = remoteMarkdown.trimEnd();
                finalContent = [
                    "<<<<<<< LOCAL",
                    localContent,
                    "=======",
                    remoteContent,
                    ">>>>>>> CONFLUENCE",
                    commentsSection,
                ].join("\n");
                result.conflicts.push(file.path);
                console.log(`[ConfluenceSync] Force pull "${file.path}": remote v${remotePage.version} > synced v${record?.confluenceVersion} — conflict markers inserted`);
            }

            await this.vault.modify(file, finalContent);

            // Update state to reflect the remote version we fetched. The user
            // still needs to resolve conflicts and push, but recording the
            // version prevents the next auto-sync from re-pulling the same diff.
            const roundTripStorage = markdownToConfluenceStorage(finalContent);
            const stableHash = SyncStateManager.hash(roundTripStorage);

            this.state.set(file.path, {
                confluencePageId: remotePage.id,
                confluenceTitle: remotePage.title,
                confluenceVersion: remotePage.version,
                confluenceParentId: remotePage.parentId,
                lastSyncedAt: new Date().toISOString(),
                contentHash: stableHash,
            });

            result.pulled.push(file.path);
        } catch (e) {
            console.error(`[ConfluenceSync] Force pull error:`, e);
            result.errors.push({ path: file.path, error: String(e) });
        }

        await this.state.save();
        return result;
    }

    // ── Remote → Local ────────────────────────────────────────────────────

    private async pullPage(
        page: ConfluencePage,
        result: SyncResult,
        ancestorIds: string[] = [],
        ancestorTitles: string[] = []
    ): Promise<boolean> {
        // Skip folder/container pages — they represent directories, not content files.
        // Exception: if a sync record also points to this page ID, the folder page
        // doubles as a Waypoint content page (same-name folder); don't skip it.
        const allFolderPageIds = new Set(Object.values(this.state.allFolders()));
        if (allFolderPageIds.has(page.id) && !this.state.findByPageId(page.id)) {
            return false;
        }

        const remoteHash = SyncStateManager.hash(page.body);

        // Find existing local mapping
        const localPath = this.state.findByPageId(page.id);

        if (localPath) {
            const record = this.state.get(localPath)!;
            const file = this.vault.getAbstractFileByPath(localPath);

            // Check whether the page content has changed (version bump)
            const contentChanged = record.confluenceVersion < page.version;

            // Always refresh comments — new comments don't bump the page version
            let commentsSection = "";
            try {
                const comments = await this.client.getPageComments(page.id);
                if (comments.length > 0) {
                    const markdown = confluenceStorageToMarkdown(page.body);
                    commentsSection = formatCommentsAsMarkdown(comments, page.body, markdown);
                }
            } catch (e) {
                console.warn(`[ConfluenceSync] Failed to fetch comments for "${page.title}":`, e);
            }

            if (contentChanged) {
                // Content changed — check for conflicts before overwriting
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

                const markdown = confluenceStorageToMarkdown(page.body) + commentsSection;
                if (file instanceof TFile) {
                    await this.vault.modify(file, markdown);
                } else {
                    const targetPath = this.buildLocalPathFromAncestors(page.title, ancestorIds, ancestorTitles);
                    await this.ensureFolder(targetPath);
                    await this.vault.create(targetPath, markdown);
                }

                const roundTripStorage = markdownToConfluenceStorage(markdown);
                const stableHash = SyncStateManager.hash(roundTripStorage);

                this.state.set(localPath, {
                    ...record,
                    confluenceParentId: page.parentId,
                    confluenceVersion: page.version,
                    lastSyncedAt: new Date().toISOString(),
                    contentHash: stableHash,
                });
                return true;
            }

            // Content unchanged — refresh just the comments section if it differs
            if (commentsSection && file instanceof TFile) {
                const localContent = await this.vault.read(file);
                const markerIdx = localContent.indexOf(COMMENTS_SECTION_MARKER);
                const existingComments = markerIdx !== -1
                    ? localContent.substring(markerIdx - 1)  // include preceding newline
                    : "";
                const newComments = commentsSection;

                if (existingComments.trimEnd() !== newComments.trimEnd()) {
                    const contentWithoutComments = markerIdx !== -1
                        ? localContent.substring(0, markerIdx).trimEnd()
                        : localContent.trimEnd();
                    await this.vault.modify(file, contentWithoutComments + newComments);
                    return true;
                }
            }

            return false;
        }

        // Remote page has no local counterpart — skip. Local vault is the
        // master for file structure: new pages created in Confluence are not
        // auto-imported. Only content updates to already-tracked files are
        // pulled (handled above).
        console.log(`[ConfluenceSync] ⏭ No local file for remote page "${page.title}" (${page.id}) — skipping (local is structure master)`);
        return false;
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

    /**
     * Before the main sync loop, rename any Confluence pages whose stored title
     * no longer matches what titleFromFile() now computes. This ensures the title
     * space is clean before any creates run, regardless of processing order.
     */
    private async preRenameStalePages(files: TFile[]): Promise<void> {
        for (const file of files) {
            const record = this.state.get(file.path);
            if (!record) continue;
            const currentTitle = this.titleFromFile(file);
            if (currentTitle === record.confluenceTitle) continue;
            console.warn(
                `[ConfluenceSync] Pre-rename: "${file.path}" ` +
                `"${record.confluenceTitle}" → "${currentTitle}"`
            );
            try {
                const remotePage = await this.client.getPage(record.confluencePageId);
                const updated = await this.client.updatePage(
                    record.confluencePageId,
                    currentTitle,
                    remotePage.body,
                    remotePage.version,
                    remotePage.parentId
                );
                this.state.set(file.path, {
                    ...record,
                    confluenceTitle: updated.title,
                    confluenceVersion: updated.version,
                });
                console.warn(`[ConfluenceSync] Pre-rename done: "${currentTitle}"`);
            } catch (e) {
                console.error(`[ConfluenceSync] Pre-rename failed for "${file.path}":`, e);
            }
        }
    }

    private titleFromFile(file: TFile): string {
        if (this._ambiguousBasenames.has(file.basename)) {
            // Multiple files share this basename across different directories.
            // Waypoint files have the same name as their containing directory
            // (e.g. Learning/Learning.md — the folder's index page). They take
            // precedence and keep the plain basename as their Confluence title.
            // All other files sharing the basename are prefixed with their
            // parent directory, e.g. "Learning and Sharing - Learning".
            // Only the Confluence title is affected; local filenames are never changed.
            const parts = file.path.split("/");
            const parentDir = parts.length >= 2 ? parts[parts.length - 2] : "";
            const isWaypoint = parentDir === file.basename;
            const title = (parentDir && !isWaypoint) ? `${parentDir}/${file.basename}` : file.basename;
            console.log(`[ConfluenceSync] titleFromFile: "${file.path}" → "${title}" (ambiguous; parentDir="${parentDir}" isWaypoint=${isWaypoint})`);
            return title;
        }
        return file.basename;
    }

    /** Returns the set of basenames that appear in more than one directory. */
    private computeAmbiguousBasenames(files: TFile[]): Set<string> {
        const counts = new Map<string, number>();
        for (const f of files) {
            counts.set(f.basename, (counts.get(f.basename) ?? 0) + 1);
        }
        const ambiguous = new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
        if (ambiguous.size > 0) {
            console.log(`[ConfluenceSync] Ambiguous basenames (will be prefixed):`, [...ambiguous]);
        }
        return ambiguous;
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

            // Check if we already have a Confluence page for this folder.
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

            // Create the folder page with empty body.
            // If Confluence rejects the create because the parent no longer exists
            // (e.g. it was deleted), evict the stale ID from folderMap and the
            // transient cache and throw a typed error so pushFile can retry.
            let folderPage;
            try {
                folderPage = await this.client.createPage(
                    segment,
                    "<p></p>",
                    currentParentId
                );
            } catch (e: any) {
                if (this.isParentNotExistError(e)) {
                    // Evict every folderMap entry that points to the stale parent ID
                    // so the next attempt re-discovers / re-creates those pages.
                    this.evictStaleFolderEntries(currentParentId);
                    console.warn(
                        `[ConfluenceSync] Stale folder parent ID ${currentParentId} evicted — will retry`
                    );
                    throw new StaleFolderError(segment, currentParentId);
                }
                // Title collision — a page with this name already exists in
                // the space under a different parent. Confluence enforces
                // space-wide unique titles, so try to create a disambiguated
                // title using the parent page's title (e.g. "Parent/artifacts").
                // If that fails, fall back to linking the existing page.
                if (String(e).includes("already exists")) {
                    try {
                        // Attempt to fetch the parent page title to build a
                        // disambiguated folder title.
                        const parentPage = currentParentId ? await this.client.getPage(currentParentId).catch(() => null) : null;
                        const parentTitle = parentPage ? parentPage.title : null;
                        const disambigTitle = parentTitle ? `${parentTitle}/${segment}` : `${segment}`;

                        // Try creating the folder page with the disambiguated title.
                        const newFolder = await this.client.createPage(disambigTitle, "<p></p>", currentParentId);
                        this.state.setFolder(accumulatedPath, newFolder.id);
                        currentParentId = newFolder.id;
                        console.warn(
                            `[ConfluenceSync] Created disambiguated folder page "${disambigTitle}" (${newFolder.id}) for local dir ${accumulatedPath}`
                        );
                        continue;
                    } catch (e2: any) {
                        // If disambiguated create also fails, fall back to the
                        // existing page (if any) so we don't block the push.
                        const fallback = await this.client.getPageByTitle(segment);
                        if (fallback) {
                            console.warn(
                                `[ConfluenceSync] Folder page "${segment}" already exists; falling back to existing page ${fallback.id}`
                            );
                            const localDirExists = !!this.vault.getAbstractFileByPath(accumulatedPath);
                            if (localDirExists) {
                                this.state.setFolder(accumulatedPath, fallback.id);
                            } else {
                                this._foundFolderCache.set(accumulatedPath, fallback.id);
                            }
                            currentParentId = fallback.id;
                            continue;
                        }
                    }
                }
                throw e;
            }
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
     * Delete Confluence pages for any tracked files that no longer exist locally.
     * Also cleans up folder pages whose local directory has been removed.
     * Only called when direction is "both" or "push" (local vault is master).
     */
    private async deleteObsoletePages(
        localFiles: TFile[],
        result: SyncResult
    ): Promise<void> {
        const localPathSet = new Set(localFiles.map((f) => f.path));
        const allRecords = this.state.all();

        // ── 1. Delete pages for tracked files that no longer exist locally ──
        for (const [vaultPath, record] of Object.entries(allRecords)) {
            if (localPathSet.has(vaultPath)) continue;
            if (this.isExcluded(vaultPath)) continue;

            console.log(
                `[ConfluenceSync] Deleting obsolete Confluence page "${record.confluenceTitle}" ` +
                `(${record.confluencePageId}) — local file removed: ${vaultPath}`
            );
            try {
                await this.client.deletePage(record.confluencePageId);
                result.deleted.push(vaultPath);
            } catch (e: any) {
                // 404 means it's already gone — that's fine, clean up state anyway
                if (!String(e).includes("404") && !String(e).includes("not found")) {
                    console.error(`[ConfluenceSync] Failed to delete page ${record.confluencePageId}:`, e);
                    result.errors.push({ path: vaultPath, error: String(e) });
                    continue;
                }
                console.log(`[ConfluenceSync] Page ${record.confluencePageId} already deleted in Confluence`);
            }
            this.state.delete(vaultPath);
        }

        // ── 2. Delete folder pages whose local directory no longer exists ──
        // Deletion of a parent folder page in Confluence cascades children, so we
        // process most-specific (deepest) paths first to avoid double-delete errors.
        const allFolders = this.state.allFolders();
        const folderPaths = Object.keys(allFolders).sort((a, b) => b.length - a.length);

        for (const dirPath of folderPaths) {
            const localDir = this.vault.getAbstractFileByPath(dirPath);
            if (localDir) continue; // directory still exists

            const folderId = allFolders[dirPath];
            console.log(
                `[ConfluenceSync] Deleting obsolete Confluence folder page (${folderId}) ` +
                `— local directory removed: ${dirPath}`
            );
            try {
                await this.client.deletePage(folderId);
            } catch (e: any) {
                if (!String(e).includes("404") && !String(e).includes("not found")) {
                    console.error(`[ConfluenceSync] Failed to delete folder page ${folderId}:`, e);
                    result.errors.push({ path: dirPath, error: String(e) });
                }
                // Either deleted successfully or already gone — remove from state
            }
            this.state.deleteFolder(dirPath);
        }
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

    /** Returns true if the error message indicates a missing/inaccessible parent page. */
    private isParentNotExistError(e: unknown): boolean {
        const msg = String(e).toLowerCase();
        return (
            msg.includes("does not exist") ||
            msg.includes("parent id") ||
            msg.includes("parentid") ||
            msg.includes("parent page") ||
            // Confluence REST API returns 400 with this message
            msg.includes("the parent id specified does not exist")
        );
    }

    /**
     * Evict all folderMap entries whose stored Confluence page ID matches
     * `staleId`, plus any transient cache entries.  Called when Confluence
     * signals that a parent page no longer exists so that the next resolve
     * attempt re-discovers or re-creates the folder page fresh.
     */
    private evictStaleFolderEntries(staleId: string | undefined): void {
        if (!staleId) return;
        for (const [dirPath, pageId] of Object.entries(this.state.allFolders())) {
            if (pageId === staleId) {
                this.state.deleteFolder(dirPath);
                console.warn(`[ConfluenceSync] Evicted stale folderMap entry: ${dirPath} → ${pageId}`);
            }
        }
        for (const [dirPath, pageId] of this._foundFolderCache.entries()) {
            if (pageId === staleId) {
                this._foundFolderCache.delete(dirPath);
            }
        }
    }

    /** Returns true if the given vault-relative path is excluded from sync. */
    private isExcluded(path: string): boolean {
        const excluded: string[] = (this.settings as any).excludedPaths ?? [];
        return excluded.some(
            (ex: string) => path === ex || path.startsWith(ex + "/")
        );
    }

    /**
     * Upload all images embedded in `markdown` as attachments on `pageId`.
     * Silently skips images that cannot be found in the vault.
     */
    private async uploadPageImages(pageId: string, markdown: string, sourceFile: TFile): Promise<void> {
        const imageFilenames = extractEmbeddedImages(markdown);
        if (imageFilenames.length === 0) return;

        for (const filename of imageFilenames) {
            // Search the vault for the image file by name
            const imageFile = this.vault.getFiles().find(
                (f) => f.name === filename || f.path === filename
            );
            if (!imageFile) {
                console.warn(`[ConfluenceSync] Image not found in vault: ${filename}`);
                continue;
            }

            try {
                const data = await this.vault.readBinary(imageFile);
                const ext = imageFile.extension.toLowerCase();
                const mimeTypes: Record<string, string> = {
                    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
                    gif: "image/gif", svg: "image/svg+xml", webp: "image/webp",
                    bmp: "image/bmp", ico: "image/x-icon",
                };
                const mimeType = mimeTypes[ext] ?? "application/octet-stream";
                await this.client.uploadAttachment(pageId, imageFile.name, data, mimeType);
                console.log(`[ConfluenceSync] Uploaded attachment: ${imageFile.name} → page ${pageId}`);
            } catch (e) {
                console.error(`[ConfluenceSync] Failed to upload attachment ${filename}:`, e);
            }
        }
    }
}
