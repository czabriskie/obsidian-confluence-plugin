import { describe, it, expect, beforeEach } from "vitest";
import { SyncStateManager, SyncRecord } from "../src/syncStateManager";

// ─── Minimal mock of the Obsidian Plugin class ──────────────────────────────

class FakePlugin {
    private data: Record<string, unknown> = {};

    async loadData(): Promise<Record<string, unknown> | null> {
        return this.data;
    }

    async saveData(data: Record<string, unknown>): Promise<void> {
        this.data = data;
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SyncStateManager", () => {
    let manager: SyncStateManager;

    beforeEach(async () => {
        const fakePlugin = new FakePlugin();
        // Cast to avoid needing the full Plugin type
        manager = new SyncStateManager(fakePlugin as any);
        await manager.load();
    });

    // ── SyncRecord CRUD ──────────────────────────────────────────────────

    it("returns undefined for unknown paths", () => {
        expect(manager.get("nope.md")).toBeUndefined();
    });

    it("stores and retrieves a sync record", () => {
        const rec: SyncRecord = {
            confluencePageId: "123",
            confluenceTitle: "Test",
            confluenceVersion: 1,
            lastSyncedAt: new Date().toISOString(),
            contentHash: "abc",
        };
        manager.set("docs/test.md", rec);
        expect(manager.get("docs/test.md")).toEqual(rec);
    });

    it("deletes a sync record", () => {
        manager.set("docs/test.md", {
            confluencePageId: "123",
            confluenceTitle: "Test",
            confluenceVersion: 1,
            lastSyncedAt: "",
            contentHash: "",
        });
        manager.delete("docs/test.md");
        expect(manager.get("docs/test.md")).toBeUndefined();
    });

    it("findByPageId returns the file path for a given page ID", () => {
        manager.set("a.md", {
            confluencePageId: "10",
            confluenceTitle: "A",
            confluenceVersion: 1,
            lastSyncedAt: "",
            contentHash: "",
        });
        manager.set("b.md", {
            confluencePageId: "20",
            confluenceTitle: "B",
            confluenceVersion: 1,
            lastSyncedAt: "",
            contentHash: "",
        });
        expect(manager.findByPageId("20")).toBe("b.md");
        expect(manager.findByPageId("999")).toBeUndefined();
    });

    it("all() returns a shallow copy", () => {
        manager.set("x.md", {
            confluencePageId: "1",
            confluenceTitle: "X",
            confluenceVersion: 1,
            lastSyncedAt: "",
            contentHash: "",
        });
        const snap = manager.all();
        expect(snap).toHaveProperty("x.md");
        // mutating the copy should NOT affect the manager
        delete snap["x.md"];
        expect(manager.get("x.md")).toBeDefined();
    });

    // ── FolderMap CRUD ───────────────────────────────────────────────────

    it("returns undefined for unknown folder paths", () => {
        expect(manager.getFolder("no/such/dir")).toBeUndefined();
    });

    it("stores and retrieves a folder mapping", () => {
        manager.setFolder("docs/sub", "555");
        expect(manager.getFolder("docs/sub")).toBe("555");
    });

    it("deletes a folder mapping", () => {
        manager.setFolder("docs/sub", "555");
        manager.deleteFolder("docs/sub");
        expect(manager.getFolder("docs/sub")).toBeUndefined();
    });

    it("allFolders() returns a shallow copy", () => {
        manager.setFolder("a", "1");
        const snap = manager.allFolders();
        expect(snap).toHaveProperty("a");
        delete snap["a"];
        expect(manager.getFolder("a")).toBe("1");
    });

    // ── Persistence ──────────────────────────────────────────────────────

    it("round-trips through save/load", async () => {
        manager.set("file.md", {
            confluencePageId: "42",
            confluenceTitle: "File",
            confluenceVersion: 3,
            lastSyncedAt: "2024-01-01T00:00:00Z",
            contentHash: "deadbeef",
        });
        manager.setFolder("dir", "99");
        await manager.save();

        // Create a second manager on the same fake plugin backing store
        const secondManager = new SyncStateManager((manager as any).plugin);
        await secondManager.load();

        expect(secondManager.get("file.md")?.confluencePageId).toBe("42");
        expect(secondManager.getFolder("dir")).toBe("99");
    });

    it("clearAll wipes sync records and folder maps", async () => {
        manager.set("a.md", {
            confluencePageId: "1",
            confluenceTitle: "A",
            confluenceVersion: 1,
            lastSyncedAt: "",
            contentHash: "",
        });
        manager.setFolder("d", "2");
        await manager.clearAll();

        expect(manager.get("a.md")).toBeUndefined();
        expect(manager.getFolder("d")).toBeUndefined();
        expect(Object.keys(manager.all())).toHaveLength(0);
        expect(Object.keys(manager.allFolders())).toHaveLength(0);
    });

    // ── Static hash ──────────────────────────────────────────────────────

    it("hash returns a hex string", () => {
        const h = SyncStateManager.hash("hello world");
        expect(h).toMatch(/^[0-9a-f]+$/);
    });

    it("hash is deterministic", () => {
        expect(SyncStateManager.hash("abc")).toBe(SyncStateManager.hash("abc"));
    });

    it("hash differs for different inputs", () => {
        expect(SyncStateManager.hash("a")).not.toBe(SyncStateManager.hash("b"));
    });

    it("hash handles empty string", () => {
        const h = SyncStateManager.hash("");
        expect(h).toMatch(/^[0-9a-f]+$/);
    });
});
