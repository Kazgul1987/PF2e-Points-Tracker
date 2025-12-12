import { localizeWithFallback } from "../utils/localize.js";

export const INFLUENCE_UPDATE_HOOK = "pf2ePointsTrackerInfluenceUpdated";

const DEFAULT_STATE = {
  version: 8,
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

function pickString(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
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

function normalizeAssignedActors(raw) {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
    ? Array.isArray(raw.entries)
      ? raw.entries
      : [raw]
    : typeof raw === "string"
    ? [raw]
    : [];

  const seen = new Set();
  const normalized = [];

  for (const entry of list) {
    if (entry === null || entry === undefined) continue;

    let uuid = "";
    let name = "";
    let tokenUuid = "";
    let tokenImg = "";
    let actorImg = "";
    let actorTokenImg = "";
    let img = "";

    if (typeof entry === "string") {
      uuid = entry.trim();
    } else if (typeof entry === "object") {
      uuid = (() => {
        if (typeof entry.uuid === "string" && entry.uuid.trim()) return entry.uuid.trim();
        if (typeof entry.id === "string" && entry.id.trim()) return entry.id.trim();
        if (typeof entry.actorUuid === "string" && entry.actorUuid.trim()) return entry.actorUuid.trim();
        if (typeof entry.actorId === "string" && entry.actorId.trim()) return entry.actorId.trim();
        return "";
      })();

      name = (() => {
        if (typeof entry.name === "string" && entry.name.trim()) return entry.name.trim();
        if (typeof entry.actorName === "string" && entry.actorName.trim()) return entry.actorName.trim();
        return "";
      })();

      tokenUuid = (() => {
        if (typeof entry.tokenUuid === "string" && entry.tokenUuid.trim()) return entry.tokenUuid.trim();
        if (typeof entry.tokenUUID === "string" && entry.tokenUUID.trim()) return entry.tokenUUID.trim();
        if (typeof entry.tokenId === "string" && entry.tokenId.trim()) return entry.tokenId.trim();
        return "";
      })();

      tokenImg = (() => {
        if (typeof entry.tokenImg === "string" && entry.tokenImg.trim()) return entry.tokenImg.trim();
        if (typeof entry.tokenImage === "string" && entry.tokenImage.trim()) return entry.tokenImage.trim();
        if (typeof entry.imgToken === "string" && entry.imgToken.trim()) return entry.imgToken.trim();
        return "";
      })();

      actorImg = (() => {
        if (typeof entry.actorImg === "string" && entry.actorImg.trim()) return entry.actorImg.trim();
        if (typeof entry.actorImage === "string" && entry.actorImage.trim()) return entry.actorImage.trim();
        if (typeof entry.imgActor === "string" && entry.imgActor.trim()) return entry.imgActor.trim();
        if (typeof entry.actorTokenImg === "string" && entry.actorTokenImg.trim()) return entry.actorTokenImg.trim();
        return "";
      })();

      actorTokenImg =
        typeof entry.actorTokenImg === "string" && entry.actorTokenImg.trim()
          ? entry.actorTokenImg.trim()
          : "";

      img = (() => {
        if (typeof entry.img === "string" && entry.img.trim()) return entry.img.trim();
        if (typeof entry.image === "string" && entry.image.trim()) return entry.image.trim();
        return "";
      })();
    }

    if (!uuid) continue;
    if (seen.has(uuid)) continue;
    seen.add(uuid);

    const assignment = { uuid };
    if (name) assignment.name = name;
    if (tokenUuid) assignment.tokenUuid = tokenUuid;
    if (tokenImg) assignment.tokenImg = tokenImg;
    if (actorImg) assignment.actorImg = actorImg;
    if (actorTokenImg) assignment.actorTokenImg = actorTokenImg;
    if (img) assignment.img = img;

    normalized.push(assignment);
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
  const rawImg = (() => {
    if (typeof data?.img === "string") return data.img;
    if (typeof data?.image === "string") return data.image;
    if (typeof data?.portrait === "string") return data.portrait;
    if (typeof data?.thumbnail === "string") return data.thumbnail;
    return "";
  })();
  const img = typeof rawImg === "string" ? rawImg.trim() : "";
  const rawImageUuid = (() => {
    if (typeof data?.imageUuid === "string") return data.imageUuid;
    if (typeof data?.imageUUID === "string") return data.imageUUID;
    if (typeof data?.imgUuid === "string") return data.imgUuid;
    if (typeof data?.portraitUuid === "string") return data.portraitUuid;
    return "";
  })();
  const imageUuid = typeof rawImageUuid === "string" ? rawImageUuid.trim() : "";

  const biography = data && typeof data === "object" && typeof data.biography === "object"
    ? data.biography
    : {};
  const showInfluenceSkillsToPlayers =
    typeof data.showInfluenceSkillsToPlayers === "boolean"
      ? data.showInfluenceSkillsToPlayers
      : true;
  const npc = {
    id,
    name,
    currentInfluence: Number.isFinite(currentInfluenceRaw) ? Number(currentInfluenceRaw) : 0,
    maxInfluence: Number.isFinite(maxInfluenceRaw) ? Math.max(Number(maxInfluenceRaw), 0) : 0,
    img,
    imageUuid,
    skillDcs: normalizeSkillEntries(data.skillDcs ?? data.skills ?? []),
    thresholds: normalizeThresholds(data.thresholds ?? []),
    traits: normalizeTraits(data.traits ?? data.trait ?? []),
    discoveryChecks: (() => {
      if (typeof data.discoveryChecks === "string") return [];
      return normalizeSkillEntries(data.discoveryChecks ?? []);
    })(),
    discoveryNotes: (() => {
      const legacy =
        typeof data.discoveryChecks === "string" ? data.discoveryChecks.trim() : "";
      const explicit = typeof data.discoveryNotes === "string" ? data.discoveryNotes.trim() : "";
      const structured =
        data.discoveryChecks && typeof data.discoveryChecks === "object"
          ? typeof data.discoveryChecks.notes === "string"
            ? data.discoveryChecks.notes.trim()
            : ""
          : "";
      return explicit || legacy || structured || "";
    })(),
    influenceChecks: (() => {
      if (typeof data.influenceChecks === "string") return [];
      return normalizeSkillEntries(data.influenceChecks ?? []);
    })(),
    influenceNotes: (() => {
      const legacy =
        typeof data.influenceChecks === "string" ? data.influenceChecks.trim() : "";
      const explicit = typeof data.influenceNotes === "string" ? data.influenceNotes.trim() : "";
      const structured =
        data.influenceChecks && typeof data.influenceChecks === "object"
          ? typeof data.influenceChecks.notes === "string"
            ? data.influenceChecks.notes.trim()
            : ""
          : "";
      return explicit || legacy || structured || "";
    })(),
    penalty: typeof data.penalty === "string" ? data.penalty.trim() : "",
    resistances: pickString(data.resistances, data.resistance),
    weaknesses: pickString(data.weaknesses, data.weakness),
    notes: typeof data.notes === "string" ? data.notes.trim() : "",
    background: pickString(
      data.background,
      data.backstory,
      data.history,
      data.bio,
      biography?.background
    ),
    appearance: pickString(
      data.appearance,
      data.description,
      data.look,
      data.visual,
      biography?.appearance
    ),
    personality: pickString(
      data.personality,
      data.behavior,
      data.attitude,
      data.mannerisms,
      biography?.personality
    ),
    isCollapsed: Boolean(data.isCollapsed),
    isLogCollapsed: Boolean(data.isLogCollapsed),
    createdAt: Number.isFinite(Number(data.createdAt)) ? Number(data.createdAt) : Date.now(),
    updatedAt: Number.isFinite(Number(data.updatedAt)) ? Number(data.updatedAt) : Date.now(),
    showInfluenceSkillsToPlayers,
    assignedActors: normalizeAssignedActors(data.assignedActors ?? []),
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
      onChange: (value) => {
        this._applyState(value);
      },
    });
  }

  async initialize() {
    if (!game?.settings?.get) return;

    const stored = duplicateData(game.settings.get(this.moduleId, this.settingKey) ?? DEFAULT_STATE);
    this._applyState(stored);
    this._initialized = true;
  }

  _applyState(rawState) {
    const migrated = this._migrateState(duplicateData(rawState ?? DEFAULT_STATE));

    this.version = migrated.version ?? DEFAULT_STATE.version;

    const normalizedNpcs = Array.isArray(migrated.npcs)
      ? migrated.npcs.map((npc) => normalizeNpc(npc))
      : [];
    this.npcs = new Collection(normalizedNpcs.map((npc) => [npc.id, npc]));

    this.log = Array.isArray(migrated.log)
      ? migrated.log
          .map((entry) => normalizeLogEntry(entry))
          .filter((entry) => entry !== null)
          .sort((a, b) => a.timestamp - b.timestamp)
      : [];

    Hooks?.callAll?.(INFLUENCE_UPDATE_HOOK, {
      tracker: this,
      npcs: this.getNpcs(),
      log: this.getLog(),
    });
  }

  async _saveState() {
    if (!this._initialized) return;

    const payload = {
      version: this.version ?? DEFAULT_STATE.version,
      npcs: this.getNpcs().map((npc) => ({
        id: npc.id,
        name: npc.name,
        img: npc.img ?? "",
        imageUuid: npc.imageUuid ?? "",
        currentInfluence: npc.currentInfluence,
        maxInfluence: npc.maxInfluence,
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
        discoveryChecks: Array.isArray(npc.discoveryChecks)
          ? npc.discoveryChecks.map((entry) => ({
              id: entry.id,
              skill: typeof entry.skill === "string" ? entry.skill : "",
              dc: Number.isFinite(entry.dc) ? Number(entry.dc) : null,
            }))
          : [],
        discoveryNotes: npc.discoveryNotes ?? "",
        influenceChecks: Array.isArray(npc.influenceChecks)
          ? npc.influenceChecks.map((entry) => ({
              id: entry.id,
              skill: typeof entry.skill === "string" ? entry.skill : "",
              dc: Number.isFinite(entry.dc) ? Number(entry.dc) : null,
            }))
          : [],
        influenceNotes: npc.influenceNotes ?? "",
        penalty: npc.penalty ?? "",
        resistances: npc.resistances ?? "",
        weaknesses: npc.weaknesses ?? "",
        notes: npc.notes ?? "",
        background: npc.background ?? "",
        appearance: npc.appearance ?? "",
        personality: npc.personality ?? "",
        isCollapsed: npc.isCollapsed ?? false,
        createdAt: npc.createdAt ?? Date.now(),
        updatedAt: npc.updatedAt ?? Date.now(),
        showInfluenceSkillsToPlayers:
          typeof npc.showInfluenceSkillsToPlayers === "boolean"
            ? npc.showInfluenceSkillsToPlayers
            : true,
        assignedActors: normalizeAssignedActors(npc.assignedActors ?? []),
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

    const canPersistState = game?.user?.isGM && typeof game?.settings?.set === "function";
    if (!canPersistState) return;

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
      version: version > 0 ? version : 1,
      npcs: Array.isArray(source.npcs) ? source.npcs.map((npc) => ({ ...npc })) : [],
      log: Array.isArray(source.log) ? source.log : [],
    };

    if (!Number.isFinite(migrated.version) || migrated.version < 1) {
      migrated.version = 1;
    }

    if (migrated.version < 2) {
      migrated.npcs = migrated.npcs.map((npc) => {
        const clone = { ...npc };
        const rawImg = (() => {
          if (typeof clone?.img === "string") return clone.img;
          if (typeof clone?.image === "string") return clone.image;
          if (typeof clone?.portrait === "string") return clone.portrait;
          if (typeof clone?.thumbnail === "string") return clone.thumbnail;
          return "";
        })();
        const rawImageUuid = (() => {
          if (typeof clone?.imageUuid === "string") return clone.imageUuid;
          if (typeof clone?.imageUUID === "string") return clone.imageUUID;
          if (typeof clone?.imgUuid === "string") return clone.imgUuid;
          if (typeof clone?.portraitUuid === "string") return clone.portraitUuid;
          return "";
        })();
        return {
          ...clone,
          img: typeof rawImg === "string" ? rawImg.trim() : "",
          imageUuid: typeof rawImageUuid === "string" ? rawImageUuid.trim() : "",
        };
      });
      migrated.version = 2;
    }

    if (migrated.version < 3) {
      migrated.npcs = migrated.npcs.map((npc) => {
        const clone = { ...npc };

        const discoveryNotesExplicit =
          typeof clone.discoveryNotes === "string" ? clone.discoveryNotes.trim() : "";
        const discoveryLegacy =
          typeof clone.discoveryChecks === "string" ? clone.discoveryChecks.trim() : "";
        const discoveryStructuredNotes =
          clone.discoveryChecks && typeof clone.discoveryChecks === "object"
            ? typeof clone.discoveryChecks.notes === "string"
              ? clone.discoveryChecks.notes.trim()
              : ""
            : "";
        const discoveryChecks = normalizeSkillEntries(
          typeof clone.discoveryChecks === "string" ? [] : clone.discoveryChecks ?? []
        );

        const influenceNotesExplicit =
          typeof clone.influenceNotes === "string" ? clone.influenceNotes.trim() : "";
        const influenceLegacy =
          typeof clone.influenceChecks === "string" ? clone.influenceChecks.trim() : "";
        const influenceStructuredNotes =
          clone.influenceChecks && typeof clone.influenceChecks === "object"
            ? typeof clone.influenceChecks.notes === "string"
              ? clone.influenceChecks.notes.trim()
              : ""
            : "";
        const influenceChecks = normalizeSkillEntries(
          typeof clone.influenceChecks === "string" ? [] : clone.influenceChecks ?? []
        );

        return {
          ...clone,
          discoveryChecks,
          discoveryNotes:
            discoveryNotesExplicit || discoveryLegacy || discoveryStructuredNotes || "",
          influenceChecks,
          influenceNotes:
            influenceNotesExplicit || influenceLegacy || influenceStructuredNotes || "",
        };
      });
      migrated.version = 3;
    }

    if (migrated.version < 4) {
      migrated.npcs = migrated.npcs.map((npc) => {
        const clone = { ...npc };
        const biography =
          clone && typeof clone === "object" && typeof clone.biography === "object"
            ? clone.biography
            : {};

        clone.background = pickString(
          clone.background,
          clone.backstory,
          clone.history,
          clone.bio,
          biography?.background
        );

        clone.appearance = pickString(
          clone.appearance,
          clone.description,
          clone.look,
          clone.visual,
          biography?.appearance
        );

        clone.personality = pickString(
          clone.personality,
          clone.behavior,
          clone.attitude,
          clone.mannerisms,
          biography?.personality
        );

        return clone;
      });
      migrated.version = 4;
    }

    if (migrated.version < 5) {
      migrated.npcs = migrated.npcs.map((npc) => {
        const clone = { ...npc };
        if (Object.prototype.hasOwnProperty.call(clone, "baseDc")) {
          delete clone.baseDc;
        }
        if (Object.prototype.hasOwnProperty.call(clone, "baseDC")) {
          delete clone.baseDC;
        }
        return clone;
      });
      migrated.version = 5;
    }

    if (migrated.version < 6) {
      migrated.npcs = migrated.npcs.map((npc) => {
        const clone = { ...npc };
        if (typeof clone.showInfluenceSkillsToPlayers !== "boolean") {
          clone.showInfluenceSkillsToPlayers = true;
        }
        return clone;
      });
      migrated.version = 6;
    }

    if (migrated.version < 7) {
      migrated.npcs = migrated.npcs.map((npc) => ({
        ...npc,
        assignedActors: normalizeAssignedActors(npc.assignedActors ?? []),
      }));
      migrated.version = 7;
    }

    if (migrated.version < 8) {
      migrated.npcs = migrated.npcs.map((npc) => ({
        ...npc,
        resistances: pickString(npc.resistances, npc.resistance),
        weaknesses: pickString(npc.weaknesses, npc.weakness),
      }));
      migrated.version = 8;
    }

    if (migrated.version < DEFAULT_STATE.version) {
      migrated.version = DEFAULT_STATE.version;
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

    await this._autoRevealThresholds(npcId);

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

  async sendThresholdReveal(npcId, thresholdId, { resend = false } = {}) {
    const npc = this.npcs.get(npcId);
    if (!npc) return;

    const thresholds = Array.isArray(npc.thresholds) ? npc.thresholds : [];
    const threshold = thresholds.find((entry) => entry.id === thresholdId);
    if (!threshold) return;

    const revealedAtRaw = Number(threshold.revealedAt);
    const isRevealed = Number.isFinite(revealedAtRaw) && revealedAtRaw !== null;

    if (!isRevealed) {
      threshold.revealedAt = Date.now();
      this.npcs.set(npcId, normalizeNpc(npc));
      await this._saveState();
    }

    const normalizedNpc = this.getNpc(npcId) ?? normalizeNpc(npc);
    const normalizedThreshold = normalizedNpc?.thresholds?.find((entry) => entry.id === thresholdId);

    if (!isRevealed) {
      const message =
        game?.i18n?.format?.("PF2E.PointsTracker.Influence.ThresholdRevealLog", {
          name: normalizedNpc?.name ?? npc.name ?? "",
          points: normalizedThreshold?.points ?? threshold.points ?? 0,
        }) ??
        `Unlocked reveal at ${normalizedThreshold?.points ?? threshold.points ?? 0} influence for ${
          normalizedNpc?.name ?? npc.name ?? ""
        }.`;

      await this.addLogEntry({
        npcId,
        reason: message,
        note: normalizedThreshold?.reward ?? threshold.reward ?? "",
        type: "info",
      });
    }

    await this._notifyThresholdReveal(normalizedNpc, normalizedThreshold ?? threshold, {
      resend: resend && isRevealed,
    });
  }

  async _autoRevealThresholds(npcId) {
    const npc = this.npcs.get(npcId);
    if (!npc) return;

    const current = Number.isFinite(npc.currentInfluence) ? Number(npc.currentInfluence) : 0;
    const thresholds = Array.isArray(npc.thresholds) ? npc.thresholds : [];

    const pending = thresholds.filter((threshold) => {
      const points = Number.isFinite(threshold.points) ? Number(threshold.points) : 0;
      const revealedAtRaw = Number(threshold.revealedAt);
      const isRevealed = Number.isFinite(revealedAtRaw) && revealedAtRaw !== null;
      return !isRevealed && current >= points;
    });

    if (!pending.length) return;

    const timestamp = Date.now();
    pending.forEach((threshold) => {
      threshold.revealedAt = timestamp;
    });

    this.npcs.set(npcId, normalizeNpc(npc));
    await this._saveState();

    const normalizedNpc = this.getNpc(npcId) ?? normalizeNpc(npc);

    for (const threshold of pending) {
      const normalizedThreshold = normalizedNpc?.thresholds?.find((entry) => entry.id === threshold.id);

      await this._notifyThresholdReveal(normalizedNpc, normalizedThreshold ?? threshold, {
        resend: false,
      });

      const message =
        game?.i18n?.format?.("PF2E.PointsTracker.Influence.ThresholdRevealLog", {
          name: normalizedNpc?.name ?? npc.name ?? "",
          points: normalizedThreshold?.points ?? threshold.points ?? 0,
        }) ??
        `Unlocked reveal at ${normalizedThreshold?.points ?? threshold.points ?? 0} influence for ${
          normalizedNpc?.name ?? npc.name ?? ""
        }.`;

      await this.addLogEntry({
        npcId,
        reason: message,
        note: normalizedThreshold?.reward ?? threshold.reward ?? "",
        type: "info",
      });
    }
  }

  async _notifyThresholdReveal(npc, threshold, { resend = false } = {}) {
    if (!npc || !threshold) return;
    if (!game?.users) return;

    const headerText =
      game?.i18n?.format?.("PF2E.PointsTracker.Influence.ThresholdRevealMessageHeader", {
        name: npc.name ?? "",
        points: threshold.points ?? 0,
      }) ?? `${npc.name ?? ""} - ${threshold.points ?? 0} Influence`;

    const playerRecipients = game.users.filter((user) => !user.isGM).map((user) => user.id);
    const gmRecipients = ChatMessage?.getWhisperRecipients
      ? ChatMessage.getWhisperRecipients("GM").map((user) => user.id)
      : [];

    const playerText = typeof threshold.playerText === "string" ? threshold.playerText.trim() : "";
    const gmText = typeof threshold.gmText === "string" ? threshold.gmText.trim() : "";
    const rewardText = typeof threshold.reward === "string" ? threshold.reward.trim() : "";
    const rewardLabel =
      game?.i18n?.localize?.("PF2E.PointsTracker.Influence.ThresholdRewardHeading") ?? "Reward:";

    const enrichedPlayer = playerText ? await this._enrichText(playerText) : "";
    const enrichedGm = gmText ? await this._enrichText(gmText) : "";
    const enrichedReward = rewardText ? await this._enrichText(rewardText) : "";
    const rewardBlock = enrichedReward ? `<p><strong>${rewardLabel}</strong></p>${enrichedReward}` : "";

    const playerParts = [];
    if (enrichedPlayer) playerParts.push(enrichedPlayer);
    if (rewardBlock) playerParts.push(rewardBlock);

    if (playerParts.length) {
      await ChatMessage?.create?.({
        user: game.user?.id,
        speaker: { alias: npc.name },
        content: `<div class="pf2e-influence-reveal pf2e-influence-reveal--player"><p><strong>${headerText}</strong></p>${playerParts.join(
          ""
        )}</div>`,
        whisper: playerRecipients.length ? playerRecipients : undefined,
      });
    }

    const gmParts = [];
    if (enrichedGm) gmParts.push(enrichedGm);
    if (rewardBlock) gmParts.push(rewardBlock);

    if (gmRecipients.length && gmParts.length) {
      await ChatMessage?.create?.({
        user: game.user?.id,
        speaker: { alias: npc.name },
        content: `<div class="pf2e-influence-reveal pf2e-influence-reveal--gm"><p><strong>${headerText}</strong></p>${gmParts.join(
          ""
        )}</div>`,
        whisper: gmRecipients,
      });
    }
  }

  async _enrichText(text) {
    if (!text) return "";
    if (globalThis.TextEditor?.enrichHTML) {
      try {
        const enriched = await TextEditor.enrichHTML(text, { async: true });
        if (typeof enriched === "string") return enriched;
      } catch (error) {
        console.error(error);
      }
    }
    return text;
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
