const DEFAULT_STATE = {
  entries: [],
};

function duplicateData(data) {
  if (typeof foundry !== "undefined" && foundry?.utils?.duplicate) {
    return foundry.utils.duplicate(data);
  }
  return JSON.parse(JSON.stringify(data));
}

function createId() {
  if (typeof foundry !== "undefined" && foundry?.utils?.randomID) {
    return foundry.utils.randomID();
  }
  if (typeof crypto !== "undefined" && crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

/**
 * @typedef {object} AwarenessEntry
 * @property {string} id
 * @property {string} name
 * @property {"location" | "person" | string} category
 * @property {number} current
 * @property {number} target
 * @property {string} [notes]
 * @property {number | null} [updatedAt]
 */

export class AwarenessTracker {
  /**
   * @param {object} options
   * @param {string} options.moduleId
   * @param {string} options.settingKey
   */
  constructor({ moduleId, settingKey }) {
    this.moduleId = moduleId;
    this.settingKey = settingKey;
    this.entries = new Collection();
    this._initialized = false;
  }

  registerSettings() {
    if (!game?.settings?.register) return;

    game.settings.register(this.moduleId, this.settingKey, {
      name: "Awareness Tracker State",
      scope: "world",
      config: false,
      type: Object,
      default: duplicateData(DEFAULT_STATE),
    });
  }

  async initialize() {
    if (!game?.settings?.get) return;

    const stored = duplicateData(
      game.settings.get(this.moduleId, this.settingKey) ?? DEFAULT_STATE
    );

    const entries = Array.isArray(stored.entries) ? stored.entries : [];
    this.entries = new Collection(
      entries.map((entry) => [entry.id ?? createId(), this._normalizeEntry(entry)])
    );
    this._initialized = true;
  }

  async _saveState() {
    if (!this._initialized || !game?.settings?.set) return;

    const payload = {
      entries: this.getEntries().map((entry) => ({
        id: entry.id,
        name: entry.name,
        category: entry.category,
        current: entry.current,
        target: entry.target,
        notes: entry.notes ?? "",
        updatedAt: entry.updatedAt ?? null,
      })),
    };

    await game.settings.set(this.moduleId, this.settingKey, payload);
  }

  /**
   * @returns {AwarenessEntry[]}
   */
  getEntries() {
    return Array.from(this.entries.values()).map((entry) => this._normalizeEntry(entry));
  }

  /**
   * @param {string} entryId
   * @returns {AwarenessEntry | undefined}
   */
  getEntry(entryId) {
    const entry = this.entries.get(entryId);
    return entry ? this._normalizeEntry(entry) : undefined;
  }

  /**
   * @param {Partial<AwarenessEntry>} data
   * @returns {Promise<AwarenessEntry>}
   */
  async createEntry(data = {}) {
    const id = data.id ?? createId();
    const entry = this._normalizeEntry({
      id,
      name: data.name,
      category: data.category,
      current: data.current,
      target: data.target,
      notes: data.notes,
      updatedAt: Date.now(),
    });
    this.entries.set(id, entry);
    await this._saveState();
    return this.getEntry(id);
  }

  /**
   * @param {string} entryId
   * @param {Partial<AwarenessEntry>} updates
   * @returns {Promise<AwarenessEntry | undefined>}
   */
  async updateEntry(entryId, updates) {
    const existing = this.entries.get(entryId);
    if (!existing) return undefined;
    const merged = this._normalizeEntry({ ...existing, ...updates, id: entryId, updatedAt: Date.now() });
    this.entries.set(entryId, merged);
    await this._saveState();
    return this.getEntry(entryId);
  }

  /**
   * @param {string} entryId
   */
  async deleteEntry(entryId) {
    if (!this.entries.has(entryId)) return;
    this.entries.delete(entryId);
    await this._saveState();
  }

  /**
   * @param {string} entryId
   * @param {number} delta
   * @param {object} [metadata]
   */
  async adjustAwareness(entryId, delta, metadata = {}) {
    const entry = this.entries.get(entryId);
    if (!entry) return;
    const change = Number(delta ?? 0);
    if (!Number.isFinite(change) || change === 0) return;

    const target = Number.isFinite(entry.target) ? Number(entry.target) : 0;
    const minValue = 0;
    const maxValue = target > 0 ? target : Math.max(entry.current + change, 0);
    const newValue = entry.current + change;
    entry.current = Math.min(Math.max(newValue, minValue), maxValue || newValue);
    entry.updatedAt = Date.now();
    this.entries.set(entryId, this._normalizeEntry(entry));
    await this._saveState();

    const notify = metadata?.notify ?? false;
    if (notify && game?.i18n?.localize) {
      ui.notifications?.info(
        game.i18n.format("PF2E.PointsTracker.Awareness.ChangeNotification", {
          name: entry.name,
          current: entry.current,
        })
      );
    }
  }

  /**
   * Replace the current state.
   * @param {object} state
   */
  async importState(state) {
    const entries = Array.isArray(state?.entries) ? state.entries : [];
    this.entries = new Collection(
      entries.map((entry) => [entry.id ?? createId(), this._normalizeEntry(entry)])
    );
    await this._saveState();
  }

  /**
   * Export the current tracker state.
   * @returns {object}
   */
  exportState() {
    return {
      entries: this.getEntries(),
    };
  }

  /**
   * @param {Partial<AwarenessEntry>} data
   * @returns {AwarenessEntry}
   */
  _normalizeEntry(data) {
    const id = typeof data?.id === "string" && data.id.trim() ? data.id.trim() : createId();
    const name =
      typeof data?.name === "string" && data.name.trim()
        ? data.name.trim()
        : game?.i18n?.localize?.("PF2E.PointsTracker.Awareness.DefaultName") ?? "Awareness Entry";

    const rawCategory = typeof data?.category === "string" ? data.category.trim().toLowerCase() : "";
    const category = rawCategory === "person" ? "person" : "location";

    const targetRaw = Number(data?.target);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Number(targetRaw) : 10;

    const currentRaw = Number(data?.current);
    const currentUnclamped = Number.isFinite(currentRaw) ? Number(currentRaw) : 0;
    const current = Math.max(0, Math.min(currentUnclamped, target));

    const notes = typeof data?.notes === "string" ? data.notes.trim() : "";
    const updatedAt = Number.isFinite(data?.updatedAt) ? Number(data.updatedAt) : null;

    const progressPercent = target > 0 ? (current / target) * 100 : 0;

    return {
      id,
      name,
      category,
      current,
      target,
      notes,
      updatedAt,
      progressPercent,
    };
  }
}

export function createAwarenessTracker({ moduleId, settingKey }) {
  return new AwarenessTracker({ moduleId, settingKey });
}
