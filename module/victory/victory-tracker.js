import { assertTrackerPermission, TrackerPermission } from "../utils/permissions.js";
import { localizeWithFallback } from "../utils/localize.js";

export const VICTORY_UPDATE_HOOK = "pf2ePointsTrackerVictoryUpdated";

const DEFAULT_STATE = {
  entries: [],
};

const DEFAULT_VICTORY_NAME_KEY = "PF2E.PointsTracker.Victory.DefaultName";
const DEFAULT_VICTORY_NAME_FALLBACK = "Victory Entry";
const VICTORY_CHANGE_NOTIFICATION_KEY = "PF2E.PointsTracker.Victory.ChangeNotification";
const VICTORY_CHANGE_NOTIFICATION_FALLBACK = "{name} is now at {current} victory.";

function getDefaultVictoryName() {
  return localizeWithFallback(DEFAULT_VICTORY_NAME_KEY, DEFAULT_VICTORY_NAME_FALLBACK);
}

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
 * @typedef {object} VictoryEntry
 * @property {string} id
 * @property {string} name
 * @property {number} current
 * @property {number} [minValue]
 * @property {number} [maxValue]
 * @property {string} [notes]
 * @property {number | null} [updatedAt]
 * @property {number} [progressPercent]
 */

export class VictoryTracker {
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
      name: "Victory Tracker State",
      scope: "world",
      config: false,
      type: Object,
      default: duplicateData(DEFAULT_STATE),
      onChange: (value) => this._applyState(value),
    });
  }

  async initialize() {
    if (!game?.settings?.get) return;

    const stored = duplicateData(
      game.settings.get(this.moduleId, this.settingKey) ?? DEFAULT_STATE
    );
    this._applyState(stored);
    this._initialized = true;

    this._emitUpdate();
  }

  _applyState(rawState) {
    const state = duplicateData(rawState ?? DEFAULT_STATE);
    const values = Array.isArray(state.entries) ? state.entries : [];
    this.entries = new Collection(values.map((entry) => {
      const normalized = this._normalizeEntry(entry);
      return [normalized.id ?? createId(), normalized];
    }));
    Hooks?.callAll?.("pf2ePointsTrackerUpdated", { tracker: this, entries: this.getEntries() });
  }

  async _saveState() {
    assertTrackerPermission(TrackerPermission.MODIFY);
    if (!this._initialized || !game?.settings?.set) return;

    const payload = {
      entries: this.getEntries().map((entry) => ({
        id: entry.id,
        name: entry.name,
        current: entry.current,
        minValue: entry.minValue,
        maxValue: entry.maxValue,
        notes: entry.notes ?? "",
        updatedAt: entry.updatedAt ?? null,
      })),
    };

    await game.settings.set(this.moduleId, this.settingKey, payload);
    this._emitUpdate();
  }

  _emitUpdate() {
    Hooks?.callAll?.(VICTORY_UPDATE_HOOK, {
      tracker: this,
      entries: this.getEntries(),
    });
  }

  /**
   * @returns {VictoryEntry[]}
   */
  getEntries() {
    return Array.from(this.entries.values()).map((entry) => this._normalizeEntry(entry));
  }

  /**
   * @param {string} entryId
   * @returns {VictoryEntry | undefined}
   */
  getEntry(entryId) {
    const entry = this.entries.get(entryId);
    return entry ? this._normalizeEntry(entry) : undefined;
  }

  /**
   * @param {Partial<VictoryEntry>} data
   * @returns {Promise<VictoryEntry>}
   */
  async createEntry(data = {}) {
    assertTrackerPermission(TrackerPermission.MODIFY);

    const id = data.id ?? createId();
    const entry = this._normalizeEntry({
      id,
      name: data.name,
      current: data.current,
      minValue: data.minValue,
      maxValue: data.maxValue,
      notes: data.notes,
      updatedAt: Date.now(),
    });
    this.entries.set(id, entry);
    await this._saveState();
    return this.getEntry(id);
  }

  /**
   * @param {string} entryId
   * @param {Partial<VictoryEntry>} updates
   * @returns {Promise<VictoryEntry | undefined>}
   */
  async updateEntry(entryId, updates) {
    assertTrackerPermission(TrackerPermission.MODIFY);

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
    assertTrackerPermission(TrackerPermission.DELETE);

    if (!this.entries.has(entryId)) return;
    this.entries.delete(entryId);
    await this._saveState();
  }

  /**
   * @param {string} entryId
   * @param {number} delta
   * @param {object} [metadata]
   */
  async adjustVictory(entryId, delta, metadata = {}) {
    assertTrackerPermission(TrackerPermission.MODIFY);

    const entry = this.entries.get(entryId);
    if (!entry) return;
    const change = Number(delta ?? 0);
    if (!Number.isFinite(change) || change === 0) return;

    const minValue = Number.isFinite(entry.minValue) ? Number(entry.minValue) : 0;
    const maxValue = Number.isFinite(entry.maxValue) ? Number(entry.maxValue) : 0;
    const newValue = entry.current + change;
    entry.current = Math.min(Math.max(newValue, minValue), maxValue || newValue);
    entry.updatedAt = Date.now();
    this.entries.set(entryId, this._normalizeEntry(entry));
    await this._saveState();

    const notify = metadata?.notify ?? true;
    if (notify) {
      const messageTemplate = localizeWithFallback(
        VICTORY_CHANGE_NOTIFICATION_KEY,
        VICTORY_CHANGE_NOTIFICATION_FALLBACK
      );
      const message = game?.i18n?.format
        ? game.i18n.format(VICTORY_CHANGE_NOTIFICATION_KEY, {
            name: entry.name,
            current: entry.current,
          })
        : messageTemplate
            .replace("{name}", entry.name)
            .replace("{current}", entry.current);
      ui.notifications?.info(message);
    }
  }

  /**
   * Replace the current state.
   * @param {object} state
   */
  async importState(state) {
    assertTrackerPermission(TrackerPermission.IMPORT_EXPORT);

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
   * @param {Partial<VictoryEntry>} data
   * @returns {VictoryEntry}
   */
  _normalizeEntry(data) {
    const id = typeof data?.id === "string" && data.id.trim() ? data.id.trim() : createId();
    const defaultName = getDefaultVictoryName();
    const rawName = typeof data?.name === "string" && data.name.trim() ? data.name.trim() : "";
    const name = rawName && rawName !== DEFAULT_VICTORY_NAME_KEY ? rawName : defaultName;

    const minRaw = Number(data?.minValue);
    const minValue = Number.isFinite(minRaw) ? Number(minRaw) : 0;

    const maxRaw = Number(data?.maxValue);
    let maxValue = Number.isFinite(maxRaw) ? Number(maxRaw) : 0;

    const currentRaw = Number(data?.current);
    const unclampedCurrent = Number.isFinite(currentRaw) ? Number(currentRaw) : 0;

    if (maxValue && maxValue < minValue) {
      maxValue = minValue;
    }

    let current = unclampedCurrent;
    if (Number.isFinite(minValue)) current = Math.max(current, minValue);
    if (maxValue) current = Math.min(current, maxValue);

    const notes = typeof data?.notes === "string" ? data.notes.trim() : "";
    const updatedAt = Number.isFinite(data?.updatedAt) ? Number(data.updatedAt) : null;

    const progressPercent = maxValue > minValue ? ((current - minValue) / (maxValue - minValue)) * 100 : 0;

    return {
      id,
      name,
      current,
      minValue,
      maxValue,
      notes,
      updatedAt,
      progressPercent,
    };
  }
}

export function createVictoryTracker({ moduleId, settingKey }) {
  return new VictoryTracker({ moduleId, settingKey });
}
