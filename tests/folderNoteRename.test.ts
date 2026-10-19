import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({
    TFile: class {},
    TFolder: class {},
    Vault: class {},
    Notice: class {},
    normalizePath: (p: string) => {
        const n = p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
        return n === "" ? "/" : n;
    },
    requestUrl: vi.fn(),
}));

import { SyncEngine } from "../src/syncEngine";
import { SyncStateManager } from "../src/syncStateManager";

const SELF = "7906951173";

class FakePlugin {
    private data: any = {};
    async loadData() { return this.data; }
    async saveData(d: any) { this.data = d; }
}

async function setup(opts: { root: string; oldPath: string; newPath: string; existingTitleLookup?: boolean }) {
    const state = new SyncStateManager(new FakePlugin() as any);
    await state.load();
    state.set(opts.oldPath, {
        confluencePageId: SELF,
        confluenceTitle: "BI MASV Demo",
        confluenceVersion: 5,
        confluenceParentId: "100",
    } as any);
    state.setFolder(opts.oldPath.replace(/\/[^/]+$/, ""), SELF);

    const updatePage = vi.fn(async (id: string, title: string, body: string, version: number, parentId?: string) => {
        if (parentId === id) throw new Error("Confluence API error 400: Can not set page as its own parent.");
        return { id, title, version: version + 1, parentId, body };
    });
    const client: any = {
        getPage: vi.fn(async (id: string) => ({ id, title: "BI MASV Demo", version: 5, parentId: "100", body: "<p/>" })),
        // Confluence already holds the page under the destination folder
        getPageByTitle: vi.fn(async () => (opts.existingTitleLookup ? { id: SELF, title: "BI MASV Demo" } : null)),
        createPage: vi.fn(async (title: string) => ({ id: "900", title })),
        updatePage,
    };
    const dirOf = (p: string) => p.replace(/\/[^/]+$/, "");
    const vault: any = {
        adapter: {},
        getAbstractFileByPath: vi.fn(() => null),
        getFiles: vi.fn(() => []),
        getMarkdownFiles: vi.fn(() => []),
    };
    const settings: any = { vaultDirectory: opts.root, confluenceParentPageId: "100" };
    const engine: any = new SyncEngine(vault, client, state, settings);
    const file: any = {
        path: opts.newPath,
        basename: "BI MASV Demo",
        parent: { path: dirOf(opts.newPath) },
    };
    return { engine, client, state, file };
}

describe("folder note rename", () => {
    it("never sets the page as its own parent when Confluence lookup returns itself", async () => {
        const { engine, client, file } = await setup({
            root: "/",
            oldPath: "1 Projects/Projects/BI MASV Demo/BI MASV Demo.md",
            newPath: "1 Projects/Archived/BI MASV Demo/BI MASV Demo.md",
            existingTitleLookup: true,
        });
        await engine.handleLocalRename(file, "1 Projects/Projects/BI MASV Demo/BI MASV Demo.md");
        for (const call of client.updatePage.mock.calls) expect(call[4]).not.toBe(SELF);
    });

    it("skips folder page creation for the folder note's own folder and maps it to the note", async () => {
        const { engine, client, state, file } = await setup({
            root: "/",
            oldPath: "Projects/BI MASV Demo/BI MASV Demo.md",
            newPath: "Archives/BI MASV Demo/BI MASV Demo.md",
        });
        await engine.handleLocalRename(file, "Projects/BI MASV Demo/BI MASV Demo.md");
        expect(client.createPage).toHaveBeenCalledTimes(1); // only "Archives"
        expect(client.createPage.mock.calls[0][0]).toBe("Archives");
        expect(state.getFolder("Archives/BI MASV Demo")).toBe(SELF);
    });

    it("leaves the parent unchanged for a destination outside the sync root", async () => {
        const { engine, client, file } = await setup({
            root: "1 Projects",
            oldPath: "1 Projects/BI MASV Demo/BI MASV Demo.md",
            newPath: "4 Archives/BI MASV Demo/BI MASV Demo.md",
        });
        await engine.handleLocalRename(file, "1 Projects/BI MASV Demo/BI MASV Demo.md");
        expect(client.createPage).not.toHaveBeenCalled();
        expect(client.updatePage).not.toHaveBeenCalled();
    });

    it("does not log the failure itself (main.ts logs once)", async () => {
        const { engine, client, file } = await setup({
            root: "/",
            oldPath: "A/BI MASV Demo/BI MASV Demo.md",
            newPath: "B/BI MASV Demo/BI MASV Demo.md",
        });
        client.updatePage.mockRejectedValue(new Error("boom"));
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(engine.handleLocalRename(file, "A/BI MASV Demo/BI MASV Demo.md")).rejects.toThrow("boom");
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});
