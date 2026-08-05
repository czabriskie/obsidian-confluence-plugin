/**
 * Persists the mapping between Obsidian file paths and Confluence page IDs.
 * Stored as a JSON file inside the plugin data directory.
 */

import { Plugin } from "obsidian";

export interface SyncRecord {
    confluencePageId: string;
    confluenceTitle: string;
    confluenceVersion: number;
    /** The Confluence parent page ID at last sync */
    confluenceParentId?: string;
    /** ISO timestamp of last sync */
    lastSyncedAt: string;
    /** SHA-1-style hash of the content to detect changes */
    contentHash: string;
}

export type SyncMap = Record<string, SyncRecord>; // key = vault-relative file path

/** Maps vault-relative directory paths to their Confluence folder page ID. */
export type FolderMap = Record<string, string>;

const SYNC_MAP_KEY = "syncMap";
const FOLDER_MAP_KEY = "folderMap";
const BACKUP_KEY = "syncMapBackup";

export class SyncStateManager {
    private plugin: Plugin;
    private map: SyncMap = {};
    private folders: FolderMap = {};

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    async load(): Promise<void> {
        const data = await this.plugin.loadData();
        this.map = (data?.[SYNC_MAP_KEY] as SyncMap) ?? {};
        this.folders = (data?.[FOLDER_MAP_KEY] as FolderMap) ?? {};
    }

    async save(): Promise<void> {
        const data = (await this.plugin.loadData()) ?? {};
        data[SYNC_MAP_KEY] = this.map;
        data[FOLDER_MAP_KEY] = this.folders;
        await this.plugin.saveData(data);
    }

    get(filePath: string): SyncRecord | undefined {
        return this.map[filePath];
    }

    set(filePath: string, record: SyncRecord): void {
        this.map[filePath] = record;
    }

    delete(filePath: string): void {
        delete this.map[filePath];
    }

    /** Find the local file path mapped to a Confluence page ID. */
    findByPageId(pageId: string): string | undefined {
        return Object.keys(this.map).find(
            (p) => this.map[p].confluencePageId === pageId
        );
    }

    all(): SyncMap {
        return { ...this.map };
    }

    /**
     * Clears the sync map and folder map, but first stashes the previous
     * state under a backup key in plugin data so it can be restored via
     * `restoreLastBackup()` if the reset was accidental.
     */
    async clearAll(): Promise<void> {
        const data = (await this.plugin.loadData()) ?? {};
        data[BACKUP_KEY] = {
            [SYNC_MAP_KEY]: this.map,
            [FOLDER_MAP_KEY]: this.folders,
            clearedAt: new Date().toISOString(),
        };
        this.map = {};
        this.folders = {};
        data[SYNC_MAP_KEY] = this.map;
        data[FOLDER_MAP_KEY] = this.folders;
        await this.plugin.saveData(data);
    }

    /** Returns the timestamp of the last `clearAll()` backup, if one exists. */
    async getLastBackupTimestamp(): Promise<string | undefined> {
        const data = await this.plugin.loadData();
        return data?.[BACKUP_KEY]?.clearedAt;
    }

    /**
     * Restores the sync map and folder map from the most recent `clearAll()`
     * backup, overwriting whatever is currently in state. Returns false if no
     * backup is available.
     */
    async restoreLastBackup(): Promise<boolean> {
        const data = (await this.plugin.loadData()) ?? {};
        const backup = data[BACKUP_KEY];
        if (!backup) return false;
        this.map = backup[SYNC_MAP_KEY] ?? {};
        this.folders = backup[FOLDER_MAP_KEY] ?? {};
        await this.save();
        return true;
    }

    getFolder(dirPath: string): string | undefined {
        return this.folders[dirPath];
    }

    setFolder(dirPath: string, pageId: string): void {
        this.folders[dirPath] = pageId;
    }

    deleteFolder(dirPath: string): void {
        delete this.folders[dirPath];
    }

    allFolders(): FolderMap {
        return { ...this.folders };
    }

    /** Simple hash of a string (djb2). Good enough for change detection. */
    static hash(content: string): string {
        let hash = 5381;
        for (let i = 0; i < content.length; i++) {
            hash = (hash * 33) ^ content.charCodeAt(i);
        }
        return (hash >>> 0).toString(16);
    }
}
