var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ConfluenceSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  confluenceBaseUrl: "",
  confluenceEmail: "",
  confluenceApiToken: "",
  confluenceSpaceKey: "",
  confluenceParentPageId: "",
  vaultDirectory: "Confluence",
  conflictStrategy: "newer",
  syncDirection: "both",
  autoSyncIntervalMinutes: 0,
  excludedPaths: []
};
var ConfluenceSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    __publicField(this, "plugin");
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Confluence Sync Settings" });
    containerEl.createEl("h3", { text: "Confluence Connection" });
    new import_obsidian.Setting(containerEl).setName("Confluence Base URL").setDesc(
      "Your Confluence site URL, e.g. https://myorg.atlassian.net/wiki"
    ).addText(
      (text) => text.setPlaceholder("https://myorg.atlassian.net/wiki").setValue(this.plugin.settings.confluenceBaseUrl).onChange(async (value) => {
        this.plugin.settings.confluenceBaseUrl = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Atlassian Email").setDesc("The email address associated with your Atlassian account").addText(
      (text) => text.setPlaceholder("you@example.com").setValue(this.plugin.settings.confluenceEmail).onChange(async (value) => {
        this.plugin.settings.confluenceEmail = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("API Token").setDesc(
      "Create an API token at https://id.atlassian.com/manage/api-tokens"
    ).addText((text) => {
      text.setPlaceholder("Your API token").setValue(this.plugin.settings.confluenceApiToken).onChange(async (value) => {
        this.plugin.settings.confluenceApiToken = value.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
    });
    new import_obsidian.Setting(containerEl).setName("Space Key").setDesc('The Confluence space key, e.g. "ENG" or "TEAM"').addText(
      (text) => text.setPlaceholder("ENG").setValue(this.plugin.settings.confluenceSpaceKey).onChange(async (value) => {
        this.plugin.settings.confluenceSpaceKey = value.trim().toUpperCase();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Parent Page ID (optional)").setDesc(
      "ID of the Confluence page to nest all synced pages under. Leave blank to place at space root."
    ).addText(
      (text) => text.setPlaceholder("123456").setValue(this.plugin.settings.confluenceParentPageId).onChange(async (value) => {
        this.plugin.settings.confluenceParentPageId = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Test Connection").setDesc("Verify that the credentials above are correct").addButton(
      (btn) => btn.setButtonText("Test").setCta().onClick(async () => {
        await this.plugin.testConnection();
      })
    );
    containerEl.createEl("h3", { text: "Sync Options" });
    new import_obsidian.Setting(containerEl).setName("Vault Directory").setDesc(
      "Path inside your vault to sync (relative to vault root), e.g. Confluence"
    ).addText(
      (text) => text.setPlaceholder("Confluence").setValue(this.plugin.settings.vaultDirectory).onChange(async (value) => {
        this.plugin.settings.vaultDirectory = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Sync Direction").setDesc("Which direction changes are propagated").addDropdown(
      (dd) => dd.addOption("both", "Both ways").addOption("push", "Obsidian \u2192 Confluence only").addOption("pull", "Confluence \u2192 Obsidian only").setValue(this.plugin.settings.syncDirection).onChange(async (value) => {
        this.plugin.settings.syncDirection = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Conflict Strategy").setDesc("What to do when both local and remote have changed").addDropdown(
      (dd) => dd.addOption("newer", "Keep newer version").addOption("local", "Always keep local (Obsidian)").addOption("remote", "Always keep remote (Confluence)").setValue(this.plugin.settings.conflictStrategy).onChange(async (value) => {
        this.plugin.settings.conflictStrategy = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto-Sync Interval (minutes)").setDesc(
      "How often to automatically sync. Set to 0 to disable auto-sync."
    ).addText(
      (text) => text.setPlaceholder("0").setValue(
        String(this.plugin.settings.autoSyncIntervalMinutes)
      ).onChange(async (value) => {
        const num = parseInt(value, 10);
        if (!isNaN(num) && num >= 0) {
          this.plugin.settings.autoSyncIntervalMinutes = num;
          await this.plugin.saveSettings();
          this.plugin.resetAutoSync();
        }
      })
    );
    containerEl.createEl("h3", { text: "Exclusions" });
    containerEl.createEl("p", {
      text: "Right-click any file or folder in the file explorer to toggle Confluence sync on/off. Excluded paths are listed below.",
      cls: "setting-item-description"
    });
    const excluded = this.plugin.settings.excludedPaths;
    if (excluded.length === 0) {
      containerEl.createEl("p", {
        text: "No exclusions \u2014 all files in the sync directory are synced.",
        cls: "setting-item-description"
      });
    } else {
      const list = containerEl.createEl("ul");
      for (const p of [...excluded].sort()) {
        const li = list.createEl("li");
        li.createSpan({ text: p });
        const btn = li.createEl("button", { text: "Remove" });
        btn.style.marginLeft = "8px";
        btn.addEventListener("click", async () => {
          this.plugin.settings.excludedPaths = this.plugin.settings.excludedPaths.filter((x) => x !== p);
          await this.plugin.saveSettings();
          this.display();
        });
      }
    }
  }
};

// src/confluenceClient.ts
var import_obsidian2 = require("obsidian");
var ConfluenceClient = class {
  constructor(options) {
    __publicField(this, "baseUrl");
    __publicField(this, "authHeader");
    __publicField(this, "spaceKey");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.spaceKey = options.spaceKey;
    const credentials = btoa(`${options.email}:${options.apiToken}`);
    this.authHeader = `Basic ${credentials}`;
  }
  async request(path, options = {}) {
    var _a;
    const url = `${this.baseUrl}/rest/api${path}`;
    const params = {
      url,
      method: (_a = options.method) != null ? _a : "GET",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      ...options.body ? { body: options.body } : {},
      throw: false
    };
    const response = await (0, import_obsidian2.requestUrl)(params);
    if (response.status === 204) {
      return void 0;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Confluence API error ${response.status}: ${response.text}`
      );
    }
    return response.json;
  }
  /** List all pages in the configured space, optionally under a parent. */
  async listPages(parentId) {
    var _a;
    const pages = [];
    let start = 0;
    const limit = 50;
    while (true) {
      const query = new URLSearchParams({
        spaceKey: this.spaceKey,
        type: "page",
        start: String(start),
        limit: String(limit),
        expand: "version,ancestors"
      });
      const data = await this.request(`/content?${query}`);
      for (const r of data.results) {
        pages.push({
          id: r.id,
          title: r.title,
          version: r.version.number,
          parentId: (_a = r.ancestors.at(-1)) == null ? void 0 : _a.id,
          ancestorIds: r.ancestors.map((a) => a.id),
          ancestorTitles: r.ancestors.map((a) => a.title)
        });
      }
      if (!data._links.next) break;
      start += limit;
    }
    return pages;
  }
  /** Fetch a single page's content (storage format). */
  async getPage(pageId) {
    var _a, _b, _c, _d;
    const data = await this.request(
      `/content/${pageId}?expand=body.storage,version,space,ancestors,history,history.lastUpdated`
    );
    return {
      id: data.id,
      title: data.title,
      version: data.version.number,
      body: data.body.storage.value,
      spaceKey: data.space.key,
      parentId: (_a = data.ancestors.at(-1)) == null ? void 0 : _a.id,
      webUrl: `${this.baseUrl}${data._links.webui}`,
      createdAt: data.history.createdDate,
      updatedAt: (_d = (_c = (_b = data.history.lastUpdated) == null ? void 0 : _b.when) != null ? _c : data.version.when) != null ? _d : data.history.createdDate
    };
  }
  /** Get a page by title. Returns null if not found. */
  async getPageByTitle(title, parentId) {
    var _a, _b, _c, _d;
    const query = new URLSearchParams({
      spaceKey: this.spaceKey,
      title,
      type: "page",
      expand: "body.storage,version,space,ancestors,history,history.lastUpdated"
    });
    const data = await this.request(`/content?${query}`);
    if (data.results.length === 0) return null;
    const match = parentId ? data.results.find((r) => {
      var _a2;
      return ((_a2 = r.ancestors.at(-1)) == null ? void 0 : _a2.id) === parentId;
    }) : data.results[0];
    if (!match) return null;
    return {
      id: match.id,
      title: match.title,
      version: match.version.number,
      body: match.body.storage.value,
      spaceKey: match.space.key,
      parentId: (_a = match.ancestors.at(-1)) == null ? void 0 : _a.id,
      webUrl: `${this.baseUrl}${match._links.webui}`,
      createdAt: match.history.createdDate,
      updatedAt: (_d = (_c = (_b = match.history.lastUpdated) == null ? void 0 : _b.when) != null ? _c : match.version.when) != null ? _d : match.history.createdDate
    };
  }
  /** Create a new Confluence page. Returns the created page. */
  async createPage(title, storageBody, parentId) {
    var _a, _b, _c, _d;
    const body = {
      type: "page",
      title,
      space: { key: this.spaceKey },
      body: {
        storage: {
          value: storageBody,
          representation: "storage"
        }
      }
    };
    if (parentId) {
      body.ancestors = [{ id: parentId }];
    }
    const data = await this.request(`/content?expand=body.storage,version,space,ancestors,history,history.lastUpdated`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    return {
      id: data.id,
      title: data.title,
      version: data.version.number,
      body: data.body.storage.value,
      spaceKey: data.space.key,
      parentId: (_a = data.ancestors.at(-1)) == null ? void 0 : _a.id,
      webUrl: `${this.baseUrl}${data._links.webui}`,
      createdAt: data.history.createdDate,
      updatedAt: (_d = (_c = (_b = data.history.lastUpdated) == null ? void 0 : _b.when) != null ? _c : data.version.when) != null ? _d : data.history.createdDate
    };
  }
  /** Update an existing Confluence page. */
  async updatePage(pageId, title, storageBody, currentVersion, parentId) {
    var _a, _b, _c, _d;
    const body = {
      id: pageId,
      type: "page",
      title,
      version: { number: currentVersion + 1 },
      body: {
        storage: {
          value: storageBody,
          representation: "storage"
        }
      }
    };
    if (parentId) {
      body.ancestors = [{ id: parentId }];
    }
    const data = await this.request(`/content/${pageId}?expand=body.storage,version,space,ancestors,history,history.lastUpdated`, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    return {
      id: data.id,
      title: data.title,
      version: data.version.number,
      body: data.body.storage.value,
      spaceKey: data.space.key,
      parentId: (_a = data.ancestors.at(-1)) == null ? void 0 : _a.id,
      webUrl: `${this.baseUrl}${data._links.webui}`,
      createdAt: data.history.createdDate,
      updatedAt: (_d = (_c = (_b = data.history.lastUpdated) == null ? void 0 : _b.when) != null ? _c : data.version.when) != null ? _d : data.history.createdDate
    };
  }
  /** Delete a Confluence page. */
  async deletePage(pageId) {
    await this.request(`/content/${pageId}`, { method: "DELETE" });
  }
  /** Returns the attachment ID for a given filename on a page, or null if not found. */
  async getAttachmentId(pageId, filename) {
    var _a, _b, _c;
    try {
      const data = await this.request(
        `/content/${pageId}/child/attachment?filename=${encodeURIComponent(filename)}&limit=1`
      );
      return (_c = (_b = (_a = data.results) == null ? void 0 : _a[0]) == null ? void 0 : _b.id) != null ? _c : null;
    } catch (e) {
      return null;
    }
  }
  /**
   * Upload a file as an attachment on a Confluence page.
   * If an attachment with the same filename already exists it is replaced
   * via PUT to the existing attachment's data endpoint.
   * Returns the attachment ID.
   */
  async uploadAttachment(pageId, filename, data, mimeType) {
    var _a, _b, _c;
    const https = require("https");
    const { URL } = require("url");
    const existingId = await this.getAttachmentId(pageId, filename);
    const path = existingId ? `${this.baseUrl}/rest/api/content/${pageId}/child/attachment/${existingId}/data` : `${this.baseUrl}/rest/api/content/${pageId}/child/attachment`;
    const method = existingId ? "PUT" : "POST";
    const endpoint = new URL(path);
    const boundary = `ConfluenceBoundary${Date.now()}`;
    const CRLF = "\r\n";
    const encoder = new TextEncoder();
    const partHeader = encoder.encode(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}Content-Type: ${mimeType}${CRLF}${CRLF}`
    );
    const partFooter = encoder.encode(`${CRLF}--${boundary}--${CRLF}`);
    const fileBytes = new Uint8Array(data);
    const bodyBytes = new Uint8Array(partHeader.length + fileBytes.length + partFooter.length);
    bodyBytes.set(partHeader, 0);
    bodyBytes.set(fileBytes, partHeader.length);
    bodyBytes.set(partFooter, partHeader.length + fileBytes.length);
    const responseText = await new Promise((resolve, reject) => {
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
            "Content-Length": bodyBytes.length
          }
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk.toString();
          });
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
    const json = JSON.parse(responseText);
    return (_c = (_b = (_a = json.results) == null ? void 0 : _a[0]) == null ? void 0 : _b.id) != null ? _c : "";
  }
  /**
   * Fetch all comments on a page, ordered oldest → newest.
   * Returns an empty array if the page has no comments.
   */
  async getPageComments(pageId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    const comments = [];
    let start = 0;
    const limit = 50;
    while (true) {
      const query = new URLSearchParams({
        expand: "body.storage,version,history,extensions.inlineProperties",
        start: String(start),
        limit: String(limit)
      });
      const data = await this.request(`/content/${pageId}/child/comment?${query}`);
      for (const r of data.results) {
        comments.push({
          id: r.id,
          author: (_f = (_e = (_b = (_a = r.history) == null ? void 0 : _a.createdBy) == null ? void 0 : _b.displayName) != null ? _e : (_d = (_c = r.version) == null ? void 0 : _c.by) == null ? void 0 : _d.displayName) != null ? _f : "Unknown",
          body: r.body.storage.value,
          createdAt: (_j = (_i = (_g = r.history) == null ? void 0 : _g.createdDate) != null ? _i : (_h = r.version) == null ? void 0 : _h.when) != null ? _j : "",
          markerRef: (_l = (_k = r.extensions) == null ? void 0 : _k.inlineProperties) == null ? void 0 : _l.markerRef
        });
      }
      if (!data._links.next) break;
      start += limit;
    }
    return comments;
  }
  /** Retrieve a space by key to validate connectivity. */
  async getSpace() {
    const data = await this.request(`/space/${this.spaceKey}`);
    return { key: data.key, name: data.name, id: data.id };
  }
};

// src/syncStateManager.ts
var SYNC_MAP_KEY = "syncMap";
var FOLDER_MAP_KEY = "folderMap";
var SyncStateManager = class {
  constructor(plugin) {
    __publicField(this, "plugin");
    __publicField(this, "map", {});
    __publicField(this, "folders", {});
    this.plugin = plugin;
  }
  async load() {
    var _a, _b;
    const data = await this.plugin.loadData();
    this.map = (_a = data == null ? void 0 : data[SYNC_MAP_KEY]) != null ? _a : {};
    this.folders = (_b = data == null ? void 0 : data[FOLDER_MAP_KEY]) != null ? _b : {};
  }
  async save() {
    var _a;
    const data = (_a = await this.plugin.loadData()) != null ? _a : {};
    data[SYNC_MAP_KEY] = this.map;
    data[FOLDER_MAP_KEY] = this.folders;
    await this.plugin.saveData(data);
  }
  get(filePath) {
    return this.map[filePath];
  }
  set(filePath, record) {
    this.map[filePath] = record;
  }
  delete(filePath) {
    delete this.map[filePath];
  }
  /** Find the local file path mapped to a Confluence page ID. */
  findByPageId(pageId) {
    return Object.keys(this.map).find(
      (p) => this.map[p].confluencePageId === pageId
    );
  }
  all() {
    return { ...this.map };
  }
  async clearAll() {
    this.map = {};
    this.folders = {};
    await this.save();
  }
  getFolder(dirPath) {
    return this.folders[dirPath];
  }
  setFolder(dirPath, pageId) {
    this.folders[dirPath] = pageId;
  }
  deleteFolder(dirPath) {
    delete this.folders[dirPath];
  }
  allFolders() {
    return { ...this.folders };
  }
  /** Simple hash of a string (djb2). Good enough for change detection. */
  static hash(content) {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
      hash = hash * 33 ^ content.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }
};

// src/syncEngine.ts
var import_obsidian3 = require("obsidian");

// src/converter.ts
var COMMENTS_SECTION_MARKER = "%% confluence-comments %%";
function autoLinkUrls(text) {
  return text.replace(
    /(?<!href=")(?<!<a[^>]*>)(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1">$1</a>'
  );
}
function escapeXmlText(text) {
  return text.replace(/&(?![a-zA-Z#]\w{0,6};)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
var IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i;
function extractEmbeddedImages(markdown) {
  const seen = /* @__PURE__ */ new Set();
  const re = /!\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const name = m[1].trim();
    if (IMAGE_EXTENSIONS.test(name)) seen.add(name);
  }
  return [...seen];
}
function applyOutsideCdata(input, fn) {
  const parts = input.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
  return parts.map((part, i) => i % 2 === 0 ? fn(part) : part).join("");
}
function escapeXmlTextNodes(html) {
  return html.split(/(<[^>]+>)/).map(
    (part, i) => i % 2 === 0 ? escapeXmlText(part) : part
  ).join("");
}
function convertTables(input) {
  return input.replace(
    /((?:^[ \t]*\|.+\|[ \t]*\n?(?:^[ \t]*\n)?)+)/gm,
    (block) => {
      const rows = block.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
      if (rows.length === 0) return block;
      const isSeparator = (row) => row.replace(/\|/g, "").trim().replace(/[\s\-:]/g, "") === "";
      const parseCells = (row) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/`([^`]+)`/g, (_, inner) => escapeXmlText(inner)));
      const sepIdx = rows.findIndex(isSeparator);
      const headerRows = sepIdx > 0 ? rows.slice(0, sepIdx) : [rows[0]];
      const dataRows = sepIdx >= 0 ? rows.slice(sepIdx + 1) : rows.slice(1);
      let out = `<table><colgroup>${headerRows[0].split("|").slice(1, -1).map(() => "<col/>").join("")}</colgroup>`;
      out += "<thead>";
      for (const row of headerRows) {
        out += "<tr>" + parseCells(row).map((c) => `<th><p>${escapeXmlTextNodes(autoLinkUrls(c))}</p></th>`).join("") + "</tr>";
      }
      out += "</thead>";
      if (dataRows.length > 0) {
        out += "<tbody>";
        for (const row of dataRows) {
          out += "<tr>" + parseCells(row).map((c) => `<td><p>${escapeXmlTextNodes(autoLinkUrls(c))}</p></td>`).join("") + "</tr>";
        }
        out += "</tbody>";
      }
      out += "</table>";
      return out;
    }
  );
}
function convertTaskLists(input) {
  let taskIdCounter = 1;
  return input.replace(
    /((?:^[ \t]*- \[[xX ]\] .+\n?)+)/gm,
    (block) => {
      const lines = block.replace(/\n$/, "").split("\n");
      const tasks = lines.map((line) => {
        const m = line.match(/^[ \t]*- \[([xX ])\] (.*)$/);
        if (!m) return "";
        const checked = m[1].toLowerCase() === "x";
        const status = checked ? "complete" : "incomplete";
        const text = escapeXmlTextNodes(m[2]);
        const id = taskIdCounter++;
        return `<ac:task><ac:task-id>${id}</ac:task-id><ac:task-status>${status}</ac:task-status><ac:task-body><span class="placeholder-inline-tasks">${text}</span></ac:task-body></ac:task>`;
      });
      return `<ac:task-list>${tasks.join("")}</ac:task-list>`;
    }
  );
}
function convertLists(input) {
  return input.replace(
    /((?:^[ \t]*(?:[-*+]|\d+\.) .+\n?)+)/gm,
    (block) => {
      const rawLines = block.replace(/\n$/, "").split("\n");
      const items = rawLines.map((line) => {
        const m = line.match(/^([ \t]*)([-*+]|\d+\.) (.*)$/);
        if (!m) return { indent: 0, ordered: false, text: line };
        const indentStr = m[1].replace(/\t/g, "    ");
        return {
          indent: indentStr.length,
          ordered: /\d+\./.test(m[2]),
          text: m[3]
        };
      });
      function buildList(startIdx, minIndent) {
        const firstItem = items[startIdx];
        const tag = firstItem.ordered ? "ol" : "ul";
        let out = `<${tag}>`;
        let i = startIdx;
        while (i < items.length && items[i].indent >= minIndent) {
          const item = items[i];
          if (item.indent > minIndent) {
            i++;
            continue;
          }
          let liContent = escapeXmlTextNodes(item.text);
          let j = i + 1;
          if (j < items.length && items[j].indent > item.indent) {
            const [subList, nextIdx] = buildList(j, items[j].indent);
            liContent += subList;
            out += `<li>${liContent}</li>`;
            i = nextIdx;
          } else {
            out += `<li>${liContent}</li>`;
            i++;
          }
        }
        out += `</${tag}>`;
        return [out, i];
      }
      const [result] = buildList(0, items[0].indent);
      return result;
    }
  );
}
function markdownToConfluenceStorage(markdown, titleToUrl = /* @__PURE__ */ new Map(), contextDir) {
  let html = markdown;
  html = html.replace(/^---[\s\S]*?---\n?/, "");
  const commentsIdx = html.indexOf(COMMENTS_SECTION_MARKER);
  if (commentsIdx !== -1) {
    html = html.substring(0, commentsIdx).trimEnd() + "\n";
  }
  html = html.replace(/^%%[^\n]*%%\s*$/gm, "");
  html = html.replace(
    /^> \[!(\w+)\](?: ([^\n]*))?$\n?((?:^> [^\n]*$\n?)*)/gm,
    (match, type, title, bodyLines) => {
      const typeMap = {
        "note": "note",
        "info": "info",
        "tip": "tip",
        "success": "tip",
        "warning": "warning",
        "caution": "warning",
        "danger": "warning",
        "error": "warning",
        "bug": "warning",
        "example": "info",
        "quote": "info",
        "abstract": "info",
        "summary": "info",
        "todo": "info",
        "question": "info",
        "faq": "info"
      };
      const macroName = typeMap[type.toLowerCase()] || "info";
      let body = "";
      if (bodyLines) {
        body = bodyLines.split("\n").map((line) => line.replace(/^> ?/, "").trim()).filter((line) => line.length > 0).join(" ");
      }
      let macro = `<ac:structured-macro ac:name="${macroName}">`;
      if (title && title.trim()) {
        macro += `<ac:parameter ac:name="title">${escapeXmlText(title.trim())}</ac:parameter>`;
      }
      if (body) {
        body = body.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/`(.+?)`/g, "<code>$1</code>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        macro += `<ac:rich-text-body><p>${escapeXmlTextNodes(body)}</p></ac:rich-text-body>`;
      }
      macro += `</ac:structured-macro>`;
      return macro;
    }
  );
  html = html.replace(
    /!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp|ico))\]\]/gi,
    (_, filename) => `<ac:image><ri:attachment ri:filename="${filename}"/></ac:image>`
  );
  html = html.replace(/!\[\[[^\]]*\]\]/g, "");
  const resolveWikiUrl = (lookup) => {
    const key = lookup.trim().toLowerCase();
    if (contextDir) {
      const ctxKey = `${contextDir.toLowerCase()}/${key}`;
      const ctxUrl = titleToUrl.get(ctxKey);
      if (ctxUrl) return ctxUrl;
    }
    return titleToUrl.get(key);
  };
  html = html.replace(/\[\[([^\]|]+\.[a-zA-Z0-9]+)\s*\|([^\]]+)\]\]/g, (_, _file, alias) => {
    const title = _file.replace(/\.[^.]+$/, "");
    const url = resolveWikiUrl(title);
    return url ? `<a href="${url}">${escapeXmlText(alias)}</a>` : escapeXmlText(alias);
  });
  html = html.replace(/\[\[([^\]|]+\.[a-zA-Z0-9]+)\]\]/g, (_, f) => {
    const title = f.replace(/\.[^.]+$/, "");
    const url = resolveWikiUrl(title);
    return url ? `<a href="${url}">${escapeXmlText(title)}</a>` : escapeXmlText(title);
  });
  html = html.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_, page, alias) => {
    var _a;
    const segments = page.split("/");
    const lastName = segments[segments.length - 1];
    const url = (_a = resolveWikiUrl(page)) != null ? _a : resolveWikiUrl(lastName);
    return url ? `<a href="${url}">${escapeXmlText(alias)}</a>` : escapeXmlText(alias);
  });
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_, page) => {
    var _a;
    const segments = page.split("/");
    const lastName = segments[segments.length - 1];
    const url = (_a = resolveWikiUrl(page)) != null ? _a : resolveWikiUrl(lastName);
    const display = lastName;
    return url ? `<a href="${url}">${escapeXmlText(display)}</a>` : escapeXmlText(display);
  });
  html = html.replace(/==(.+?)==/g, "**$1**");
  html = html.replace(/\[\^\w+\]/g, "");
  html = html.replace(/^\[\^\w+\]:.+$/gm, "");
  html = html.replace(/(?<=\s|^)#([a-zA-Z][a-zA-Z0-9_/-]*)/gm, "$1");
  html = html.replace(/\t/g, "    ");
  html = html.replace(/^###### (.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^##### (.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  html = html.replace(
    /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm,
    (_, langLine, code) => {
      var _a;
      const lang = (_a = langLine.trim().split(/\s+/)[0]) != null ? _a : "";
      return `<ac:structured-macro ac:name="code">` + (lang ? `<ac:parameter ac:name="language">${escapeXmlText(lang)}</ac:parameter>` : "") + `<ac:plain-text-body><![CDATA[${code}]]></ac:plain-text-body></ac:structured-macro>`;
    }
  );
  html = applyOutsideCdata(html, convertTables);
  html = html.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeXmlText(code)}</code>`);
  html = applyOutsideCdata(html, (segment) => {
    segment = segment.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    segment = segment.replace(/__(.+?)__/g, "<strong>$1</strong>");
    segment = segment.replace(/\*(.+?)\*/g, "<em>$1</em>");
    segment = segment.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>");
    segment = segment.replace(/~~(.+?)~~/g, "<del>$1</del>");
    return segment;
  });
  html = html.replace(/^(?:---|\*\*\*|___)\s*$/gm, "<hr/>");
  html = html.replace(
    /((?:^> ?.*\n?)+)/gm,
    (block) => {
      const inner = block.split("\n").filter((l) => l.trim() !== "").map((l) => l.replace(/^> ?/, "").trim()).join(" ");
      return `<blockquote><p>${escapeXmlTextNodes(inner)}</p></blockquote>`;
    }
  );
  html = applyOutsideCdata(html, convertTaskLists);
  html = applyOutsideCdata(html, convertLists);
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<ac:image><ri:url ri:value="$2"/></ac:image>'
  );
  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    '<a href="$2">$1</a>'
  );
  const BLOCK_TAG = /^<(h[1-6]|p|ul|ol|li|blockquote|hr|ac:|pre|div|table|colgroup|col|thead|tbody|tr|td|th)([ \t>\/>]|$)/i;
  const HAS_HTML = /<[a-zA-Z/]/;
  const lines = html.split("\n");
  const output = [];
  let insideCdata = false;
  for (const line of lines) {
    if (!insideCdata && line.includes("<![CDATA[")) insideCdata = true;
    if (insideCdata) {
      output.push(line);
      if (line.includes("]]>")) insideCdata = false;
      continue;
    }
    const trimmed = line.trim();
    if (BLOCK_TAG.test(trimmed)) {
      output.push(line);
    } else if (trimmed === "") {
      output.push("");
    } else if (HAS_HTML.test(trimmed)) {
      output.push(`<p>${escapeXmlTextNodes(trimmed)}</p>`);
    } else {
      output.push(`<p>${autoLinkUrls(escapeXmlText(trimmed))}</p>`);
    }
  }
  return output.join("\n");
}
function decodeHtmlEntities(text) {
  const NAMED = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&mdash;": "\u2014",
    "&ndash;": "\u2013",
    "&rarr;": "\u2192",
    "&larr;": "\u2190",
    "&darr;": "\u2193",
    "&uarr;": "\u2191",
    "&harr;": "\u2194",
    "&laquo;": "\xAB",
    "&raquo;": "\xBB",
    "&lsaquo;": "\u2039",
    "&rsaquo;": "\u203A",
    "&ldquo;": "\u201C",
    "&rdquo;": "\u201D",
    "&lsquo;": "\u2018",
    "&rsquo;": "\u2019",
    "&bull;": "\u2022",
    "&hellip;": "\u2026",
    "&sect;": "\xA7",
    "&copy;": "\xA9",
    "&reg;": "\xAE",
    "&trade;": "\u2122",
    "&deg;": "\xB0",
    "&plusmn;": "\xB1",
    "&times;": "\xD7",
    "&divide;": "\xF7",
    "&frac12;": "\xBD",
    "&frac14;": "\xBC",
    "&frac34;": "\xBE"
  };
  for (const [entity, char] of Object.entries(NAMED)) {
    text = text.replaceAll(entity, char);
  }
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  return text;
}
function findClosingTag(html, tag, searchFrom) {
  let depth = 1;
  const re = new RegExp(`<(/?)${tag}(?:\\s[^>]*)?>`, "gi");
  re.lastIndex = searchFrom;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1] === "/") {
      depth--;
      if (depth === 0) return m.index + m[0].length;
    } else {
      depth++;
    }
  }
  return -1;
}
function inlineHtmlToMd(text) {
  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  text = text.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  text = text.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  text = text.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  text = text.replace(/<br\s*\/?>/gi, " ");
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1");
  text = text.replace(/<[^>]+>/g, "");
  return text.replace(/\n+/g, " ").trim();
}
function confluenceTableToMarkdown(tableHtml) {
  function extractRows(html) {
    const rows2 = [];
    const trRe = /<tr[^>]*>/gi;
    let trMatch;
    while ((trMatch = trRe.exec(html)) !== null) {
      const trStart = trMatch.index + trMatch[0].length;
      const trEnd = findClosingTag(html, "tr", trStart);
      if (trEnd === -1) continue;
      const trInner = html.substring(trStart, trEnd - "</tr>".length);
      const cells = [];
      const cellRe = /<(th|td)[^>]*>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(trInner)) !== null) {
        const tag = cellMatch[1];
        const cStart = cellMatch.index + cellMatch[0].length;
        const cEnd = findClosingTag(trInner, tag, cStart);
        if (cEnd === -1) continue;
        const raw = trInner.substring(cStart, cEnd - `</${tag}>`.length);
        cells.push(decodeHtmlEntities(inlineHtmlToMd(raw)));
        cellRe.lastIndex = cEnd;
      }
      if (cells.length > 0) rows2.push(cells);
      trRe.lastIndex = trEnd;
    }
    return rows2;
  }
  let rows = [];
  const theadMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (theadMatch) rows.push(...extractRows(theadMatch[1]));
  const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (tbodyMatch) rows.push(...extractRows(tbodyMatch[1]));
  if (rows.length === 0) rows = extractRows(tableHtml);
  if (rows.length === 0) return "";
  const maxCols = Math.max(...rows.map((r) => r.length));
  rows.forEach((r) => {
    while (r.length < maxCols) r.push("");
  });
  let out = "\n\n";
  out += "| " + rows[0].join(" | ") + " |\n";
  out += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
  for (let i = 1; i < rows.length; i++) {
    out += "| " + rows[i].join(" | ") + " |\n";
  }
  return out + "\n";
}
function confluenceListToMarkdown(listHtml, indent = 0) {
  const isOrdered = /^<ol/i.test(listHtml.trim());
  const tag = isOrdered ? "ol" : "ul";
  const openMatch = listHtml.match(new RegExp(`^<${tag}[^>]*>`, "i"));
  if (!openMatch) return listHtml;
  const innerStart = openMatch[0].length;
  const closeIdx = findClosingTag(listHtml, tag, innerStart);
  if (closeIdx === -1) return listHtml;
  const inner = listHtml.substring(innerStart, closeIdx - `</${tag}>`.length);
  const liRe = /<li[^>]*>/gi;
  const items = [];
  let liMatch;
  while ((liMatch = liRe.exec(inner)) !== null) {
    const contentStart = liMatch.index + liMatch[0].length;
    const endIdx = findClosingTag(inner, "li", contentStart);
    if (endIdx === -1) break;
    items.push(inner.substring(contentStart, endIdx - "</li>".length));
    liRe.lastIndex = endIdx;
  }
  const prefix = "  ".repeat(indent);
  const lines = [];
  items.forEach((item, idx) => {
    let text = item;
    let nestedMd = "";
    const nestedRe = /<(ul|ol)[^>]*>/gi;
    const nesteds = [];
    let nm;
    while ((nm = nestedRe.exec(text)) !== null) {
      const nTag = nm[1];
      const nStart = nm.index;
      const nEnd = findClosingTag(text, nTag, nm.index + nm[0].length);
      if (nEnd === -1) continue;
      nesteds.push({ start: nStart, end: nEnd, html: text.substring(nStart, nEnd) });
      nestedRe.lastIndex = nEnd;
    }
    for (let i = nesteds.length - 1; i >= 0; i--) {
      nestedMd = confluenceListToMarkdown(nesteds[i].html, indent + 1) + (nestedMd ? "\n" + nestedMd : "");
      text = text.substring(0, nesteds[i].start) + text.substring(nesteds[i].end);
    }
    const cleanText = decodeHtmlEntities(inlineHtmlToMd(text));
    const marker = isOrdered ? `${idx + 1}.` : "-";
    lines.push(`${prefix}${marker} ${cleanText}`);
    if (nestedMd) lines.push(nestedMd);
  });
  return lines.join("\n");
}
function replaceTopLevelTag(html, tag, convert) {
  const re = new RegExp(`<${tag}[^>]*>`, "gi");
  let result = "";
  let lastEnd = 0;
  let m;
  while ((m = re.exec(html)) !== null) {
    const startIdx = m.index;
    const closeIdx = findClosingTag(html, tag, m.index + m[0].length);
    if (closeIdx === -1) continue;
    result += html.substring(lastEnd, startIdx);
    result += convert(html.substring(startIdx, closeIdx));
    lastEnd = closeIdx;
    re.lastIndex = closeIdx;
  }
  result += html.substring(lastEnd);
  return result;
}
function confluenceStorageToMarkdown(storage) {
  let md = storage;
  md = md.replace(
    /<ac:task-list>([\s\S]*?)<\/ac:task-list>/gi,
    (_, inner) => {
      return inner.replace(
        /<ac:task>\s*(?:<ac:task-id>\d+<\/ac:task-id>\s*)?<ac:task-status>([^<]+)<\/ac:task-status>\s*<ac:task-body>\s*(?:<span[^>]*>)?([\s\S]*?)(?:<\/span>)?\s*<\/ac:task-body>\s*<\/ac:task>/gi,
        (_2, status, body) => {
          const checked = status.trim().toLowerCase() === "complete";
          return `- [${checked ? "x" : " "}] ${body.trim()}
`;
        }
      );
    }
  );
  md = md.replace(
    /<ac:structured-macro ac:name="code"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
    (_, inner) => {
      const langMatch = inner.match(/<ac:parameter ac:name="language">([^<]+)<\/ac:parameter>/);
      const lang = langMatch ? langMatch[1].trim() : "";
      const cdataMatch = inner.match(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/);
      const code = cdataMatch ? cdataMatch[1] : "";
      return "\n\n```" + lang + "\n" + code + "```\n\n";
    }
  );
  md = md.replace(
    /<ac:structured-macro ac:name="(info|note|warning|tip)"[^>]*>([\s\S]*?)<\/ac:structured-macro>/g,
    (_, type, inner) => {
      const typeMap = {
        info: "INFO",
        note: "NOTE",
        warning: "WARNING",
        tip: "TIP"
      };
      const calloutType = typeMap[type] || type.toUpperCase();
      const titleMatch = inner.match(/<ac:parameter ac:name="title">([^<]+)<\/ac:parameter>/);
      const title = titleMatch ? " " + titleMatch[1].trim() : "";
      const bodyMatch = inner.match(/<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/);
      let body = bodyMatch ? inlineHtmlToMd(bodyMatch[1]).trim() : "";
      let result = `> [!${calloutType}]${title}`;
      if (body) {
        result += "\n" + body.split("\n").map((l) => `> ${l}`).join("\n");
      }
      return "\n\n" + result + "\n\n";
    }
  );
  md = md.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/g, "");
  md = md.replace(
    /<ac:image[^>]*>\s*<ri:attachment ri:filename="([^"]+)"[^/]*\/>\s*<\/ac:image>/gi,
    "![[$1]]"
  );
  md = md.replace(/<ac:image[^>]*>\s*<ri:url ri:value="([^"]+)"[^/]*\/>\s*<\/ac:image>/gi, "![]($1)");
  md = replaceTopLevelTag(md, "table", confluenceTableToMarkdown);
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n\n#### $1\n\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n\n##### $1\n\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n\n###### $1\n\n");
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, "~~$1~~");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    const text = inner.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1").trim();
    return "\n\n" + text.split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
  });
  md = replaceTopLevelTag(md, "ul", (html) => "\n\n" + confluenceListToMarkdown(html) + "\n\n");
  md = replaceTopLevelTag(md, "ol", (html) => "\n\n" + confluenceListToMarkdown(html) + "\n\n");
  md = md.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");
  md = md.replace(/<[^>]+>/g, "");
  md = decodeHtmlEntities(md);
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return md;
}
function extractInlineCommentMarkers(storageBody) {
  const markers = [];
  const re = /<ac:inline-comment-marker\s+ac:ref="([^"]+)">([\s\S]*?)<\/ac:inline-comment-marker>/g;
  let m;
  while ((m = re.exec(storageBody)) !== null) {
    const ref = m[1];
    const markedHtml = m[2];
    const plainText = markedHtml.replace(/<[^>]+>/g, "").trim();
    if (plainText) {
      markers.push({ ref, markedHtml, plainText });
    }
  }
  return markers;
}
function preserveInlineCommentMarkers(oldBody, newBody) {
  const markers = extractInlineCommentMarkers(oldBody);
  if (markers.length === 0) return newBody;
  let result = newBody;
  for (const { ref, plainText } of markers) {
    if (result.includes(`ac:ref="${ref}"`)) continue;
    const escaped = plainText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const textIdx = result.indexOf(plainText);
    if (textIdx !== -1) {
      result = result.substring(0, textIdx) + `<ac:inline-comment-marker ac:ref="${ref}">${plainText}</ac:inline-comment-marker>` + result.substring(textIdx + plainText.length);
      continue;
    }
    const flexPattern = new RegExp(
      escaped.replace(/\s+/g, "\\s+")
    );
    const flexMatch = flexPattern.exec(result);
    if (flexMatch) {
      const idx = flexMatch.index;
      const matchedText = flexMatch[0];
      result = result.substring(0, idx) + `<ac:inline-comment-marker ac:ref="${ref}">${matchedText}</ac:inline-comment-marker>` + result.substring(idx + matchedText.length);
    }
  }
  return result;
}
function extractInlineMarkerTexts(storageBody) {
  const map = /* @__PURE__ */ new Map();
  const re = /<ac:inline-comment-marker\s+ac:ref="([^"]+)">([\s\S]*?)<\/ac:inline-comment-marker>/g;
  let m;
  while ((m = re.exec(storageBody)) !== null) {
    const plainText = m[2].replace(/<[^>]+>/g, "").trim();
    if (plainText) {
      map.set(m[1], plainText);
    }
  }
  return map;
}
function findTextPosition(text, needle) {
  const idx = text.indexOf(needle);
  if (idx === -1) return null;
  const before = text.substring(0, idx);
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  const col = idx - lastNewline;
  return { line, col };
}
function formatCommentsAsMarkdown(comments, storageBody, localMarkdown) {
  if (comments.length === 0) return "";
  const markerTexts = storageBody ? extractInlineMarkerTexts(storageBody) : /* @__PURE__ */ new Map();
  const lines = [
    "",
    COMMENTS_SECTION_MARKER,
    "## Comments",
    ""
  ];
  for (const c of comments) {
    const date = c.createdAt ? new Date(c.createdAt).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }) : "";
    const bodyMd = confluenceStorageToMarkdown(c.body).trim();
    let locationInfo = "";
    if (c.markerRef) {
      const highlightedText = markerTexts.get(c.markerRef);
      if (highlightedText && localMarkdown) {
        const pos = findTextPosition(localMarkdown, highlightedText);
        if (pos) {
          locationInfo = ` \u{1F4CC} L${pos.line}:${pos.col} \u201C${highlightedText}\u201D`;
        } else {
          locationInfo = ` \u{1F4CC} \u201C${highlightedText}\u201D`;
        }
      } else if (highlightedText) {
        locationInfo = ` \u{1F4CC} \u201C${highlightedText}\u201D`;
      }
    }
    lines.push(`> **${c.author}** \u2014 ${date}${locationInfo}`);
    for (const bodyLine of bodyMd.split("\n")) {
      lines.push(`> ${bodyLine}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// src/syncEngine.ts
var StaleFolderError = class extends Error {
  constructor(segment, staleParentId) {
    super(`Stale folder parent ${staleParentId} for segment "${segment}"`);
    this.segment = segment;
    this.staleParentId = staleParentId;
    this.name = "StaleFolderError";
  }
};
var SyncEngine = class {
  constructor(vault, client, state, settings) {
    this.vault = vault;
    this.client = client;
    this.state = state;
    this.settings = settings;
    /**
     * Transient cache for folder pages we *found* (but didn't create) during the
     * current sync session.  Keyed by vault-relative dir path → Confluence page ID.
     * NOT persisted — does NOT contribute to pull's "known folder" set, so pages
     * under externally-managed folders (e.g. "Old") are never auto-pulled.
     */
    __publicField(this, "_foundFolderCache", /* @__PURE__ */ new Map());
    /**
     * Basenames that appear in more than one directory under the sync root.
     * When a basename is in this set, titleFromFile() prefixes it with the
     * immediate parent directory so the Confluence page title is unique within
     * the space. (Confluence enforces space-wide title uniqueness.)
     * Local filenames are never affected — only the Confluence page title.
     */
    __publicField(this, "_ambiguousBasenames", /* @__PURE__ */ new Set());
  }
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
  contextDirForFile(file) {
    var _a, _b;
    return ((_b = (_a = file.parent) == null ? void 0 : _a.name) != null ? _b : "").toLowerCase();
  }
  buildTitleToUrl() {
    const base = this.settings.confluenceBaseUrl.replace(/\/$/, "");
    const map = /* @__PURE__ */ new Map();
    for (const record of Object.values(this.state.all())) {
      const url = `${base}/pages/viewpage.action?pageId=${record.confluencePageId}`;
      map.set(record.confluenceTitle.trim().toLowerCase(), url);
    }
    return map;
  }
  async sync() {
    const result = {
      pushed: [],
      pulled: [],
      deleted: [],
      conflicts: [],
      errors: []
    };
    const direction = this.settings.syncDirection;
    console.log(`[ConfluenceSync] Starting sync. Direction: ${direction}, Vault dir: "${this.settings.vaultDirectory}"`);
    this._foundFolderCache.clear();
    const localFiles = await this.collectLocalFiles();
    console.log(`[ConfluenceSync] Found ${localFiles.length} local markdown file(s):`, localFiles.map((f) => f.path));
    this._ambiguousBasenames = this.computeAmbiguousBasenames(localFiles);
    await this.preRenameStalePages(localFiles);
    if (direction === "both" || direction === "push") {
      await this.deleteObsoletePages(localFiles, result);
      if (result.deleted.length > 0) {
        console.log(`[ConfluenceSync] Deleted ${result.deleted.length} obsolete page(s):`, result.deleted);
      }
    }
    if (direction === "both" || direction === "push") {
      const isWaypoint = (f) => {
        const parts = f.path.split("/");
        const parentDir = parts.length >= 2 ? parts[parts.length - 2] : "";
        return parentDir === f.basename;
      };
      const nonWaypoints = localFiles.filter((f) => !isWaypoint(f));
      const waypoints = localFiles.filter((f) => isWaypoint(f));
      const orderedFiles = [...nonWaypoints, ...waypoints];
      for (const file of orderedFiles) {
        if (this.isExcluded(file.path)) {
          console.log(`[ConfluenceSync] \u23ED Excluded: ${file.path}`);
          continue;
        }
        try {
          console.log(`[ConfluenceSync] Pushing: ${file.path}`);
          const pushed = await this.pushFile(file, result);
          if (pushed) {
            result.pushed.push(file.path);
            console.log(`[ConfluenceSync] \u2705 Pushed: ${file.path}`);
          } else {
            console.log(`[ConfluenceSync] \u23ED Skipped (no change): ${file.path}`);
          }
        } catch (e) {
          console.error(`[ConfluenceSync] \u274C Push failed for ${file.path}:`, e);
          result.errors.push({ path: file.path, error: String(e) });
        }
      }
    }
    let remotePages = [];
    if (direction === "both" || direction === "pull") {
      try {
        remotePages = await this.fetchRemotePages();
        console.log(`[ConfluenceSync] Found ${remotePages.length} remote page(s):`, remotePages.map((p) => p.title));
      } catch (e) {
        console.error(`[ConfluenceSync] Failed to fetch remote pages:`, e);
        result.errors.push({ path: "<remote>", error: String(e) });
        return result;
      }
    }
    if (direction === "both" || direction === "pull") {
      await this.seedFolderMapFromRemoteAncestors(remotePages);
      for (const page of remotePages) {
        const prospectivePath = this.buildLocalPathFromAncestors(
          page.title,
          page.ancestorIds,
          page.ancestorTitles
        );
        const prospectiveDir = prospectivePath.split("/").slice(0, -1).join("/");
        if (this.isExcluded(prospectivePath) || this.isExcluded(prospectiveDir)) {
          console.log(`[ConfluenceSync] \u23ED Excluded (pull): ${page.title}`);
          continue;
        }
        try {
          const pulled = await this.pullPage(page, result, page.ancestorIds, page.ancestorTitles);
          if (pulled) result.pulled.push(page.title);
        } catch (e) {
          console.error(`[ConfluenceSync] \u274C Pull failed for "${page.title}":`, e);
          result.errors.push({
            path: page.title,
            error: String(e)
          });
        }
      }
    }
    await this.state.save();
    console.log(`[ConfluenceSync] Done. Pushed: ${result.pushed.length}, Pulled: ${result.pulled.length}, Deleted: ${result.deleted.length}, Conflicts: ${result.conflicts.length}, Errors: ${result.errors.length}`);
    return result;
  }
  // ── Local → Remote ────────────────────────────────────────────────────
  async pushFile(file, result, force = false) {
    var _a, _b, _c;
    const content = await this.vault.read(file);
    if (content.includes("<<<<<<< LOCAL") || content.includes(">>>>>>> CONFLUENCE")) {
      throw new Error(
        `"${file.basename}" has unresolved conflict markers. Resolve them before syncing.`
      );
    }
    const record = this.state.get(file.path);
    if (!record) {
      const title2 = this.titleFromFile(file);
      const movedFrom = this.findRecordByTitle(title2);
      if (movedFrom && !this.vault.getAbstractFileByPath(movedFrom.path)) {
        const { path: oldPath, record: oldRecord } = movedFrom;
        console.log(`[ConfluenceSync] Detected move: "${oldPath}" \u2192 "${file.path}"`);
        const newParentId = await this.resolveParentId(file);
        let remotePage2;
        try {
          remotePage2 = await this.client.getPage(oldRecord.confluencePageId);
        } catch (e) {
          if (String(e).includes("404") || String(e).includes("not found")) {
            this.state.delete(oldPath);
            return this.pushFile(file, result);
          }
          throw e;
        }
        const storageBody2 = preserveInlineCommentMarkers(
          remotePage2.body,
          markdownToConfluenceStorage(content, this.buildTitleToUrl(), this.contextDirForFile(file))
        );
        const parentToUse = newParentId != null ? newParentId : remotePage2.parentId;
        console.log(`[ConfluenceSync] Re-parenting "${title2}" from parent ${oldRecord.confluenceParentId} \u2192 ${parentToUse}`);
        const page2 = await this.client.updatePage(
          oldRecord.confluencePageId,
          title2,
          storageBody2,
          remotePage2.version,
          parentToUse
        );
        this.state.delete(oldPath);
        this.state.set(file.path, {
          confluencePageId: page2.id,
          confluenceTitle: page2.title,
          confluenceVersion: page2.version,
          confluenceParentId: page2.parentId,
          lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
          contentHash: SyncStateManager.hash(storageBody2)
        });
        await this.uploadPageImages(page2.id, content, file);
        await this.refreshLocalComments(file, page2.id);
        return true;
      }
    }
    if (!record) {
      const expectedParentId2 = await this.resolveParentId(file);
      const titleToUrl = this.buildTitleToUrl();
      const storageBody2 = markdownToConfluenceStorage(content, titleToUrl, this.contextDirForFile(file));
      const title2 = this.titleFromFile(file);
      const folderPageForSameName = expectedParentId2 ? await this.client.getPageByTitle(title2, void 0).then(
        (p) => p && p.id === expectedParentId2 ? p : null
      ).catch(() => null) : null;
      if (folderPageForSameName) {
        console.log(`[ConfluenceSync] File shares name with its folder page \u2014 updating folder page ${folderPageForSameName.id} with content`);
        const updated = await this.client.updatePage(
          folderPageForSameName.id,
          title2,
          storageBody2,
          folderPageForSameName.version,
          folderPageForSameName.parentId
        );
        this.state.set(file.path, {
          confluencePageId: updated.id,
          confluenceTitle: updated.title,
          confluenceVersion: updated.version,
          confluenceParentId: updated.parentId,
          lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
          contentHash: SyncStateManager.hash(storageBody2)
        });
        await this.refreshLocalComments(file, updated.id);
        return true;
      }
      let page2;
      try {
        page2 = await this.client.createPage(title2, storageBody2, expectedParentId2);
      } catch (e) {
        if (this.isParentNotExistError(e) || e instanceof StaleFolderError) {
          this.evictStaleFolderEntries(expectedParentId2);
          console.warn(
            `[ConfluenceSync] Parent page deleted for "${file.path}" \u2014 evicting stale folder entries and retrying`
          );
          return this.pushFile(file, result);
        }
        if (String(e).includes("already exists")) {
          const existing = (_a = await this.client.getPageByTitle(title2, expectedParentId2)) != null ? _a : await this.client.getPageByTitle(title2);
          if (existing) {
            const alreadyOwned = this.state.findByPageId(existing.id);
            if (alreadyOwned && alreadyOwned !== file.path) {
              const otherFile = this.vault.getAbstractFileByPath(alreadyOwned);
              console.log(
                `[ConfluenceSync] Displacement check: alreadyOwned="${alreadyOwned}" otherFile=${otherFile ? "found (" + otherFile.constructor.name + ")" : "NOT FOUND"} existing.title="${existing.title}"`
              );
              if (otherFile instanceof import_obsidian3.TFile) {
                const otherNewTitle = this.titleFromFile(otherFile);
                console.log(`[ConfluenceSync] Displacement otherNewTitle="${otherNewTitle}" vs existing.title="${existing.title}"`);
                if (otherNewTitle !== existing.title) {
                  console.log(
                    `[ConfluenceSync] Renaming displaced page "${existing.title}" \u2192 "${otherNewTitle}" (owned by "${alreadyOwned}") to free up title for "${file.path}"`
                  );
                  const updated = await this.client.updatePage(
                    existing.id,
                    otherNewTitle,
                    existing.body,
                    existing.version,
                    existing.parentId
                  );
                  const otherRecord = this.state.get(alreadyOwned);
                  this.state.set(alreadyOwned, {
                    ...otherRecord,
                    confluenceTitle: updated.title,
                    confluenceVersion: updated.version
                  });
                  return this.pushFile(file, result);
                }
              }
              throw new Error(
                `Confluence page "${title2}" (${existing.id}) is already linked to "${alreadyOwned}". Rename one of the files to give it a unique title.`
              );
            }
            console.log(`[ConfluenceSync] Linking "${title2}" to existing page ${existing.id}`);
            this.state.set(file.path, {
              confluencePageId: existing.id,
              confluenceTitle: existing.title,
              confluenceVersion: existing.version,
              confluenceParentId: existing.parentId,
              lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
              contentHash: SyncStateManager.hash(storageBody2)
            });
            await this.refreshLocalComments(file, existing.id);
            return true;
          }
        }
        throw e;
      }
      this.state.set(file.path, {
        confluencePageId: page2.id,
        confluenceTitle: page2.title,
        confluenceVersion: page2.version,
        confluenceParentId: page2.parentId,
        lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
        contentHash: SyncStateManager.hash(storageBody2)
      });
      await this.uploadPageImages(page2.id, content, file);
      await this.refreshLocalComments(file, page2.id);
      return true;
    }
    const storageBodyForCheck = markdownToConfluenceStorage(content, this.buildTitleToUrl(), this.contextDirForFile(file));
    const storageHash = SyncStateManager.hash(storageBodyForCheck);
    const localChanged = storageHash !== record.contentHash;
    const resolvedParentId = record.confluenceParentId !== void 0 ? await this.resolveParentId(file) : void 0;
    const isSameNameFolder = resolvedParentId !== void 0 && resolvedParentId === record.confluencePageId;
    if (isSameNameFolder) {
      console.log(`[ConfluenceSync] Same-name folder detected for "${file.path}" \u2014 page ${record.confluencePageId} is its own folder`);
    }
    const expectedParentId = isSameNameFolder ? record.confluenceParentId : resolvedParentId;
    const needsReparent = !isSameNameFolder && expectedParentId !== void 0 && expectedParentId !== record.confluenceParentId;
    const currentTitle = this.titleFromFile(file);
    const needsTitleRename = currentTitle !== record.confluenceTitle;
    if (needsTitleRename) {
      console.log(`[ConfluenceSync] Title rename needed for "${file.path}": "${record.confluenceTitle}" \u2192 "${currentTitle}"`);
    }
    if (!localChanged && !needsReparent && !needsTitleRename && !force) {
      if (record.confluenceParentId === void 0) {
        try {
          const remotePage2 = await this.client.getPage(record.confluencePageId);
          this.state.set(file.path, {
            ...record,
            confluenceParentId: remotePage2.parentId
          });
        } catch (e) {
          this.state.delete(file.path);
        }
      }
      return false;
    }
    let remotePage;
    try {
      remotePage = await this.client.getPage(record.confluencePageId);
    } catch (e) {
      if (String(e).includes("404") || String(e).includes("not found")) {
        console.log(`[ConfluenceSync] Remote page deleted \u2014 recreating: ${file.path}`);
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
        needsReparent ? expectedParentId : (_b = remotePage.parentId) != null ? _b : record.confluenceParentId
      );
    } catch (e) {
      if (this.isParentNotExistError(e) || e instanceof StaleFolderError) {
        const parentId = needsReparent ? expectedParentId : (_c = remotePage.parentId) != null ? _c : record.confluenceParentId;
        this.evictStaleFolderEntries(parentId);
        this.state.delete(file.path);
        console.warn(
          `[ConfluenceSync] Parent page deleted for "${file.path}" \u2014 evicting stale folder entries and retrying`
        );
        return this.pushFile(file, result);
      }
      throw e;
    }
    this.state.set(file.path, {
      confluencePageId: page.id,
      confluenceTitle: page.title,
      confluenceVersion: page.version,
      confluenceParentId: page.parentId,
      lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
      contentHash: SyncStateManager.hash(plainStorageBody)
    });
    await this.uploadPageImages(page.id, content, file);
    await this.refreshLocalComments(file, page.id);
    return true;
  }
  /**
   * Re-fetch Confluence comments and ensure they're appended to the local file.
   * Strips any existing comments section first to avoid duplicates.
   */
  async refreshLocalComments(file, pageId) {
    try {
      const remotePage = await this.client.getPage(pageId);
      const comments = await this.client.getPageComments(pageId);
      const localRaw = await this.vault.read(file);
      const markerIdx = localRaw.indexOf(COMMENTS_SECTION_MARKER);
      const contentWithoutComments = (markerIdx !== -1 ? localRaw.substring(0, markerIdx) : localRaw).trimEnd();
      const commentsSection = comments.length > 0 ? formatCommentsAsMarkdown(comments, remotePage.body, contentWithoutComments) : "";
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
  async pushFileDirect(file, force = false) {
    var _a;
    this._foundFolderCache.clear();
    this._ambiguousBasenames = this.computeAmbiguousBasenames(await this.collectLocalFiles());
    const result = { pushed: [], pulled: [], deleted: [], conflicts: [], errors: [] };
    try {
      if (force) {
        const record = this.state.get(file.path);
        let pageId;
        if (record) {
          pageId = record.confluencePageId;
        } else {
          const existing = await this.client.getPageByTitle(file.basename);
          if (existing) pageId = existing.id;
        }
        if (pageId) {
          const remotePage = await this.client.getPage(pageId);
          const remoteChanged = !record || record.confluenceVersion < remotePage.version;
          if (remoteChanged) {
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
            const localContent = (markerIdx !== -1 ? localRaw.substring(0, markerIdx) : localRaw).trimEnd();
            const remoteContent = remoteMarkdown.trimEnd();
            const finalContent = [
              "<<<<<<< LOCAL",
              localContent,
              "=======",
              remoteContent,
              ">>>>>>> CONFLUENCE",
              commentsSection
            ].join("\n");
            await this.vault.modify(file, finalContent);
            this.state.set(file.path, {
              confluencePageId: remotePage.id,
              confluenceTitle: remotePage.title,
              confluenceVersion: remotePage.version,
              confluenceParentId: remotePage.parentId,
              lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
              contentHash: (_a = record == null ? void 0 : record.contentHash) != null ? _a : ""
            });
            result.conflicts.push(file.path);
            console.log(`[ConfluenceSync] Force push "${file.path}": remote v${remotePage.version} > synced v${record == null ? void 0 : record.confluenceVersion} \u2014 conflict markers inserted, push aborted`);
            await this.state.save();
            return result;
          }
          console.log(`[ConfluenceSync] Force push "${file.path}": remote v${remotePage.version} matches synced version \u2014 proceeding with push`);
        }
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
  async pullFileDirect(file) {
    this._foundFolderCache.clear();
    const result = { pushed: [], pulled: [], deleted: [], conflicts: [], errors: [] };
    try {
      const record = this.state.get(file.path);
      let pageId;
      if (record) {
        pageId = record.confluencePageId;
      } else {
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
      let commentsSection = "";
      try {
        const comments = await this.client.getPageComments(pageId);
        if (comments.length > 0) {
          commentsSection = formatCommentsAsMarkdown(comments, remotePage.body, remoteMarkdown);
        }
      } catch (e) {
        console.warn(`[ConfluenceSync] Failed to fetch comments for pull:`, e);
      }
      const localRaw = await this.vault.read(file);
      const markerIdx = localRaw.indexOf(COMMENTS_SECTION_MARKER);
      const localContent = (markerIdx !== -1 ? localRaw.substring(0, markerIdx) : localRaw).trimEnd();
      const remoteChanged = !record || record.confluenceVersion < remotePage.version;
      let finalContent;
      if (!remoteChanged) {
        finalContent = localContent + commentsSection;
        console.log(`[ConfluenceSync] Force pull "${file.path}": remote v${remotePage.version} matches synced version, refreshing comments`);
      } else {
        const remoteContent = remoteMarkdown.trimEnd();
        finalContent = [
          "<<<<<<< LOCAL",
          localContent,
          "=======",
          remoteContent,
          ">>>>>>> CONFLUENCE",
          commentsSection
        ].join("\n");
        result.conflicts.push(file.path);
        console.log(`[ConfluenceSync] Force pull "${file.path}": remote v${remotePage.version} > synced v${record == null ? void 0 : record.confluenceVersion} \u2014 conflict markers inserted`);
      }
      await this.vault.modify(file, finalContent);
      const roundTripStorage = markdownToConfluenceStorage(finalContent);
      const stableHash = SyncStateManager.hash(roundTripStorage);
      this.state.set(file.path, {
        confluencePageId: remotePage.id,
        confluenceTitle: remotePage.title,
        confluenceVersion: remotePage.version,
        confluenceParentId: remotePage.parentId,
        lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
        contentHash: stableHash
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
  async pullPage(page, result, ancestorIds = [], ancestorTitles = []) {
    const allFolderPageIds = new Set(Object.values(this.state.allFolders()));
    if (allFolderPageIds.has(page.id) && !this.state.findByPageId(page.id)) {
      return false;
    }
    const remoteHash = SyncStateManager.hash(page.body);
    const localPath = this.state.findByPageId(page.id);
    if (localPath) {
      const record = this.state.get(localPath);
      const file = this.vault.getAbstractFileByPath(localPath);
      const contentChanged = record.confluenceVersion < page.version;
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
        if (file instanceof import_obsidian3.TFile) {
          const localContent = await this.vault.read(file);
          const localStorageHash = SyncStateManager.hash(markdownToConfluenceStorage(localContent));
          const localChanged = localStorageHash !== record.contentHash;
          if (localChanged) {
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
        if (file instanceof import_obsidian3.TFile) {
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
          lastSyncedAt: (/* @__PURE__ */ new Date()).toISOString(),
          contentHash: stableHash
        });
        return true;
      }
      if (commentsSection && file instanceof import_obsidian3.TFile) {
        const localContent = await this.vault.read(file);
        const markerIdx = localContent.indexOf(COMMENTS_SECTION_MARKER);
        const existingComments = markerIdx !== -1 ? localContent.substring(markerIdx - 1) : "";
        const newComments = commentsSection;
        if (existingComments.trimEnd() !== newComments.trimEnd()) {
          const contentWithoutComments = markerIdx !== -1 ? localContent.substring(0, markerIdx).trimEnd() : localContent.trimEnd();
          await this.vault.modify(file, contentWithoutComments + newComments);
          return true;
        }
      }
      return false;
    }
    console.log(`[ConfluenceSync] \u23ED No local file for remote page "${page.title}" (${page.id}) \u2014 skipping (local is structure master)`);
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
  async seedFolderMapFromRemoteAncestors(remotePages) {
    const rootParentId = this.settings.confluenceParentPageId;
    const root = this.resolveSyncRoot();
    const existingFolderIds = new Set(Object.values(this.state.allFolders()));
    const toRegister = /* @__PURE__ */ new Map();
    for (const page of remotePages) {
      const startIdx = rootParentId ? page.ancestorIds.indexOf(rootParentId) : -1;
      if (startIdx < 0) continue;
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
        accPath = (0, import_obsidian3.normalizePath)(`${accPath}/${safeTitle}`);
        if (!this.state.getFolder(accPath)) {
          console.log(`[ConfluenceSync] Seeding folderMap: "${title}" (${id}) \u2192 ${accPath}`);
          this.state.setFolder(accPath, id);
        }
      }
    }
  }
  async collectLocalFiles() {
    let folderPath = this.settings.vaultDirectory;
    const vaultBasePath = this.vault.adapter.basePath;
    if (vaultBasePath && folderPath.startsWith(vaultBasePath)) {
      folderPath = folderPath.slice(vaultBasePath.length).replace(/^\//, "");
    }
    const folder = (0, import_obsidian3.normalizePath)(folderPath);
    console.log(`[ConfluenceSync] Resolved vault folder: "${folder}"`);
    const abstractFolder = this.vault.getAbstractFileByPath(folder);
    if (!(abstractFolder instanceof import_obsidian3.TFolder)) return [];
    const files = [];
    const recurse = (f) => {
      for (const child of f.children) {
        if (child instanceof import_obsidian3.TFile && child.extension === "md") {
          files.push(child);
        } else if (child instanceof import_obsidian3.TFolder) {
          recurse(child);
        }
      }
    };
    recurse(abstractFolder);
    return files;
  }
  async fetchRemotePages() {
    const rootParentId = this.settings.confluenceParentPageId;
    const children = await this.client.listPages(
      rootParentId || void 0
    );
    const folderPageIds = /* @__PURE__ */ new Set([
      ...Object.values(this.state.allFolders()),
      ...this._foundFolderCache.values()
    ]);
    const pages = [];
    for (const c of children) {
      if (folderPageIds.has(c.id)) {
        continue;
      }
      if (rootParentId && !c.ancestorIds.includes(rootParentId)) {
        continue;
      }
      try {
        const fullPage = await this.client.getPage(c.id);
        pages.push({
          ...fullPage,
          ancestorIds: c.ancestorIds,
          ancestorTitles: c.ancestorTitles
        });
      } catch (e) {
      }
    }
    return pages;
  }
  /**
   * Before the main sync loop, rename any Confluence pages whose stored title
   * no longer matches what titleFromFile() now computes. This ensures the title
   * space is clean before any creates run, regardless of processing order.
   */
  async preRenameStalePages(files) {
    for (const file of files) {
      const record = this.state.get(file.path);
      if (!record) continue;
      const currentTitle = this.titleFromFile(file);
      if (currentTitle === record.confluenceTitle) continue;
      console.warn(
        `[ConfluenceSync] Pre-rename: "${file.path}" "${record.confluenceTitle}" \u2192 "${currentTitle}"`
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
          confluenceVersion: updated.version
        });
        console.warn(`[ConfluenceSync] Pre-rename done: "${currentTitle}"`);
      } catch (e) {
        console.error(`[ConfluenceSync] Pre-rename failed for "${file.path}":`, e);
      }
    }
  }
  titleFromFile(file) {
    if (this._ambiguousBasenames.has(file.basename)) {
      const parts = file.path.split("/");
      const parentDir = parts.length >= 2 ? parts[parts.length - 2] : "";
      const isWaypoint = parentDir === file.basename;
      const title = parentDir && !isWaypoint ? `${parentDir}/${file.basename}` : file.basename;
      console.log(`[ConfluenceSync] titleFromFile: "${file.path}" \u2192 "${title}" (ambiguous; parentDir="${parentDir}" isWaypoint=${isWaypoint})`);
      return title;
    }
    return file.basename;
  }
  /** Returns the set of basenames that appear in more than one directory. */
  computeAmbiguousBasenames(files) {
    var _a;
    const counts = /* @__PURE__ */ new Map();
    for (const f of files) {
      counts.set(f.basename, ((_a = counts.get(f.basename)) != null ? _a : 0) + 1);
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
  findRecordByTitle(title) {
    const all = this.state.all();
    for (const [path, record] of Object.entries(all)) {
      if (record.confluenceTitle === title) {
        return { path, record };
      }
    }
    return null;
  }
  buildLocalPath(title) {
    const dir = this.resolveSyncRoot();
    const safeName = title.replace(/[/\\:*?"<>|]/g, "-");
    return (0, import_obsidian3.normalizePath)(`${dir}/${safeName}.md`);
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
  buildLocalPathFromAncestors(title, ancestorIds, ancestorTitles) {
    const root = this.resolveSyncRoot();
    const rootParentId = this.settings.confluenceParentPageId;
    let startIdx = -1;
    if (rootParentId) {
      startIdx = ancestorIds.indexOf(rootParentId);
    }
    const relSegments = startIdx >= 0 ? ancestorTitles.slice(startIdx + 1) : [];
    const safeName = title.replace(/[/\\:*?"<>|]/g, "-");
    const safeSegments = relSegments.map((s) => s.replace(/[/\\:*?"<>|]/g, "-"));
    const parts = [root, ...safeSegments, `${safeName}.md`];
    return (0, import_obsidian3.normalizePath)(parts.join("/"));
  }
  async ensureFolder(filePath) {
    const parts = filePath.split("/");
    parts.pop();
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
  async resolveParentId(file) {
    var _a, _b;
    const rootParentId = this.settings.confluenceParentPageId || void 0;
    let rootFolder = this.settings.vaultDirectory;
    const vaultBasePath = this.vault.adapter.basePath;
    if (vaultBasePath && rootFolder.startsWith(vaultBasePath)) {
      rootFolder = rootFolder.slice(vaultBasePath.length).replace(/^\//, "");
    }
    rootFolder = (0, import_obsidian3.normalizePath)(rootFolder);
    const fileDir = (0, import_obsidian3.normalizePath)((_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "");
    if (fileDir === rootFolder) {
      return rootParentId;
    }
    const relativePath = fileDir.slice(rootFolder.length).replace(/^\//, "");
    const segments = relativePath.split("/").filter(Boolean);
    let currentParentId = rootParentId;
    let accumulatedPath = rootFolder;
    for (const segment of segments) {
      accumulatedPath = (0, import_obsidian3.normalizePath)(`${accumulatedPath}/${segment}`);
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
      const existing = await this.client.getPageByTitle(segment, currentParentId);
      if (existing) {
        const localDirExists = !!this.vault.getAbstractFileByPath(accumulatedPath);
        if (localDirExists) {
          this.state.setFolder(accumulatedPath, existing.id);
          console.log(`[ConfluenceSync] Found folder page "${segment}" (${existing.id}) \u2014 persisted (local dir exists)`);
        } else {
          this._foundFolderCache.set(accumulatedPath, existing.id);
          console.log(`[ConfluenceSync] Found (unmanaged) folder page "${segment}" (${existing.id}) \u2014 not persisted`);
        }
        currentParentId = existing.id;
        continue;
      }
      let folderPage;
      try {
        folderPage = await this.client.createPage(
          segment,
          "<p></p>",
          currentParentId
        );
      } catch (e) {
        if (this.isParentNotExistError(e)) {
          this.evictStaleFolderEntries(currentParentId);
          console.warn(
            `[ConfluenceSync] Stale folder parent ID ${currentParentId} evicted \u2014 will retry`
          );
          throw new StaleFolderError(segment, currentParentId);
        }
        if (String(e).includes("already exists")) {
          try {
            const parentPage = currentParentId ? await this.client.getPage(currentParentId).catch(() => null) : null;
            const parentTitle = parentPage ? parentPage.title : null;
            const disambigTitle = parentTitle ? `${parentTitle}/${segment}` : `${segment}`;
            const newFolder = await this.client.createPage(disambigTitle, "<p></p>", currentParentId);
            this.state.setFolder(accumulatedPath, newFolder.id);
            currentParentId = newFolder.id;
            console.warn(
              `[ConfluenceSync] Created disambiguated folder page "${disambigTitle}" (${newFolder.id}) for local dir ${accumulatedPath}`
            );
            continue;
          } catch (e2) {
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
      this.state.setFolder(accumulatedPath, folderPage.id);
      currentParentId = folderPage.id;
      console.log(`[ConfluenceSync] Created folder page "${segment}" (${folderPage.id})`);
    }
    return currentParentId;
  }
  /** Resolve the vault-relative root sync folder. */
  resolveSyncRoot() {
    let rootFolder = this.settings.vaultDirectory;
    const vaultBasePath = this.vault.adapter.basePath;
    if (vaultBasePath && rootFolder.startsWith(vaultBasePath)) {
      rootFolder = rootFolder.slice(vaultBasePath.length).replace(/^\//, "");
    }
    return (0, import_obsidian3.normalizePath)(rootFolder);
  }
  /**
   * Delete Confluence pages for any tracked files that no longer exist locally.
   * Also cleans up folder pages whose local directory has been removed.
   * Only called when direction is "both" or "push" (local vault is master).
   */
  async deleteObsoletePages(localFiles, result) {
    const localPathSet = new Set(localFiles.map((f) => f.path));
    const allRecords = this.state.all();
    for (const [vaultPath, record] of Object.entries(allRecords)) {
      if (localPathSet.has(vaultPath)) continue;
      if (this.isExcluded(vaultPath)) continue;
      console.log(
        `[ConfluenceSync] Deleting obsolete Confluence page "${record.confluenceTitle}" (${record.confluencePageId}) \u2014 local file removed: ${vaultPath}`
      );
      try {
        await this.client.deletePage(record.confluencePageId);
        result.deleted.push(vaultPath);
      } catch (e) {
        if (!String(e).includes("404") && !String(e).includes("not found")) {
          console.error(`[ConfluenceSync] Failed to delete page ${record.confluencePageId}:`, e);
          result.errors.push({ path: vaultPath, error: String(e) });
          continue;
        }
        console.log(`[ConfluenceSync] Page ${record.confluencePageId} already deleted in Confluence`);
      }
      this.state.delete(vaultPath);
    }
    const allFolders = this.state.allFolders();
    const folderPaths = Object.keys(allFolders).sort((a, b) => b.length - a.length);
    for (const dirPath of folderPaths) {
      const localDir = this.vault.getAbstractFileByPath(dirPath);
      if (localDir) continue;
      const folderId = allFolders[dirPath];
      console.log(
        `[ConfluenceSync] Deleting obsolete Confluence folder page (${folderId}) \u2014 local directory removed: ${dirPath}`
      );
      try {
        await this.client.deletePage(folderId);
      } catch (e) {
        if (!String(e).includes("404") && !String(e).includes("not found")) {
          console.error(`[ConfluenceSync] Failed to delete folder page ${folderId}:`, e);
          result.errors.push({ path: dirPath, error: String(e) });
        }
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
  async deleteUnmanagedLocalFiles() {
    var _a, _b;
    const root = this.resolveSyncRoot();
    const managedFolderPaths = new Set(Object.keys(this.state.allFolders()));
    const deleted = [];
    const allLocal = await this.collectLocalFiles();
    for (const file of allLocal) {
      const fileDir = (0, import_obsidian3.normalizePath)((_b = (_a = file.parent) == null ? void 0 : _a.path) != null ? _b : "");
      if (fileDir === root) continue;
      if (!managedFolderPaths.has(fileDir)) {
        console.log(`[ConfluenceSync] Deleting unmanaged local file: ${file.path}`);
        this.state.delete(file.path);
        await this.vault.trash(file, true);
        deleted.push(file.path);
      }
    }
    await this.cleanupEmptyUnmanagedFolders(root, managedFolderPaths);
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
  async cleanupEmptyUnmanagedFolders(root, managedFolderPaths) {
    const rootFolder = this.vault.getAbstractFileByPath(root);
    if (!(rootFolder instanceof import_obsidian3.TFolder)) return;
    const recurse = async (folder) => {
      let hasChildren = false;
      for (const child of [...folder.children]) {
        if (child instanceof import_obsidian3.TFolder) {
          const childHasChildren = await recurse(child);
          if (childHasChildren) hasChildren = true;
        } else {
          hasChildren = true;
        }
      }
      if (folder.path === root) return hasChildren;
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
  isParentNotExistError(e) {
    const msg = String(e).toLowerCase();
    return msg.includes("does not exist") || msg.includes("parent id") || msg.includes("parentid") || msg.includes("parent page") || // Confluence REST API returns 400 with this message
    msg.includes("the parent id specified does not exist");
  }
  /**
   * Evict all folderMap entries whose stored Confluence page ID matches
   * `staleId`, plus any transient cache entries.  Called when Confluence
   * signals that a parent page no longer exists so that the next resolve
   * attempt re-discovers or re-creates the folder page fresh.
   */
  evictStaleFolderEntries(staleId) {
    if (!staleId) return;
    for (const [dirPath, pageId] of Object.entries(this.state.allFolders())) {
      if (pageId === staleId) {
        this.state.deleteFolder(dirPath);
        console.warn(`[ConfluenceSync] Evicted stale folderMap entry: ${dirPath} \u2192 ${pageId}`);
      }
    }
    for (const [dirPath, pageId] of this._foundFolderCache.entries()) {
      if (pageId === staleId) {
        this._foundFolderCache.delete(dirPath);
      }
    }
  }
  /** Returns true if the given vault-relative path is excluded from sync. */
  isExcluded(path) {
    var _a;
    const excluded = (_a = this.settings.excludedPaths) != null ? _a : [];
    return excluded.some(
      (ex) => path === ex || path.startsWith(ex + "/")
    );
  }
  /**
   * Upload all images embedded in `markdown` as attachments on `pageId`.
   * Silently skips images that cannot be found in the vault.
   */
  async uploadPageImages(pageId, markdown, sourceFile) {
    var _a;
    const imageFilenames = extractEmbeddedImages(markdown);
    if (imageFilenames.length === 0) return;
    for (const filename of imageFilenames) {
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
        const mimeTypes = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          svg: "image/svg+xml",
          webp: "image/webp",
          bmp: "image/bmp",
          ico: "image/x-icon"
        };
        const mimeType = (_a = mimeTypes[ext]) != null ? _a : "application/octet-stream";
        await this.client.uploadAttachment(pageId, imageFile.name, data, mimeType);
        console.log(`[ConfluenceSync] Uploaded attachment: ${imageFile.name} \u2192 page ${pageId}`);
      } catch (e) {
        console.error(`[ConfluenceSync] Failed to upload attachment ${filename}:`, e);
      }
    }
  }
};

// src/main.ts
var CONFLUENCE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="currentColor" d="M2.3 16.9c-.3.5-.1 1.1.4 1.4l4.4 2.5c.5.3 1.1.1 1.4-.4.9-1.5 2.4-2.4 4.1-2.4s3.2.9 4.1 2.4c.3.5.9.7 1.4.4l4.4-2.5c.5-.3.7-.9.4-1.4C20.4 13.6 16.5 11 12 11s-8.4 2.6-9.7 5.9zM21.7 7.1c.3-.5.1-1.1-.4-1.4l-4.4-2.5c-.5-.3-1.1-.1-1.4.4C14.6 5 13.1 6 11.4 6s-3.2-.9-4.1-2.4C7 3 6.4 2.8 5.9 3.1L1.5 5.6c-.5.3-.7.9-.4 1.4C3.4 10.3 7.3 13 11.8 13s8.4-2.7 9.9-5.9z"/>
</svg>`;
var ConfluenceSyncPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "settings");
    __publicField(this, "client", null);
    __publicField(this, "stateManager");
    __publicField(this, "autoSyncTimer", null);
  }
  async onload() {
    await this.loadSettings();
    this.stateManager = new SyncStateManager(this);
    await this.stateManager.load();
    (0, import_obsidian4.addIcon)("confluence", CONFLUENCE_ICON);
    this.addRibbonIcon("confluence", "Sync with Confluence", async () => {
      await this.runSync();
    });
    this.addCommand({
      id: "confluence-sync-all",
      name: "Sync all (push & pull)",
      callback: async () => {
        await this.runSync("both");
      }
    });
    this.addCommand({
      id: "confluence-push",
      name: "Push to Confluence",
      callback: async () => {
        await this.runSync("push");
      }
    });
    this.addCommand({
      id: "confluence-pull",
      name: "Pull from Confluence",
      callback: async () => {
        await this.runSync("pull");
      }
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
      }
    });
    this.addCommand({
      id: "confluence-force-push-current",
      name: "Force push current file (reconcile with Confluence first)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) {
          this.pushCurrentFile(file, true);
        }
        return true;
      }
    });
    this.addCommand({
      id: "confluence-force-pull-current",
      name: "Force pull current file (reconcile with Confluence)",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) {
          this.pullCurrentFile(file);
        }
        return true;
      }
    });
    this.addCommand({
      id: "confluence-reset-sync-state",
      name: "Reset sync state (re-sync everything on next run)",
      callback: async () => {
        await this.stateManager.clearAll();
        new import_obsidian4.Notice("\u{1F5D1}\uFE0F Confluence Sync: Sync state cleared. Next sync will treat all files as new.");
      }
    });
    this.addCommand({
      id: "confluence-delete-unmanaged-files",
      name: "Delete unmanaged local files (remove bad-pull leftovers)",
      callback: async () => {
        const client = this.getClient();
        if (!client) {
          new import_obsidian4.Notice("\u26A0\uFE0F Confluence Sync: Plugin not configured.");
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
          new import_obsidian4.Notice("\u2705 Confluence Sync: No unmanaged local files found.");
        } else {
          new import_obsidian4.Notice(`\u{1F5D1}\uFE0F Confluence Sync: Deleted ${deleted.length} unmanaged file(s). Check console for details.`);
          console.log("[ConfluenceSync] Deleted unmanaged files:", deleted);
        }
      }
    });
    this.addSettingTab(new ConfluenceSyncSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, abstractFile) => {
        let syncRoot = this.settings.vaultDirectory;
        const basePath = this.app.vault.adapter.basePath;
        if (basePath && syncRoot.startsWith(basePath)) {
          syncRoot = syncRoot.slice(basePath.length).replace(/^\//, "");
        }
        if (!abstractFile.path.startsWith(syncRoot)) return;
        const isExcluded = this.isExcluded(abstractFile.path);
        const label = isExcluded ? `\u2611 Resume Confluence sync` : `\u2298 Exclude from Confluence sync`;
        menu.addItem(
          (item) => item.setTitle(label).setIcon(isExcluded ? "check-circle" : "x-circle").onClick(async () => {
            await this.toggleExclusion(abstractFile.path);
          })
        );
      })
    );
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
  isExcluded(path) {
    return this.settings.excludedPaths.some(
      (ex) => path === ex || path.startsWith(ex + "/")
    );
  }
  /** Toggle a path in/out of the exclusion list and persist. */
  async toggleExclusion(path) {
    const excluded = this.settings.excludedPaths;
    if (this.isExcluded(path)) {
      this.settings.excludedPaths = excluded.filter(
        (ex) => ex !== path && !path.startsWith(ex + "/")
      );
      new import_obsidian4.Notice(`\u2705 "${path}" will now sync with Confluence`);
    } else {
      this.settings.excludedPaths = [
        ...excluded.filter((ex) => !ex.startsWith(path + "/")),
        path
      ];
      new import_obsidian4.Notice(`\u{1F6AB} "${path}" excluded from Confluence sync`);
    }
    await this.saveSettings();
  }
  resetAutoSync() {
    this.clearAutoSync();
    const mins = this.settings.autoSyncIntervalMinutes;
    if (mins > 0) {
      this.autoSyncTimer = setInterval(
        () => this.runSync(),
        mins * 60 * 1e3
      );
    }
  }
  clearAutoSync() {
    if (this.autoSyncTimer !== null) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }
  buildClient() {
    const s = this.settings;
    if (!s.confluenceBaseUrl || !s.confluenceEmail || !s.confluenceApiToken || !s.confluenceSpaceKey) {
      this.client = null;
      return null;
    }
    this.client = new ConfluenceClient({
      baseUrl: s.confluenceBaseUrl,
      email: s.confluenceEmail,
      apiToken: s.confluenceApiToken,
      spaceKey: s.confluenceSpaceKey
    });
    return this.client;
  }
  getClient() {
    var _a;
    return (_a = this.client) != null ? _a : this.buildClient();
  }
  async testConnection() {
    const client = this.getClient();
    if (!client) {
      new import_obsidian4.Notice("\u26A0\uFE0F Confluence Sync: Please fill in all connection settings first.");
      return;
    }
    try {
      const space = await client.getSpace();
      new import_obsidian4.Notice(`\u2705 Connected to Confluence space: ${space.name} (${space.key})`);
    } catch (e) {
      new import_obsidian4.Notice(`\u274C Connection failed: ${e}`);
    }
  }
  async runSync(direction) {
    const client = this.getClient();
    if (!client) {
      new import_obsidian4.Notice(
        "\u26A0\uFE0F Confluence Sync: Configure your Confluence settings first."
      );
      return;
    }
    const overrideSettings = direction ? { ...this.settings, syncDirection: direction } : this.settings;
    const engine = new SyncEngine(
      this.app.vault,
      client,
      this.stateManager,
      overrideSettings
    );
    new import_obsidian4.Notice("\u{1F504} Confluence Sync: Starting\u2026");
    let result;
    try {
      result = await engine.sync();
    } catch (e) {
      new import_obsidian4.Notice(`\u274C Confluence Sync failed: ${e}`);
      return;
    }
    const parts = [];
    if (result.pushed.length) parts.push(`\u2191 ${result.pushed.length} pushed`);
    if (result.pulled.length) parts.push(`\u2193 ${result.pulled.length} pulled`);
    if (result.deleted.length) parts.push(`\u{1F5D1}\uFE0F ${result.deleted.length} deleted`);
    if (result.conflicts.length)
      parts.push(`\u26A1 ${result.conflicts.length} conflicts`);
    if (result.errors.length)
      parts.push(`\u274C ${result.errors.length} errors`);
    if (result.errors.length) {
      console.error("[ConfluenceSync] Errors:", result.errors);
      new import_obsidian4.Notice(`\u274C Confluence Sync error: ${result.errors[0].error}`, 1e4);
      new SyncErrorModal(this.app, result).open();
    } else if (parts.length === 0) {
      new import_obsidian4.Notice("\u2705 Confluence Sync: Everything up to date. Check the vault directory contains .md files.");
    } else {
      new import_obsidian4.Notice(`\u2705 Confluence Sync: ${parts.join(", ")}`);
    }
  }
  async pushCurrentFile(file, force = false) {
    const client = this.getClient();
    if (!client) {
      new import_obsidian4.Notice("\u26A0\uFE0F Confluence Sync: Configure your Confluence settings first.");
      return;
    }
    const engine = new SyncEngine(
      this.app.vault,
      client,
      this.stateManager,
      this.settings
    );
    new import_obsidian4.Notice(`\u{1F504} ${force ? "Reconciling & pushing" : "Pushing"} ${file.basename}\u2026`);
    try {
      const result = await engine.pushFileDirect(file, force);
      if (result.errors.length) {
        new import_obsidian4.Notice(`\u274C Push failed: ${result.errors[0].error}`);
      } else if (result.conflicts.length > 0) {
        new import_obsidian4.Notice(`\u26A0\uFE0F ${file.basename}: local and remote differ \u2014 conflict markers inserted. Resolve and push.`);
      } else if (result.pushed.length === 0) {
        new import_obsidian4.Notice(`\u23ED\uFE0F ${file.basename} is already up to date`);
      } else {
        new import_obsidian4.Notice(`\u2705 Pushed ${file.basename} to Confluence`);
      }
    } catch (e) {
      new import_obsidian4.Notice(`\u274C Push failed: ${e}`);
    }
  }
  async pullCurrentFile(file) {
    const client = this.getClient();
    if (!client) {
      new import_obsidian4.Notice("\u26A0\uFE0F Confluence Sync: Configure your Confluence settings first.");
      return;
    }
    const engine = new SyncEngine(
      this.app.vault,
      client,
      this.stateManager,
      this.settings
    );
    new import_obsidian4.Notice(`\u{1F504} Pulling ${file.basename} from Confluence\u2026`);
    try {
      const result = await engine.pullFileDirect(file);
      if (result.errors.length) {
        new import_obsidian4.Notice(`\u274C Pull failed: ${result.errors[0].error}`);
      } else if (result.pulled.length === 0) {
        new import_obsidian4.Notice(`\u23ED\uFE0F ${file.basename} \u2014 no remote page found`);
      } else if (result.conflicts.length > 0) {
        new import_obsidian4.Notice(`\u26A0\uFE0F ${file.basename}: local and remote differ \u2014 conflict markers inserted. Resolve and push.`);
      } else {
        new import_obsidian4.Notice(`\u2705 ${file.basename} is up to date (comments refreshed)`);
      }
    } catch (e) {
      new import_obsidian4.Notice(`\u274C Pull failed: ${e}`);
    }
  }
};
var SyncErrorModal = class extends import_obsidian4.Modal {
  constructor(app, result) {
    super(app);
    __publicField(this, "result");
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
};
