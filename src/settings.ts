import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import ConfluenceSyncPlugin from "./main";

export interface ConfluenceSyncSettings {
    /** Confluence base URL, e.g. https://myorg.atlassian.net/wiki */
    confluenceBaseUrl: string;
    /** Atlassian account email */
    confluenceEmail: string;
    /** Atlassian API token */
    confluenceApiToken: string;
    /** Confluence space key, e.g. ENG */
    confluenceSpaceKey: string;
    /** Optional: ID of the Confluence page that acts as the parent for all synced pages */
    confluenceParentPageId: string;
    /** Vault-relative path to the directory to sync, e.g. Confluence */
    vaultDirectory: string;
    /** How to resolve conflicts */
    conflictStrategy: "local" | "remote" | "newer";
    /** Which direction to sync */
    syncDirection: "both" | "push" | "pull";
    /** Auto-sync interval in minutes (0 = disabled) */
    autoSyncIntervalMinutes: number;
    /** Vault-relative paths (files or folders) excluded from sync */
    excludedPaths: string[];
}

export const DEFAULT_SETTINGS: ConfluenceSyncSettings = {
    confluenceBaseUrl: "",
    confluenceEmail: "",
    confluenceApiToken: "",
    confluenceSpaceKey: "",
    confluenceParentPageId: "",
    vaultDirectory: "Confluence",
    conflictStrategy: "newer",
    syncDirection: "both",
    autoSyncIntervalMinutes: 0,
    excludedPaths: [],
};

export class ConfluenceSyncSettingTab extends PluginSettingTab {
    plugin: ConfluenceSyncPlugin;

    constructor(app: App, plugin: ConfluenceSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "Confluence Sync Settings" });

        // ── Connection ─────────────────────────────────────────────────────
        containerEl.createEl("h3", { text: "Confluence Connection" });

        new Setting(containerEl)
            .setName("Confluence Base URL")
            .setDesc(
                "Your Confluence site URL, e.g. https://myorg.atlassian.net/wiki"
            )
            .addText((text) =>
                text
                    .setPlaceholder("https://myorg.atlassian.net/wiki")
                    .setValue(this.plugin.settings.confluenceBaseUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.confluenceBaseUrl = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Atlassian Email")
            .setDesc("The email address associated with your Atlassian account")
            .addText((text) =>
                text
                    .setPlaceholder("you@example.com")
                    .setValue(this.plugin.settings.confluenceEmail)
                    .onChange(async (value) => {
                        this.plugin.settings.confluenceEmail = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("API Token")
            .setDesc(
                "Create an API token at https://id.atlassian.com/manage/api-tokens"
            )
            .addText((text) => {
                text
                    .setPlaceholder("Your API token")
                    .setValue(this.plugin.settings.confluenceApiToken)
                    .onChange(async (value) => {
                        this.plugin.settings.confluenceApiToken = value.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = "password";
            });

        new Setting(containerEl)
            .setName("Space Key")
            .setDesc('The Confluence space key, e.g. "ENG" or "TEAM"')
            .addText((text) =>
                text
                    .setPlaceholder("ENG")
                    .setValue(this.plugin.settings.confluenceSpaceKey)
                    .onChange(async (value) => {
                        this.plugin.settings.confluenceSpaceKey = value
                            .trim()
                            .toUpperCase();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Parent Page ID (optional)")
            .setDesc(
                "ID of the Confluence page to nest all synced pages under. Leave blank to place at space root."
            )
            .addText((text) =>
                text
                    .setPlaceholder("123456")
                    .setValue(this.plugin.settings.confluenceParentPageId)
                    .onChange(async (value) => {
                        this.plugin.settings.confluenceParentPageId =
                            value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Test Connection")
            .setDesc("Verify that the credentials above are correct")
            .addButton((btn) =>
                btn
                    .setButtonText("Test")
                    .setCta()
                    .onClick(async () => {
                        await this.plugin.testConnection();
                    })
            );

        // ── Sync Options ───────────────────────────────────────────────────
        containerEl.createEl("h3", { text: "Sync Options" });

        new Setting(containerEl)
            .setName("Vault Directory")
            .setDesc(
                "Path inside your vault to sync (relative to vault root), e.g. Confluence"
            )
            .addText((text) =>
                text
                    .setPlaceholder("Confluence")
                    .setValue(this.plugin.settings.vaultDirectory)
                    .onChange(async (value) => {
                        this.plugin.settings.vaultDirectory = value.trim();
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Sync Direction")
            .setDesc("Which direction changes are propagated")
            .addDropdown((dd) =>
                dd
                    .addOption("both", "Both ways")
                    .addOption("push", "Obsidian → Confluence only")
                    .addOption("pull", "Confluence → Obsidian only")
                    .setValue(this.plugin.settings.syncDirection)
                    .onChange(async (value) => {
                        this.plugin.settings.syncDirection = value as
                            | "both"
                            | "push"
                            | "pull";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Conflict Strategy")
            .setDesc("What to do when both local and remote have changed")
            .addDropdown((dd) =>
                dd
                    .addOption("newer", "Keep newer version")
                    .addOption("local", "Always keep local (Obsidian)")
                    .addOption("remote", "Always keep remote (Confluence)")
                    .setValue(this.plugin.settings.conflictStrategy)
                    .onChange(async (value) => {
                        this.plugin.settings.conflictStrategy = value as
                            | "local"
                            | "remote"
                            | "newer";
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Auto-Sync Interval (minutes)")
            .setDesc(
                "How often to automatically sync. Set to 0 to disable auto-sync."
            )
            .addText((text) =>
                text
                    .setPlaceholder("0")
                    .setValue(
                        String(this.plugin.settings.autoSyncIntervalMinutes)
                    )
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num >= 0) {
                            this.plugin.settings.autoSyncIntervalMinutes = num;
                            await this.plugin.saveSettings();
                            this.plugin.resetAutoSync();
                        }
                    })
            );

        // ── Exclusions ─────────────────────────────────────────────────────
        containerEl.createEl("h3", { text: "Exclusions" });
        containerEl.createEl("p", {
            text: "Right-click any file or folder in the file explorer to toggle Confluence sync on/off. Excluded paths are listed below.",
            cls: "setting-item-description",
        });

        const excluded = this.plugin.settings.excludedPaths;
        if (excluded.length === 0) {
            containerEl.createEl("p", {
                text: "No exclusions — all files in the sync directory are synced.",
                cls: "setting-item-description",
            });
        } else {
            const list = containerEl.createEl("ul");
            for (const p of [...excluded].sort()) {
                const li = list.createEl("li");
                li.createSpan({ text: p });
                const btn = li.createEl("button", { text: "Remove" });
                btn.style.marginLeft = "8px";
                btn.addEventListener("click", async () => {
                    this.plugin.settings.excludedPaths =
                        this.plugin.settings.excludedPaths.filter((x) => x !== p);
                    await this.plugin.saveSettings();
                    this.display();
                });
            }
        }
    }
}
