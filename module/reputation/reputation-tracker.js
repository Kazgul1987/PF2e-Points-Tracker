import { localizeWithFallback } from "../utils/localize.js";

const DEFAULT_STATE = {
  factions: [],
};

const DEFAULT_FACTION_NAME_KEY = "PF2E.PointsTracker.Reputation.DefaultName";
const DEFAULT_FACTION_NAME_FALLBACK = "Faction";

function getDefaultFactionName() {
  return localizeWithFallback(DEFAULT_FACTION_NAME_KEY, DEFAULT_FACTION_NAME_FALLBACK);
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
 * @typedef {object} ReputationFaction
 * @property {string} id
 * @property {string} name
 * @property {number} value
 * @property {number} maxValue
 * @property {number} [minValue]
 * @property {string} [description]
 * @property {string} [notes]
 * @property {boolean} [isCollapsed]
 * @property {number} [updatedAt]
 */

export class ReputationTracker {
  /**
   * @param {object} options
   * @param {string} options.moduleId
   * @param {string} options.settingKey
   */
  constructor({ moduleId, settingKey }) {
    this.moduleId = moduleId;
    this.settingKey = settingKey;
    this.factions = new Collection();
    this._initialized = false;
  }

  registerSettings() {
    if (!game?.settings?.register) return;

    game.settings.register(this.moduleId, this.settingKey, {
      name: "Reputation Tracker State",
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

    const factions = Array.isArray(stored.factions) ? stored.factions : [];
    this.factions = new Collection(
      factions.map((faction) => [faction.id, this._normalizeFaction(faction)])
    );
    this._initialized = true;
  }

  async _saveState() {
    if (!this._initialized || !game?.settings?.set) return;

    const payload = {
      factions: this.getFactions().map((faction) => ({
        id: faction.id,
        name: faction.name,
        value: faction.value,
        maxValue: faction.maxValue,
        minValue: faction.minValue,
        description: faction.description ?? "",
        notes: faction.notes ?? "",
        isCollapsed: faction.isCollapsed ?? false,
        updatedAt: faction.updatedAt ?? null,
      })),
    };

    await game.settings.set(this.moduleId, this.settingKey, payload);
  }

  /**
   * @returns {ReputationFaction[]}
   */
  getFactions() {
    return Array.from(this.factions.values()).map((faction) =>
      this._normalizeFaction(faction)
    );
  }

  /**
   * @param {string} factionId
   * @returns {ReputationFaction | undefined}
   */
  getFaction(factionId) {
    const faction = this.factions.get(factionId);
    return faction ? this._normalizeFaction(faction) : undefined;
  }

  /**
   * @param {Partial<ReputationFaction>} data
   * @returns {Promise<ReputationFaction>}
   */
  async createFaction(data = {}) {
    const id = data.id ?? createId();
    const faction = this._normalizeFaction({
      id,
      name: (() => {
        const defaultName = getDefaultFactionName();
        if (typeof data.name === "string" && data.name.trim()) {
          const trimmed = data.name.trim();
          return trimmed === DEFAULT_FACTION_NAME_KEY ? defaultName : trimmed;
        }
        return defaultName;
      })(),
      value: data.value,
      maxValue: data.maxValue,
      minValue: data.minValue,
      description: data.description,
      notes: data.notes,
      isCollapsed: data.isCollapsed,
    });
    this.factions.set(id, faction);
    await this._saveState();
    return this.getFaction(id);
  }

  /**
   * @param {string} factionId
   * @param {Partial<ReputationFaction>} updates
   * @returns {Promise<ReputationFaction | undefined>}
   */
  async updateFaction(factionId, updates) {
    const existing = this.factions.get(factionId);
    if (!existing) return undefined;
    const merged = this._normalizeFaction({ ...existing, ...updates, id: factionId });
    this.factions.set(factionId, merged);
    await this._saveState();
    return this.getFaction(factionId);
  }

  /**
   * @param {string} factionId
   */
  async deleteFaction(factionId) {
    if (!this.factions.has(factionId)) return;
    this.factions.delete(factionId);
    await this._saveState();
  }

  /**
   * @param {string} factionId
   * @param {number} delta
   * @param {object} [metadata]
   */
  async adjustReputation(factionId, delta, metadata = {}) {
    const faction = this.factions.get(factionId);
    if (!faction) return;
    const change = Number(delta ?? 0);
    if (!Number.isFinite(change) || change === 0) return;

    const minValue = Number.isFinite(faction.minValue) ? Number(faction.minValue) : 0;
    const maxValue = Number.isFinite(faction.maxValue) ? Number(faction.maxValue) : 0;
    const newValue = faction.value + change;
    faction.value = Math.min(Math.max(newValue, minValue), maxValue || newValue);
    faction.updatedAt = Date.now();
    this.factions.set(factionId, this._normalizeFaction(faction));
    await this._saveState();

    const notify = metadata?.notify ?? true;
    if (notify && game?.i18n?.localize) {
      ui.notifications?.info(
        game.i18n.format("PF2E.PointsTracker.Reputation.ChangeNotification", {
          name: faction.name,
          value: faction.value,
        })
      );
    }
  }

  /**
   * Replace the current state.
   * @param {object} state
   */
  async importState(state) {
    const factions = Array.isArray(state?.factions) ? state.factions : [];
    this.factions = new Collection(
      factions.map((faction) => [faction.id ?? createId(), this._normalizeFaction(faction)])
    );
    await this._saveState();
  }

  /**
   * Export the current tracker state.
   * @returns {object}
   */
  exportState() {
    return {
      factions: this.getFactions(),
    };
  }

  /**
   * @param {Partial<ReputationFaction>} data
   * @returns {ReputationFaction}
   */
  _normalizeFaction(data) {
    const id = typeof data?.id === "string" && data.id.trim() ? data.id.trim() : createId();
    const defaultName = getDefaultFactionName();
    const rawName =
      typeof data?.name === "string" && data.name.trim()
        ? data.name.trim()
        : "";
    const name =
      rawName && rawName !== DEFAULT_FACTION_NAME_KEY ? rawName : defaultName;

    const maxValueRaw = Number(data?.maxValue);
    const maxValue = Number.isFinite(maxValueRaw) && maxValueRaw > 0 ? Number(maxValueRaw) : 100;

    const minValueRaw = Number(data?.minValue);
    const minValue = Number.isFinite(minValueRaw) ? Number(minValueRaw) : 0;

    const valueRaw = Number(data?.value);
    const value = Number.isFinite(valueRaw) ? Number(valueRaw) : 0;
    const clampedValue = Math.min(Math.max(value, minValue), maxValue);

    const description = typeof data?.description === "string" ? data.description.trim() : "";
    const notes = typeof data?.notes === "string" ? data.notes.trim() : "";
    const isCollapsed = Boolean(data?.isCollapsed);
    const updatedAt = Number.isFinite(data?.updatedAt) ? Number(data.updatedAt) : null;

    return {
      id,
      name,
      value: clampedValue,
      maxValue,
      minValue,
      description,
      notes,
      isCollapsed,
      updatedAt,
      progressPercent: maxValue > minValue ? ((clampedValue - minValue) / (maxValue - minValue)) * 100 : 0,
    };
  }
}

export function createReputationTracker({ moduleId, settingKey }) {
  return new ReputationTracker({ moduleId, settingKey });
}
