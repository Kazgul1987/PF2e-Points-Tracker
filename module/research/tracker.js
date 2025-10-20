const DEFAULT_STATE = {
  topics: [],
  log: [],
};

/**
 * Utility to duplicate an object without retaining references.
 * Uses foundry's duplicate utility when available.
 * @param {object} data
 * @returns {object}
 */
function duplicateData(data) {
  if (typeof foundry !== "undefined" && foundry?.utils?.duplicate) {
    return foundry.utils.duplicate(data);
  }
  return JSON.parse(JSON.stringify(data));
}

/**
 * Produce a unique identifier using Foundry's helper when possible.
 * @returns {string}
 */
function createId() {
  if (typeof foundry !== "undefined" && foundry?.utils?.randomID) {
    return foundry.utils.randomID();
  }
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

/**
 * @typedef {object} ResearchParticipant
 * @property {string} id
 * @property {string} name
 * @property {string} actorUuid
 * @property {string} [skill]
 * @property {string} [role]
 */

/**
 * @typedef {object} ResearchTopic
 * @property {string} id
 * @property {string} name
 * @property {number} progress
 * @property {number} target
 * @property {string} [difficulty]
 * @property {string} [skill]
 * @property {ResearchParticipant[]} participants
 * @property {string} [summary]
 */

/**
 * @typedef {object} ResearchLogEntry
 * @property {string} id
 * @property {string} topicId
 * @property {string} message
 * @property {number} timestamp
 * @property {number} [points]
 * @property {string} [actorUuid]
 * @property {string} [actorName]
 * @property {object} [roll]
 */

export class ResearchTracker {
  /**
   * @param {object} options
   * @param {string} options.moduleId
   * @param {string} options.settingKey
   */
  constructor({ moduleId, settingKey }) {
    this.moduleId = moduleId;
    this.settingKey = settingKey;
    this.topics = new Collection();
    this.log = [];
    this._initialized = false;
  }

  /**
   * Register the underlying storage setting.
   */
  registerSettings() {
    if (!game?.settings?.register) return;

    game.settings.register(this.moduleId, this.settingKey, {
      name: "Research Tracker State",
      scope: "world",
      config: false,
      type: Object,
      default: duplicateData(DEFAULT_STATE),
    });
  }

  /**
   * Load state from storage.
   */
  async initialize() {
    if (!game?.settings) return;

    const stored = duplicateData(
      game.settings.get(this.moduleId, this.settingKey) ?? DEFAULT_STATE
    );
    const topics = Array.isArray(stored.topics) ? stored.topics : [];
    this.topics = new Collection(
      topics.map((topic) => [topic.id, this._normalizeTopic(topic)])
    );
    this.log = Array.isArray(stored.log) ? stored.log : [];
    this._initialized = true;
  }

  /**
   * Persist state into the world setting.
   */
  async _saveState() {
    if (!this._initialized || !game?.settings?.set) return;

    const payload = {
      topics: this.getTopics().map((topic) => ({
        ...topic,
        participants: topic.participants.map((p) => ({ ...p })),
      })),
      log: this.getLog().map((entry) => ({ ...entry })),
    };
    await game.settings.set(this.moduleId, this.settingKey, payload);
  }

  /**
   * Retrieve all topics in a serializable format.
   * @returns {ResearchTopic[]}
   */
  getTopics() {
    return Array.from(this.topics.values()).map((topic) => this._normalizeTopic(topic));
  }

  /**
   * @param {string} topicId
   * @returns {ResearchTopic | undefined}
   */
  getTopic(topicId) {
    const topic = this.topics.get(topicId);
    return topic ? this._normalizeTopic(topic) : undefined;
  }

  /**
   * Create a new research topic.
   * @param {Partial<ResearchTopic>} data
   * @returns {Promise<ResearchTopic>}
   */
  async createTopic(data = {}) {
    const id = data.id ?? createId();
    const topic = this._normalizeTopic({
      id,
      name: data.name ?? game.i18n.localize("PF2E.PointsTracker.Research.DefaultName"),
      progress: Number.isFinite(data.progress) ? Number(data.progress) : 0,
      target: Number.isFinite(data.target) ? Number(data.target) : 10,
      difficulty: data.difficulty ?? "standard",
      skill: data.skill ?? "society",
      summary: data.summary ?? "",
      participants: Array.isArray(data.participants) ? data.participants : [],
    });
    this.topics.set(id, topic);
    await this._saveState();
    return this.getTopic(id);
  }

  /**
   * Update a topic by merging with the provided data.
   * @param {string} topicId
   * @param {Partial<ResearchTopic>} updates
   * @returns {Promise<ResearchTopic | undefined>}
   */
  async updateTopic(topicId, updates) {
    const topic = this.topics.get(topicId);
    if (!topic) return undefined;
    const merged = this._normalizeTopic({ ...topic, ...updates });
    this.topics.set(topicId, merged);
    await this._saveState();
    return this.getTopic(topicId);
  }

  /**
   * Remove a topic from the tracker.
   * @param {string} topicId
   */
  async deleteTopic(topicId) {
    if (!this.topics.has(topicId)) return;
    this.topics.delete(topicId);
    this.log = this.log.filter((entry) => entry.topicId !== topicId);
    await this._saveState();
  }

  /**
   * Add a participant to a topic.
   * @param {string} topicId
   * @param {Partial<ResearchParticipant>} participant
   */
  async addParticipant(topicId, participant) {
    const topic = this.topics.get(topicId);
    if (!topic) return;
    const participants = Array.isArray(topic.participants)
      ? topic.participants.slice()
      : [];
    const id = participant.id ?? createId();
    const entry = {
      id,
      name: participant.name ?? game?.i18n?.localize?.("PF2E.PointsTracker.Research.Participant") ?? "Participant",
      actorUuid: participant.actorUuid ?? "",
      skill: participant.skill ?? topic.skill ?? "",
      role: participant.role ?? "",
    };
    const existingIndex = participants.findIndex((p) => p.id === id);
    if (existingIndex >= 0) participants.splice(existingIndex, 1, entry);
    else participants.push(entry);
    topic.participants = participants;
    this.topics.set(topicId, this._normalizeTopic(topic));
    await this._saveState();
    return entry;
  }

  /**
   * Remove a participant from a topic.
   * @param {string} topicId
   * @param {string} participantId
   */
  async removeParticipant(topicId, participantId) {
    const topic = this.topics.get(topicId);
    if (!topic) return;
    topic.participants = (topic.participants ?? []).filter((p) => p.id !== participantId);
    this.topics.set(topicId, this._normalizeTopic(topic));
    await this._saveState();
  }

  /**
   * Modify the number of research points on a topic.
   * @param {string} topicId
   * @param {number} delta
   * @param {object} [metadata]
   */
  async adjustPoints(topicId, delta, metadata = {}) {
    const topic = this.topics.get(topicId);
    if (!topic) return;
    const progress = Number(topic.progress ?? 0) + Number(delta ?? 0);
    topic.progress = Math.max(progress, 0);
    this.topics.set(topicId, this._normalizeTopic(topic));
    await this._saveState();

    const points = Number(delta ?? 0);
    if (points !== 0) {
      const { actorUuid, actorName, reason, roll } = metadata;
      await this.recordLog({
        topicId,
        message: reason ?? this._buildDefaultLogMessage(points),
        points,
        actorUuid,
        actorName,
        roll,
      });
    }
  }

  /**
   * Internal helper to create a log message when none is provided.
   * @param {number} points
   * @returns {string}
   */
  _buildDefaultLogMessage(points) {
    if (points > 0) {
      return game?.i18n?.format?.("PF2E.PointsTracker.Research.PointsEarned", { points }) ?? `Earned ${points} RP`;
    } else if (points < 0) {
      return game?.i18n?.format?.("PF2E.PointsTracker.Research.PointsSpent", { points: Math.abs(points) }) ?? `Spent ${Math.abs(points)} RP`;
    }
    return game?.i18n?.localize?.("PF2E.PointsTracker.Research.PointsNoChange") ?? "No point change";
  }

  /**
   * Record a structured log entry.
   * @param {Partial<ResearchLogEntry>} entry
   */
  async recordLog(entry) {
    const logEntry = {
      id: entry.id ?? createId(),
      topicId: entry.topicId ?? "",
      message: entry.message ?? "",
      timestamp: entry.timestamp ?? Date.now(),
      points: Number.isFinite(entry.points) ? Number(entry.points) : undefined,
      actorUuid: entry.actorUuid,
      actorName: entry.actorName,
      roll: entry.roll ? duplicateData(entry.roll) : undefined,
    };
    this.log.push(logEntry);
    this.log.sort((a, b) => a.timestamp - b.timestamp);
    await this._saveState();
    return logEntry;
  }

  /**
   * Retrieve the activity log.
   * @returns {ResearchLogEntry[]}
   */
  getLog() {
    return this.log.map((entry) => ({ ...entry }));
  }

  /**
   * Retrieve a participant from a topic.
   * @param {string} topicId
   * @param {string} participantId
   * @returns {ResearchParticipant | undefined}
   */
  getParticipant(topicId, participantId) {
    const topic = this.topics.get(topicId);
    if (!topic) return undefined;
    return (topic.participants ?? []).find((p) => p.id === participantId);
  }

  /**
   * Normalize a topic, ensuring the expected shape.
   * @param {Partial<ResearchTopic>} topic
   * @returns {ResearchTopic}
   */
  _normalizeTopic(topic) {
    const target = Number.isFinite(topic.target) ? Number(topic.target) : 0;
    const progress = Number.isFinite(topic.progress) ? Number(topic.progress) : 0;
    const participants = Array.isArray(topic.participants) ? topic.participants : [];
    const percent = target > 0 ? Math.min((progress / target) * 100, 100) : 0;
    return {
      id: String(topic.id ?? createId()),
      name: topic.name ?? "Research Topic",
      progress,
      target,
      difficulty: topic.difficulty ?? "standard",
      skill: topic.skill ?? "",
      summary: topic.summary ?? "",
      participants,
      progressPercent: Math.round(percent * 100) / 100,
    };
  }
}

export function createResearchTracker(options) {
  return new ResearchTracker(options);
}
