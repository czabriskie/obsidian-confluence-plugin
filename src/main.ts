import {
    App,
    Modal,
    Notice,
    Plugin,
    TFile,
    TFolder,
    TAbstractFile,
    addIcon,
} from "obsidian";

import {
    ConfluenceSyncSettings,
    ConfluenceSyncSettingTab,
    DEFAULT_SETTINGS,
} from "./settings";
import { ConfluenceClient } from "./confluenceClient";
import { SyncStateManager } from "./syncStateManager";
import { SyncEngine, SyncResult } from "./syncEngine";

// Ribbon icon (Confluence-style "C" logo as a simple SVG)
const CONFLUENCE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="currentColor" d="M2.3 16.9c-.3.5-.1 1.1.4 1.4l4.4 2.5c.5.3 1.1.1 1.4-.4.9-1.5 2.4-2.4 4.1-2.4s3.2.9 4.1 2.4c.3.5.9.7 1.4.4l4.4-2.5c.5-.3.7-.9.4-1.4C20.4 13.6 16.5 11 12 11s-8.4 2.6-9.7 5.9zM21.7 7.1c.3-.5.1-1.1-.4-1.4l-4.4-2.5c-.5-.3-1.1-.1-1.4.4C14.6 5 13.1 6 11.4 6s-3.2-.9-4.1-2.4C7 3 6.4 2.8 5.9 3.1L1.5 5.6c-.5.3-.7.9-.4 1.4C3.4 10.3 7.3 13 11.8 13s8.4-2.7 9.9-5.9z"/>
</svg>`;

export default class ConfluenceSyncPlugin extends Plugin {
    settings!: ConfluenceSyncSettings;
    private client: ConfluenceClient | null = null;
    private stateManager!: SyncStateManager;
    private autoSyncTimer: ReturnType<typeof setInterval> | null = null;

    async onload() {
        await this.loadSettings();

        this.stateManager = new SyncStateManager(this);
        await this.stateManager.load();

        addIcon("confluence", CONFLUENCE_ICON);

        // Ribbon button
        this.addRibbonIcon("confluence", "Sync with Confluence", async () => {
            await this.runSync();
        });

        // Commands
        this.addCommand({
            id: "confluence-sync-all",
            name: "Sync all (push & pull)",
            callback: async () => {
                await this.runSync("both");
            },
        });

        this.addCommand({
            id: "confluence-push",
            name: "Push to Confluence",
            callback: async () => {
                await this.runSync("push");
            },
        });

        this.addCommand({
            id: "confluence-pull",
            name: "Pull from Confluence",
            callback: async () => {
                await this.runSync("pull");
            },
        });

        this.addCommand({
            id: "confluence-push-current",
            name: "Push current file to Confluence",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") return false;
                if (!checking) {
                    this.pushCurrentFile(file);
                }
                return true;
            },
        });

        this.addCommand({
            id: "confluence-force-push-current",
            name: "Force push current file to Confluence (ignore cached hash)",
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension !== "md") return false;
                if (!checking) {
                    this.pushCurrentFile(file, true);
                }
                return true;
            },
        });

        this.addCommand({
            id: "confluence-reset-sync-state",
            name: "Reset sync state (re-sync everything on next run)",
            callback: async () => {
                await this.stateManager.clearAll();
                new Notice("🗑️ Confluence Sync: Sync state cleared. Next sync will treat all files as new.");
            },
        });

        this.addCommand({
            id: "confluence-delete-unmanaged-files",
            name: "Delete unmanaged local files (remove bad-pull leftovers)",
            callback: async () => {
                const client = this.getClient();
                if (!client) {
                    new Notice("⚠️ Confluence Sync: Plugin not configured.");
                    return;
                }
                const engine = new SyncEngine(
                    this.app.vault,
                    client,
                    this.stateManager,
                    this.settings
                );
                const deleted = await engine.deleteUnmanagedLocalFiles();
                if (deleted.length === 0) {
                    new Notice("✅ Confluence Sync: No unmanaged local files found.");
                } else {
                    new Notice(`🗑️ Confluence Sync: Deleted ${deleted.length} unmanaged file(s). Check console for details.`);
                    console.log("[ConfluenceSync] Deleted unmanaged files:", deleted);
                }
            },
        });

        // Settings tab
        this.addSettingTab(new ConfluenceSyncSettingTab(this.app, this));

        // File-explorer context menu: toggle exclusion
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, abstractFile) => {
                // Resolve the sync root to a vault-relative path
                // (vaultDirectory may be stored as an absolute path)
                let syncRoot = this.settings.vaultDirectory;
                const basePath = (this.app.vault.adapter as any).basePath as string | undefined;
                if (basePath && syncRoot.startsWith(basePath)) {
                    syncRoot = syncRoot.slice(basePath.length).replace(/^\//, "");
                }

                // Only show for files/folders inside the sync directory
                if (!abstractFile.path.startsWith(syncRoot)) return;

                const isExcluded = this.isExcluded(abstractFile.path);
                const label = isExcluded
                    ? `☑ Resume Confluence sync`
                    : `⊘ Exclude from Confluence sync`;

                menu.addItem((item) =>
                    item
                        .setTitle(label)
                        .setIcon(isExcluded ? "check-circle" : "x-circle")
                        .onClick(async () => {
                            await this.toggleExclusion(abstractFile.path);
                        })
                );
            })
        );

        // Auto-sync
        this.resetAutoSync();
    }

    onunload() {
        this.clearAutoSync();
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            await this.loadData()
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.buildClient();
    }

    /** Returns true if the given vault-relative path is excluded from sync. */
    isExcluded(path: string): boolean {
        return this.settings.excludedPaths.some(
            (ex) => path === ex || path.startsWith(ex + "/")
        );
    }

    /** Toggle a path in/out of the exclusion list and persist. */
    async toggleExclusion(path: string): Promise<void> {
        const excluded = this.settings.excludedPaths;
        if (this.isExcluded(path)) {
            // Remove exact entry (child paths excluded by a parent are removed too)
            this.settings.excludedPaths = excluded.filter(
                (ex) => ex !== path && !path.startsWith(ex + "/")
            );
            new Notice(`✅ "${path}" will now sync with Confluence`);
        } else {
            // Remove any children that are now covered by this parent
            this.settings.excludedPaths = [
                ...excluded.filter((ex) => !ex.startsWith(path + "/")),
                path,
            ];
            new Notice(`🚫 "${path}" excluded from Confluence sync`);
        }
        await this.saveSettings();
    }

    resetAutoSync() {
        this.clearAutoSync();
        const mins = this.settings.autoSyncIntervalMinutes;
        if (mins > 0) {
            this.autoSyncTimer = setInterval(
                () => this.runSync(),
                mins * 60 * 1000
            );
        }
    }

    private clearAutoSync() {
        if (this.autoSyncTimer !== null) {
            clearInterval(this.autoSyncTimer);
            this.autoSyncTimer = null;
        }
    }

    private buildClient(): ConfluenceClient | null {
        const s = this.settings;
        if (!s.confluenceBaseUrl || !s.confluenceEmail || !s.confluenceApiToken || !s.confluenceSpaceKey) {
            this.client = null;
            return null;
        }
        this.client = new ConfluenceClient({
            baseUrl: s.confluenceBaseUrl,
            email: s.confluenceEmail,
            apiToken: s.confluenceApiToken,
            spaceKey: s.confluenceSpaceKey,
        });
        return this.client;
    }

    private getClient(): ConfluenceClient | null {
        return this.client ?? this.buildClient();
    }

    async testConnection(): Promise<void> {
        const client = this.getClient();
        if (!client) {
            new Notice("⚠️ Confluence Sync: Please fill in all connection settings first.");
            return;
        }
        try {
            const space = await client.getSpace();
            new Notice(`✅ Connected to Confluence space: ${space.name} (${space.key})`);
        } catch (e) {
            new Notice(`❌ Connection failed: ${e}`);
        }
    }

    async runSync(
        direction?: "both" | "push" | "pull"
    ): Promise<void> {
        const client = this.getClient();
        if (!client) {
            new Notice(
                "⚠️ Confluence Sync: Configure your Confluence settings first."
            );
            return;
        }

        const overrideSettings = direction
            ? { ...this.settings, syncDirection: direction }
            : this.settings;

        const engine = new SyncEngine(
            this.app.vault,
            client,
            this.stateManager,
            overrideSettings
        );

        new Notice("🔄 Confluence Sync: Starting…");

        let result: SyncResult;
        try {
            result = await engine.sync();
        } catch (e) {
            new Notice(`❌ Confluence Sync failed: ${e}`);
            return;
        }

        const parts: string[] = [];
        if (result.pushed.length) parts.push(`↑ ${result.pushed.length} pushed`);
        if (result.pulled.length) parts.push(`↓ ${result.pulled.length} pulled`);
        if (result.deleted.length) parts.push(`🗑️ ${result.deleted.length} deleted`);
        if (result.conflicts.length)
            parts.push(`⚡ ${result.conflicts.length} conflicts`);
        if (result.errors.length)
            parts.push(`❌ ${result.errors.length} errors`);

        if (result.errors.length) {
            console.error("[ConfluenceSync] Errors:", result.errors);
            // Show first error directly in the notice for quick diagnosis
            new Notice(`❌ Confluence Sync error: ${result.errors[0].error}`, 10000);
            new SyncErrorModal(this.app, result).open();
        } else if (parts.length === 0) {
            new Notice("✅ Confluence Sync: Everything up to date. Check the vault directory contains .md files.");
        } else {
            new Notice(`✅ Confluence Sync: ${parts.join(", ")}`);
        }
    }

    private async pushCurrentFile(file: TFile, force = false): Promise<void> {
        const client = this.getClient();
        if (!client) {
            new Notice("⚠️ Confluence Sync: Configure your Confluence settings first.");
            return;
        }

        const engine = new SyncEngine(
            this.app.vault,
            client,
            this.stateManager,
            this.settings
        );

        new Notice(`🔄 ${force ? "Force pushing" : "Pushing"} ${file.basename}…`);
        try {
            const result = await engine.pushFileDirect(file, force);
            if (result.errors.length) {
                new Notice(`❌ Push failed: ${result.errors[0].error}`);
            } else if (result.pushed.length === 0) {
                new Notice(`⏭️ ${file.basename} is already up to date`);
            } else {
                new Notice(`✅ Pushed ${file.basename} to Confluence`);
            }
        } catch (e) {
            new Notice(`❌ Push failed: ${e}`);
        }
    }
}

// ── Error detail modal ─────────────────────────────────────────────────────

class SyncErrorModal extends Modal {
    private result: SyncResult;

    constructor(app: App, result: SyncResult) {
        super(app);
        this.result = result;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Confluence Sync Errors" });

        for (const err of this.result.errors) {
            const div = contentEl.createDiv({ cls: "confluence-sync-error" });
            div.createEl("strong", { text: err.path });
            div.createEl("p", { text: err.error });
        }

        if (this.result.conflicts.length) {
            contentEl.createEl("h3", { text: "Conflicts (resolved by strategy)" });
            const ul = contentEl.createEl("ul");
            for (const c of this.result.conflicts) {
                ul.createEl("li", { text: c });
            }
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
