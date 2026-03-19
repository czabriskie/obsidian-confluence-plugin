/**
 * Confluence REST API v1 client.
 * Uses Obsidian's requestUrl() to avoid CORS restrictions on Atlassian Cloud.
 */

import { requestUrl, RequestUrlParam } from "obsidian";

export interface ConfluencePage {
    id: string;
    title: string;
    body: string; // storage format HTML or wiki markup
    version: number;
    parentId?: string;
    spaceKey: string;
    webUrl: string;
    createdAt: string;
    updatedAt: string;
}

export interface ConfluenceSpace {
    key: string;
    name: string;
    id: number;
}

export interface ConfluencePageChild {
    id: string;
    title: string;
    version: number;
    parentId?: string;
    /** Ordered list of ancestor IDs from root → immediate parent */
    ancestorIds: string[];
    /** Ordered list of ancestor titles from root → immediate parent */
    ancestorTitles: string[];
}

export interface ConfluenceClientOptions {
    baseUrl: string;       // e.g. https://yoursite.atlassian.net/wiki
    email: string;
    apiToken: string;
    spaceKey: string;
}

export class ConfluenceClient {
    private baseUrl: string;
    private authHeader: string;
    private spaceKey: string;

    constructor(options: ConfluenceClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/$/, "");
        this.spaceKey = options.spaceKey;
        const credentials = btoa(`${options.email}:${options.apiToken}`);
        this.authHeader = `Basic ${credentials}`;
    }

    private async request<T>(
        path: string,
        options: { method?: string; body?: string } = {}
    ): Promise<T> {
        const url = `${this.baseUrl}/rest/api${path}`;

        const params: RequestUrlParam = {
            url,
            method: options.method ?? "GET",
            headers: {
                Authorization: this.authHeader,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            ...(options.body ? { body: options.body } : {}),
            throw: false,
        };

        const response = await requestUrl(params);

        if (response.status === 204) {
            return undefined as T;
        }

        if (response.status < 200 || response.status >= 300) {
            throw new Error(
                `Confluence API error ${response.status}: ${response.text}`
            );
        }

        return response.json as T;
    }

    /** List all pages in the configured space, optionally under a parent. */
    async listPages(parentId?: string): Promise<ConfluencePageChild[]> {
        const pages: ConfluencePageChild[] = [];
        let start = 0;
        const limit = 50;

        while (true) {
            const query = new URLSearchParams({
                spaceKey: this.spaceKey,
                type: "page",
                start: String(start),
                limit: String(limit),
                expand: "version,ancestors",
            });

            if (parentId) {
                query.set("ancestors", parentId);
            }

            const data = await this.request<{
                results: Array<{
                    id: string;
                    title: string;
                    version: { number: number };
                    ancestors: Array<{ id: string; title: string }>;
                }>;
                _links: { next?: string };
            }>(`/content?${query}`);

            for (const r of data.results) {
                pages.push({
                    id: r.id,
                    title: r.title,
                    version: r.version.number,
                    parentId: r.ancestors.at(-1)?.id,
                    ancestorIds: r.ancestors.map((a) => a.id),
                    ancestorTitles: r.ancestors.map((a: { id: string; title: string }) => a.title),
                });
            }

            if (!data._links.next) break;
            start += limit;
        }

        return pages;
    }

    /** Fetch a single page's content (storage format). */
    async getPage(pageId: string): Promise<ConfluencePage> {
        const data = await this.request<{
            id: string;
            title: string;
            version: { number: number; when?: string };
            body: { storage: { value: string } };
            space: { key: string };
            ancestors: Array<{ id: string }>;
            _links: { webui: string };
            history: { createdDate: string; lastUpdated?: { when: string } };
        }>(
            `/content/${pageId}?expand=body.storage,version,space,ancestors,history,history.lastUpdated`
        );

        return {
            id: data.id,
            title: data.title,
            version: data.version.number,
            body: data.body.storage.value,
            spaceKey: data.space.key,
            parentId: data.ancestors.at(-1)?.id,
            webUrl: `${this.baseUrl}${data._links.webui}`,
            createdAt: data.history.createdDate,
            updatedAt: data.history.lastUpdated?.when ?? data.version.when ?? data.history.createdDate,
        };
    }

    /** Get a page by title. Returns null if not found. */
    async getPageByTitle(title: string, parentId?: string): Promise<ConfluencePage | null> {
        const query = new URLSearchParams({
            spaceKey: this.spaceKey,
            title,
            type: "page",
            expand: "body.storage,version,space,ancestors,history,history.lastUpdated",
        });

        // Scope the search to direct children of the parent when provided.
        // This prevents matching same-titled pages elsewhere in the space.
        if (parentId) {
            query.set("ancestors", parentId);
        }

        const data = await this.request<{
            results: Array<{
                id: string;
                title: string;
                version: { number: number; when?: string };
                body: { storage: { value: string } };
                space: { key: string };
                ancestors: Array<{ id: string }>;
                _links: { webui: string };
                history: { createdDate: string; lastUpdated?: { when: string } };
            }>;
        }>(`/content?${query}`);

        if (data.results.length === 0) return null;

        // Secondary client-side filter as a safety net
        const match = parentId
            ? data.results.find((r) => r.ancestors.at(-1)?.id === parentId) ?? data.results[0]
            : data.results[0];

        return {
            id: match.id,
            title: match.title,
            version: match.version.number,
            body: match.body.storage.value,
            spaceKey: match.space.key,
            parentId: match.ancestors.at(-1)?.id,
            webUrl: `${this.baseUrl}${match._links.webui}`,
            createdAt: match.history.createdDate,
            updatedAt: match.history.lastUpdated?.when ?? match.version.when ?? match.history.createdDate,
        };
    }

    /** Create a new Confluence page. Returns the created page. */
    async createPage(
        title: string,
        storageBody: string,
        parentId?: string
    ): Promise<ConfluencePage> {
        const body: Record<string, unknown> = {
            type: "page",
            title,
            space: { key: this.spaceKey },
            body: {
                storage: {
                    value: storageBody,
                    representation: "storage",
                },
            },
        };

        if (parentId) {
            body.ancestors = [{ id: parentId }];
        }

        const data = await this.request<{
            id: string;
            title: string;
            version: { number: number; when?: string };
            body: { storage: { value: string } };
            space: { key: string };
            ancestors: Array<{ id: string }>;
            _links: { webui: string };
            history: { createdDate: string; lastUpdated?: { when: string } };
        }>(`/content?expand=body.storage,version,space,ancestors,history,history.lastUpdated`, {
            method: "POST",
            body: JSON.stringify(body),
        });

        return {
            id: data.id,
            title: data.title,
            version: data.version.number,
            body: data.body.storage.value,
            spaceKey: data.space.key,
            parentId: data.ancestors.at(-1)?.id,
            webUrl: `${this.baseUrl}${data._links.webui}`,
            createdAt: data.history.createdDate,
            updatedAt: data.history.lastUpdated?.when ?? data.version.when ?? data.history.createdDate,
        };
    }

    /** Update an existing Confluence page. */
    async updatePage(
        pageId: string,
        title: string,
        storageBody: string,
        currentVersion: number,
        parentId?: string
    ): Promise<ConfluencePage> {
        const body: Record<string, unknown> = {
            id: pageId,
            type: "page",
            title,
            version: { number: currentVersion + 1 },
            body: {
                storage: {
                    value: storageBody,
                    representation: "storage",
                },
            },
        };

        if (parentId) {
            body.ancestors = [{ id: parentId }];
        }

        const data = await this.request<{
            id: string;
            title: string;
            version: { number: number; when?: string };
            body: { storage: { value: string } };
            space: { key: string };
            ancestors: Array<{ id: string }>;
            _links: { webui: string };
            history: { createdDate: string; lastUpdated?: { when: string } };
        }>(`/content/${pageId}?expand=body.storage,version,space,ancestors,history,history.lastUpdated`, {
            method: "PUT",
            body: JSON.stringify(body),
        });

        return {
            id: data.id,
            title: data.title,
            version: data.version.number,
            body: data.body.storage.value,
            spaceKey: data.space.key,
            parentId: data.ancestors.at(-1)?.id,
            webUrl: `${this.baseUrl}${data._links.webui}`,
            createdAt: data.history.createdDate,
            updatedAt: data.history.lastUpdated?.when ?? data.version.when ?? data.history.createdDate,
        };
    }

    /** Delete a Confluence page. */
    async deletePage(pageId: string): Promise<void> {
        await this.request<void>(`/content/${pageId}`, { method: "DELETE" });
    }

    /** Returns the attachment ID for a given filename on a page, or null if not found. */
    async getAttachmentId(pageId: string, filename: string): Promise<string | null> {
        try {
            const data = await this.request<{ results: Array<{ id: string; title: string }> }>(
                `/rest/api/content/${pageId}/child/attachment?filename=${encodeURIComponent(filename)}&limit=1`
            );
            return data.results?.[0]?.id ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Upload a file as an attachment on a Confluence page.
     * If an attachment with the same filename already exists it is replaced
     * via PUT to the existing attachment's data endpoint.
     * Returns the attachment ID.
     */
    async uploadAttachment(pageId: string, filename: string, data: ArrayBuffer, mimeType: string): Promise<string> {
        // requestUrl mangles the multipart Content-Type boundary and fetch() is
        // blocked by CORS. Use Node's built-in https module directly — it is
        // available in Electron and sends headers exactly as specified.
        const https = require("https") as typeof import("https");
        const { URL } = require("url") as typeof import("url");

        // Check if the attachment already exists so we can PUT (update) instead
        // of POST (create), avoiding 409 "already exists" errors.
        const existingId = await this.getAttachmentId(pageId, filename);
        const path = existingId
            ? `${this.baseUrl}/rest/api/content/${pageId}/child/attachment/${existingId}/data`
            : `${this.baseUrl}/rest/api/content/${pageId}/child/attachment`;
        const method = existingId ? "PUT" : "POST";

        const endpoint = new URL(path);

        const boundary = `ConfluenceBoundary${Date.now()}`;
        const CRLF = "\r\n";
        const encoder = new TextEncoder();

        const partHeader = encoder.encode(
            `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
            `Content-Type: ${mimeType}${CRLF}${CRLF}`
        );
        const partFooter = encoder.encode(`${CRLF}--${boundary}--${CRLF}`);
        const fileBytes = new Uint8Array(data);

        const bodyBytes = new Uint8Array(partHeader.length + fileBytes.length + partFooter.length);
        bodyBytes.set(partHeader, 0);
        bodyBytes.set(fileBytes, partHeader.length);
        bodyBytes.set(partFooter, partHeader.length + fileBytes.length);

        const responseText = await new Promise<string>((resolve, reject) => {
            const req = https.request(
                {
                    hostname: endpoint.hostname,
                    port: 443,
                    path: endpoint.pathname + endpoint.search,
                    method,
                    headers: {
                        Authorization: this.authHeader,
                        "X-Atlassian-Token": "no-check",
                        "Content-Type": `multipart/form-data; boundary=${boundary}`,
                        "Content-Length": bodyBytes.length,
                    },
                },
                (res) => {
                    let body = "";
                    res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
                    res.on("end", () => {
                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(body);
                        } else {
                            reject(new Error(`Confluence attachment upload error ${res.statusCode}: ${body}`));
                        }
                    });
                }
            );
            req.on("error", reject);
            req.write(Buffer.from(bodyBytes));
            req.end();
        });

        const json = JSON.parse(responseText) as { results?: Array<{ id: string }> };
        return json.results?.[0]?.id ?? "";
    }

    /** Retrieve a space by key to validate connectivity. */
    async getSpace(): Promise<ConfluenceSpace> {
        const data = await this.request<{
            key: string;
            name: string;
            id: number;
        }>(`/space/${this.spaceKey}`);

        return { key: data.key, name: data.name, id: data.id };
    }
}
