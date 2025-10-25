import { localizeWithFallback } from "../utils/localize.js";

const DEFAULT_STATE = {
  events: [],
  log: [],
};

const DEFAULT_EVENT_NAME_KEY = "PF2E.PointsTracker.Chase.DefaultEventName";
const DEFAULT_EVENT_NAME_FALLBACK = "Chase Event";
const DEFAULT_OBSTACLE_NAME_KEY = "PF2E.PointsTracker.Chase.DefaultObstacleName";
const DEFAULT_OBSTACLE_NAME_FALLBACK = "Obstacle";
const DEFAULT_OPPORTUNITY_NAME_KEY = "PF2E.PointsTracker.Chase.DefaultOpportunityName";
const DEFAULT_OPPORTUNITY_NAME_FALLBACK = "Opportunity";

function getDefaultEventName() {
  return localizeWithFallback(DEFAULT_EVENT_NAME_KEY, DEFAULT_EVENT_NAME_FALLBACK);
}

function getDefaultObstacleName() {
  return localizeWithFallback(DEFAULT_OBSTACLE_NAME_KEY, DEFAULT_OBSTACLE_NAME_FALLBACK);
}

function getDefaultOpportunityName() {
  return localizeWithFallback(DEFAULT_OPPORTUNITY_NAME_KEY, DEFAULT_OPPORTUNITY_NAME_FALLBACK);
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
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
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
    if (typeof entry === "string") {
      uuid = entry.trim();
    } else if (typeof entry === "object") {
      if (typeof entry.uuid === "string" && entry.uuid.trim()) {
        uuid = entry.uuid.trim();
      } else if (typeof entry.id === "string" && entry.id.trim()) {
        uuid = entry.id.trim();
      }
      if (typeof entry.name === "string" && entry.name.trim()) {
        name = entry.name.trim();
      }
    }

    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    const normalizedEntry = { uuid };
    if (name) normalizedEntry.name = name;
    normalized.push(normalizedEntry);
  }

  return normalized;
}

export class ChaseTracker {
  constructor({ moduleId, settingKey }) {
    this.moduleId = moduleId;
    this.settingKey = settingKey;
    this.state = duplicateData(DEFAULT_STATE);
  }

  registerSettings() {
    if (typeof game?.settings?.register !== "function") return;
    game.settings.register(this.moduleId, this.settingKey, {
      name: "Chase Tracker State",
      scope: "world",
      config: false,
      type: Object,
      default: duplicateData(DEFAULT_STATE),
      onChange: () => this.initialize(),
    });
  }

  async initialize() {
    if (typeof game?.settings?.get !== "function") return;
    const stored = await game.settings.get(this.moduleId, this.settingKey);
    if (stored && typeof stored === "object") {
      this.state = duplicateData({ ...DEFAULT_STATE, ...stored });
    } else {
      this.state = duplicateData(DEFAULT_STATE);
    }
  }

  async _persist() {
    if (typeof game?.settings?.set !== "function") return;
    await game.settings.set(this.moduleId, this.settingKey, duplicateData(this.state));
  }

  getEvents() {
    return duplicateData(this.state.events ?? []);
  }

  getEvent(eventId) {
    return this.state.events?.find((event) => event.id === eventId) ?? null;
  }

  async createEvent({ name, description } = {}) {
    const event = {
      id: createId(),
      name: typeof name === "string" && name.trim() ? name.trim() : getDefaultEventName(),
      description: typeof description === "string" ? description.trim() : "",
      obstacles: [],
      opportunities: [],
      createdAt: Date.now(),
    };
    this.state.events = [...(this.state.events ?? []), event];
    await this._persist();
    return duplicateData(event);
  }

  async updateEvent(eventId, updates = {}) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const sanitized = {};
    if (typeof updates.name === "string") {
      const trimmed = updates.name.trim();
      sanitized.name = trimmed || getDefaultEventName();
    }
    if (typeof updates.description === "string") {
      sanitized.description = updates.description.trim();
    }
    const existing = this.state.events.find((entry) => entry.id === eventId);
    Object.assign(existing, sanitized);
    await this._persist();
    return duplicateData(existing);
  }

  async deleteEvent(eventId) {
    const before = this.state.events ?? [];
    const filtered = before.filter((entry) => entry.id !== eventId);
    if (filtered.length === before.length) return false;
    this.state.events = filtered;
    await this._persist();
    return true;
  }

  async createObstacle(eventId, { name, description, requiredPoints } = {}) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const obstacle = {
      id: createId(),
      name:
        typeof name === "string" && name.trim() ? name.trim() : getDefaultObstacleName(),
      description: typeof description === "string" ? description.trim() : "",
      requiredPoints: Number.isFinite(Number(requiredPoints))
        ? Math.max(0, Number(requiredPoints))
        : 0,
      progress: 0,
      assignedActors: [],
      createdAt: Date.now(),
    };
    event.obstacles = [...(event.obstacles ?? []), obstacle];
    await this._persist();
    return duplicateData(obstacle);
  }

  async updateObstacle(eventId, obstacleId, updates = {}) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const obstacle = event.obstacles?.find((entry) => entry.id === obstacleId);
    if (!obstacle) return null;
    if (typeof updates.name === "string") {
      const trimmed = updates.name.trim();
      obstacle.name = trimmed || getDefaultObstacleName();
    }
    if (typeof updates.description === "string") {
      obstacle.description = updates.description.trim();
    }
    if (Object.prototype.hasOwnProperty.call(updates, "requiredPoints")) {
      const value = Number(updates.requiredPoints);
      obstacle.requiredPoints = Number.isFinite(value) ? Math.max(0, value) : 0;
      if (obstacle.requiredPoints === 0) {
        obstacle.progress = 0;
      } else {
        obstacle.progress = Math.min(obstacle.progress, obstacle.requiredPoints);
      }
    }
    if (Array.isArray(updates.assignedActors)) {
      obstacle.assignedActors = normalizeAssignedActors(updates.assignedActors);
    }
    await this._persist();
    return duplicateData(obstacle);
  }

  async adjustObstacleProgress(eventId, obstacleId, delta) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const obstacle = event.obstacles?.find((entry) => entry.id === obstacleId);
    if (!obstacle) return null;
    const numericDelta = Number(delta);
    if (!Number.isFinite(numericDelta)) return duplicateData(obstacle);
    const required = Number.isFinite(obstacle.requiredPoints)
      ? obstacle.requiredPoints
      : 0;
    const current = Number.isFinite(obstacle.progress) ? obstacle.progress : 0;
    const target = required > 0 ? required : Infinity;
    const nextValue = current + numericDelta;
    if (target === Infinity) {
      obstacle.progress = Math.max(0, nextValue);
    } else {
      obstacle.progress = Math.max(0, Math.min(target, nextValue));
    }
    await this._persist();
    return duplicateData(obstacle);
  }

  async setObstacleProgress(eventId, obstacleId, value) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const obstacle = event.obstacles?.find((entry) => entry.id === obstacleId);
    if (!obstacle) return null;
    const required = Number.isFinite(obstacle.requiredPoints)
      ? obstacle.requiredPoints
      : 0;
    const numericValue = Number(value);
    const clamped = Number.isFinite(numericValue)
      ? Math.min(Math.max(0, numericValue), required > 0 ? required : numericValue)
      : 0;
    obstacle.progress = clamped;
    await this._persist();
    return duplicateData(obstacle);
  }

  async deleteObstacle(eventId, obstacleId) {
    const event = this.getEvent(eventId);
    if (!event) return false;
    const before = event.obstacles ?? [];
    const filtered = before.filter((entry) => entry.id !== obstacleId);
    if (filtered.length === before.length) return false;
    event.obstacles = filtered;
    await this._persist();
    return true;
  }

  async createOpportunity(eventId, { name, description } = {}) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const opportunity = {
      id: createId(),
      name:
        typeof name === "string" && name.trim()
          ? name.trim()
          : getDefaultOpportunityName(),
      description: typeof description === "string" ? description.trim() : "",
      assignedActors: [],
      createdAt: Date.now(),
    };
    event.opportunities = [...(event.opportunities ?? []), opportunity];
    await this._persist();
    return duplicateData(opportunity);
  }

  async updateOpportunity(eventId, opportunityId, updates = {}) {
    const event = this.getEvent(eventId);
    if (!event) return null;
    const opportunity = event.opportunities?.find((entry) => entry.id === opportunityId);
    if (!opportunity) return null;
    if (typeof updates.name === "string") {
      const trimmed = updates.name.trim();
      opportunity.name = trimmed || getDefaultOpportunityName();
    }
    if (typeof updates.description === "string") {
      opportunity.description = updates.description.trim();
    }
    if (Array.isArray(updates.assignedActors)) {
      opportunity.assignedActors = normalizeAssignedActors(updates.assignedActors);
    }
    await this._persist();
    return duplicateData(opportunity);
  }

  async deleteOpportunity(eventId, opportunityId) {
    const event = this.getEvent(eventId);
    if (!event) return false;
    const before = event.opportunities ?? [];
    const filtered = before.filter((entry) => entry.id !== opportunityId);
    if (filtered.length === before.length) return false;
    event.opportunities = filtered;
    await this._persist();
    return true;
  }

  async assignActorsToObstacle(eventId, obstacleId, assignments = []) {
    return this.updateObstacle(eventId, obstacleId, {
      assignedActors: normalizeAssignedActors(assignments),
    });
  }

  async assignActorsToOpportunity(eventId, opportunityId, assignments = []) {
    return this.updateOpportunity(eventId, opportunityId, {
      assignedActors: normalizeAssignedActors(assignments),
    });
  }
}

export function createChaseTracker({ moduleId, settingKey }) {
  return new ChaseTracker({ moduleId, settingKey });
}
