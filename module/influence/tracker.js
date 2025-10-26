import { localizeWithFallback } from "../utils/localize.js";

const DEFAULT_STATE = {
  version: 1,
  npcs: [],
  log: [],
};

const DEFAULT_NPC_NAME_KEY = "PF2E.PointsTracker.Influence.DefaultNpcName";
const DEFAULT_NPC_NAME_FALLBACK = "Influence NPC";

function getDefaultNpcName() {
  return localizeWithFallback(DEFAULT_NPC_NAME_KEY, DEFAULT_NPC_NAME_FALLBACK);
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

function normalizeSkillEntries(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray(raw.entries)
    ? raw.entries
    : [];

  const normalized = [];
  const seen = new Set();
  for (const entry of list) {
    if (!entry) continue;

    const result = { id: createId(), skill: "", dc: null };

    if (typeof entry === "string") {
      result.skill = entry.trim();
    } else if (typeof entry === "object") {
      if (typeof entry.id === "string" && entry.id.trim()) {
        result.id = entry.id.trim();
      }
      if (typeof entry.skill === "string" && entry.skill.trim()) {
        result.skill = entry.skill.trim();
      } else if (typeof entry.slug === "string" && entry.slug.trim()) {
        result.skill = entry.slug.trim();
      } else if (typeof entry.name === "string" && entry.name.trim()) {
        result.skill = entry.name.trim();
      }
      const dcSource = (() => {
        if (Object.prototype.hasOwnProperty.call(entry, "dc")) return entry.dc;
        if (Object.prototype.hasOwnProperty.call(entry, "DC")) return entry.DC;
        if (Object.prototype.hasOwnProperty.call(entry, "value")) return entry.value;
        return null;
      })();
      const numeric = Number(dcSource);
      if (Number.isFinite(numeric)) {
        result.dc = Number(numeric);
      }
    }

    result.skill = typeof result.skill === "string" ? result.skill.trim() : "";
    if (!result.skill && (result.dc === null || result.dc === undefined)) continue;
    const key = `${result.skill ?? ""}::${result.dc ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.dc = Number.isFinite(result.dc) ? Number(result.dc) : null;
    normalized.push(result);
  }

  return normalized;
}

function normalizeThresholds(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray(raw.entries)
    ? raw.entries
    : [];

  const normalized = [];
  for (const entry of list) {
    if (!entry) continue;

    const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : createId();
    const pointsRaw = Number(entry.points ?? entry.value ?? entry.threshold ?? 0);
    const points = Number.isFinite(pointsRaw) ? Number(pointsRaw) : 0;
    const gmText = typeof entry.gmText === "string" ? entry.gmText.trim() : "";
    const playerText = typeof entry.playerText === "string" ? entry.playerText.trim() : "";
    const reward = (() => {
      if (typeof entry.reward === "string") return entry.reward.trim();
      if (typeof entry.outcome === "string") return entry.outcome.trim();
      return "";
    })();
    const revealedAtRaw = Number(entry.revealedAt);
    const revealedAt = Number.isFinite(revealedAtRaw) ? Number(revealedAtRaw) : null;

    normalized.push({
      id,
      points,
      gmText,
      playerText,
      reward,
      revealedAt,
    });
  }

  normalized.sort((a, b) => a.points - b.points);
  return normalized;
}

function normalizeTraits(raw) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
    ? raw.split(",")
    : raw && typeof raw === "object" && Array.isArray(raw.values)
    ? raw.values
    : [];

  const normalized = [];
  const seen = new Set();

  for (const entry of list) {
    let value = "";
    if (typeof entry === "string") {
      value = entry;
    } else if (entry && typeof entry === "object") {
      if (typeof entry.label === "string") value = entry.label;
      else if (typeof entry.name === "string") value = entry.name;
      else if (typeof entry.value === "string") value = entry.value;
      else if (typeof entry.slug === "string") value = entry.slug;
    }

    value = typeof value === "string" ? value.trim() : "";
    if (!value) continue;

    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  return normalized;
}

function normalizeNpc(data = {}) {
  const id = typeof data.id === "string" && data.id.trim() ? data.id.trim() : createId();
  const name = (() => {
    const defaultName = getDefaultNpcName();
    if (typeof data.name === "string" && data.name.trim()) {
      const trimmed = data.name.trim();
      return trimmed === DEFAULT_NPC_NAME_KEY ? defaultName : trimmed;
    }
    return defaultName;
  })();

  const currentInfluenceRaw = Number(data.currentInfluence ?? data.influence ?? 0);
  const maxInfluenceRaw = Number(data.maxInfluence ?? data.target ?? data.maximum ?? 0);
  const baseDcRaw = Number(data.baseDc ?? data.baseDC ?? data.base ?? data.dc ?? null);

  const npc = {
    id,
    name,
    currentInfluence: Number.isFinite(currentInfluenceRaw) ? Number(currentInfluenceRaw) : 0,
    maxInfluence: Number.isFinite(maxInfluenceRaw) ? Math.max(Number(maxInfluenceRaw), 0) : 0,
    baseDc: Number.isFinite(baseDcRaw) ? Number(baseDcRaw) : null,
    skillDcs: normalizeSkillEntries(data.skillDcs ?? data.skills ?? []),
    thresholds: normalizeThresholds(data.thresholds ?? []),
    traits: normalizeTraits(data.traits ?? data.trait ?? []),
    discoveryChecks:
      typeof data.discoveryChecks === "string" ? data.discoveryChecks.trim() : "",
    influenceChecks:
      typeof data.influenceChecks === "string" ? data.influenceChecks.trim() : "",
    penalty: typeof data.penalty === "string" ? data.penalty.trim() : "",
    notes: typeof data.notes === "string" ? data.notes.trim() : "",
    isCollapsed: Boolean(data.isCollapsed),
    createdAt: Number.isFinite(Number(data.createdAt)) ? Number(data.createdAt) : Date.now(),
    updatedAt: Number.isFinite(Number(data.updatedAt)) ? Number(data.updatedAt) : Date.now(),
  };

  return npc;
}

function normalizeLogEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : createId();
  const npcId = typeof entry.npcId === "string" ? entry.npcId.trim() : "";
  const timestampRaw = Number(entry.timestamp ?? entry.date ?? Date.now());
  const timestamp = Number.isFinite(timestampRaw) ? Number(timestampRaw) : Date.now();
  const deltaRaw = Number(entry.delta ?? entry.change ?? 0);
  const delta = Number.isFinite(deltaRaw) ? Number(deltaRaw) : 0;
  const totalRaw = Number(entry.total ?? entry.totalInfluence ?? entry.value ?? 0);
  const total = Number.isFinite(totalRaw) ? Number(totalRaw) : null;
  const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
  const note = typeof entry.note === "string" ? entry.note.trim() : "";
  const type = typeof entry.type === "string" && entry.type.trim() ? entry.type.trim() : "adjustment";
  const userId = typeof entry.userId === "string" ? entry.userId.trim() : null;
  const userName = typeof entry.userName === "string" ? entry.userName.trim() : null;

  return {
    id,
    npcId,
    delta,
    total,
    reason,
    note,
    type,
    userId,
    userName,
    timestamp,
  };
}

export class InfluenceTracker {
  constructor({ moduleId, settingKey }) {
    this.moduleId = moduleId;
    this.settingKey = settingKey;
    this.npcs = new Collection();
    this.log = [];
    this.version = DEFAULT_STATE.version;
    this._initialized = false;
  }

  registerSettings() {
    if (!game?.settings?.register) return;

    game.settings.register(this.moduleId, this.settingKey, {
      name: "Influence Tracker State",
      scope: "world",
      config: false,
      type: Object,
      default: duplicateData(DEFAULT_STATE),
    });
  }

  async initialize() {
    if (!game?.settings?.get) return;

    const stored = duplicateData(game.settings.get(this.moduleId, this.settingKey) ?? DEFAULT_STATE);
    const migrated = this._migrateState(stored);

    this.version = migrated.version ?? DEFAULT_STATE.version;

    this.npcs = new Collection(migrated.npcs.map((npc) => [npc.id, normalizeNpc(npc)]));
    this.log = migrated.log
      .map((entry) => normalizeLogEntry(entry))
      .filter((entry) => entry !== null)
      .sort((a, b) => a.timestamp - b.timestamp);

    this._initialized = true;
  }

  async _saveState() {
    if (!this._initialized || !game?.settings?.set) return;

    const payload = {
      version: this.version ?? DEFAULT_STATE.version,
      npcs: this.getNpcs().map((npc) => ({
        id: npc.id,
        name: npc.name,
        currentInfluence: npc.currentInfluence,
        maxInfluence: npc.maxInfluence,
        baseDc: npc.baseDc,
        skillDcs: npc.skillDcs.map((entry) => ({ id: entry.id, skill: entry.skill, dc: entry.dc })),
        thresholds: npc.thresholds.map((threshold) => ({
          id: threshold.id,
          points: threshold.points,
          gmText: threshold.gmText,
          playerText: threshold.playerText,
          reward: threshold.reward ?? "",
          revealedAt: threshold.revealedAt ?? null,
        })),
        traits: Array.isArray(npc.traits) ? npc.traits : [],
        discoveryChecks: npc.discoveryChecks ?? "",
        influenceChecks: npc.influenceChecks ?? "",
        penalty: npc.penalty ?? "",
        notes: npc.notes ?? "",
        isCollapsed: npc.isCollapsed ?? false,
        createdAt: npc.createdAt ?? Date.now(),
        updatedAt: npc.updatedAt ?? Date.now(),
      })),
      log: this.getLog().map((entry) => ({
        id: entry.id,
        npcId: entry.npcId,
        delta: entry.delta,
        total: entry.total,
        reason: entry.reason,
        note: entry.note,
        type: entry.type,
        userId: entry.userId,
        userName: entry.userName,
        timestamp: entry.timestamp,
      })),
    };

    await game.settings.set(this.moduleId, this.settingKey, payload);
  }

  _migrateState(state) {
    const source = state && typeof state === "object" ? state : DEFAULT_STATE;

    const version = Number.isFinite(Number(source.version)) ? Number(source.version) : 0;
    if (!Array.isArray(source.npcs) && Array.isArray(source.topics)) {
      // Legacy support if someone copied research data accidentally.
      source.npcs = source.topics;
    }

    const migrated = {
      version: version > 0 ? version : DEFAULT_STATE.version,
      npcs: Array.isArray(source.npcs) ? source.npcs : [],
      log: Array.isArray(source.log) ? source.log : [],
    };

    if (!Number.isFinite(migrated.version) || migrated.version < 1) {
      migrated.version = 1;
    }

    return migrated;
  }

  getNpcs() {
    return Array.from(this.npcs.values()).map((npc) => normalizeNpc(npc));
  }

  getNpc(npcId) {
    const npc = this.npcs.get(npcId);
    return npc ? normalizeNpc(npc) : undefined;
  }

  async createNpc(data = {}) {
    const npc = normalizeNpc({ ...data, id: createId(), createdAt: Date.now(), updatedAt: Date.now() });
    this.npcs.set(npc.id, npc);
    await this._saveState();
    return this.getNpc(npc.id);
  }

  async updateNpc(npcId, updates = {}) {
    const existing = this.npcs.get(npcId);
    if (!existing) return undefined;

    const merged = normalizeNpc({ ...existing, ...updates, id: npcId, updatedAt: Date.now() });
    this.npcs.set(npcId, merged);
    await this._saveState();
    return this.getNpc(npcId);
  }

  async deleteNpc(npcId) {
    if (!this.npcs.has(npcId)) return;
    this.npcs.delete(npcId);
    this.log = this.log.filter((entry) => entry.npcId !== npcId);
    await this._saveState();
  }

  async adjustInfluence(npcId, delta, { reason = "", note = "", notify = true } = {}) {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    const change = Number(delta ?? 0);
    if (!Number.isFinite(change) || change === 0) return;

    const max = Number.isFinite(npc.maxInfluence) ? Number(npc.maxInfluence) : 0;
    const current = Number.isFinite(npc.currentInfluence) ? Number(npc.currentInfluence) : 0;
    const newValue = current + change;
    const clamped = max > 0 ? Math.min(Math.max(newValue, 0), max) : Math.max(newValue, 0);

    npc.currentInfluence = clamped;
    npc.updatedAt = Date.now();
    this.npcs.set(npcId, normalizeNpc(npc));

    const entry = normalizeLogEntry({
      id: createId(),
      npcId,
      delta: change,
      total: clamped,
      reason,
      note,
      type: "adjustment",
      userId: game?.user?.id ?? null,
      userName: game?.user?.name ?? null,
      timestamp: Date.now(),
    });
    if (entry) {
      this.log.push(entry);
      this.log.sort((a, b) => a.timestamp - b.timestamp);
    }

    await this._saveState();

    if (notify && game?.i18n?.localize) {
      ui.notifications?.info(
        game.i18n.format("PF2E.PointsTracker.Influence.AdjustmentNotification", {
          name: npc.name,
          value: this.npcs.get(npcId)?.currentInfluence ?? clamped,
        })
      );
    }
  }

  async setInfluence(npcId, value, { reason = "", note = "", notify = true } = {}) {
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return;

    const current = Number.isFinite(npc.currentInfluence) ? Number(npc.currentInfluence) : 0;
    const delta = numeric - current;
    if (delta === 0) return;

    await this.adjustInfluence(npcId, delta, { reason, note, notify });
  }

  getLog() {
    return this.log.map((entry) => ({ ...entry }));
  }

  getNpcLog(npcId) {
    return this.log.filter((entry) => entry.npcId === npcId).map((entry) => ({ ...entry }));
  }

  getLogEntry(entryId) {
    const entry = this.log.find((item) => item.id === entryId);
    return entry ? { ...entry } : undefined;
  }

  async addLogEntry({ npcId = "", note = "", reason = "", type = "note" } = {}) {
    const entry = normalizeLogEntry({
      id: createId(),
      npcId,
      note,
      reason,
      type: type || "note",
      timestamp: Date.now(),
      userId: game?.user?.id ?? null,
      userName: game?.user?.name ?? null,
    });
    if (!entry) return undefined;
    this.log.push(entry);
    this.log.sort((a, b) => a.timestamp - b.timestamp);
    await this._saveState();
    return { ...entry };
  }

  async updateLogEntry(entryId, updates = {}) {
    const index = this.log.findIndex((entry) => entry.id === entryId);
    if (index === -1) return undefined;
    const existing = this.log[index];
    const merged = normalizeLogEntry({ ...existing, ...updates, id: entryId });
    if (!merged) return undefined;
    this.log.splice(index, 1, merged);
    this.log.sort((a, b) => a.timestamp - b.timestamp);
    await this._saveState();
    return { ...merged };
  }

  async deleteLogEntry(entryId) {
    const index = this.log.findIndex((entry) => entry.id === entryId);
    if (index === -1) return;
    this.log.splice(index, 1);
    await this._saveState();
  }
}

export function createInfluenceTracker({ moduleId, settingKey }) {
  return new InfluenceTracker({ moduleId, settingKey });
}
