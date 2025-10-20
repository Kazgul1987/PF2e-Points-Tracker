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
 * @typedef {object} ResearchRevealThreshold
 * @property {string} id
 * @property {number} points
 * @property {string} [gmText]
 * @property {string} [playerText]
 * @property {number|null} [revealedAt]
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
 * @property {ResearchRevealThreshold[]} thresholds
 * @property {string[]} revealedThresholdIds
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
      topics: this.getTopics().map((topic) => {
        const { progressPercent, thresholds, ...rest } = topic;
        return {
          ...rest,
          thresholds: (thresholds ?? []).map((threshold) => ({
            id: threshold.id,
            points: threshold.points,
            gmText: threshold.gmText ?? "",
            playerText: threshold.playerText ?? "",
            revealedAt: Number.isFinite(threshold.revealedAt)
              ? Number(threshold.revealedAt)
              : threshold.revealedAt ?? null,
          })),
          participants: topic.participants.map((p) => ({ ...p })),
        };
      }),
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
      name:
        data.name ?? game.i18n.localize("PF2E.PointsTracker.Research.DefaultName"),
      progress: Number.isFinite(data.progress) ? Number(data.progress) : 0,
      target: Number.isFinite(data.target) ? Number(data.target) : 10,
      difficulty: data.difficulty ?? "standard",
      skill: data.skill ?? "society",
      summary: data.summary ?? "",
      participants: Array.isArray(data.participants) ? data.participants : [],
      thresholds: Array.isArray(data.thresholds) ? data.thresholds : [],
      revealedThresholdIds: Array.isArray(data.revealedThresholdIds)
        ? data.revealedThresholdIds
        : [],
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
    const merged = this._normalizeTopic({ ...topic, ...updates, id: topicId });
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

    await this._autoRevealThresholds(topicId);
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
   * Manually send or resend a reveal for a threshold.
   * @param {string} topicId
   * @param {string} thresholdId
   * @param {object} [options]
   * @param {boolean} [options.resend=false]
   */
  async sendThresholdReveal(topicId, thresholdId, { resend = false } = {}) {
    const topic = this.topics.get(topicId);
    if (!topic) return;
    const thresholds = Array.isArray(topic.thresholds) ? topic.thresholds : [];
    const threshold = thresholds.find((entry) => entry.id === thresholdId);
    if (!threshold) return;

    const revealed = new Set(
      Array.isArray(topic.revealedThresholdIds) ? topic.revealedThresholdIds : []
    );
    const alreadyRevealed = revealed.has(thresholdId);
    if (!alreadyRevealed) {
      revealed.add(thresholdId);
      threshold.revealedAt = Date.now();
      topic.revealedThresholdIds = Array.from(revealed);
      this.topics.set(topicId, this._normalizeTopic(topic));
      await this._saveState();
    }

    const normalizedTopic = this.getTopic(topicId);
    const normalizedThreshold = normalizedTopic?.thresholds?.find(
      (entry) => entry.id === threshold.id
    );

    await this._notifyThresholdReveal(
      normalizedTopic,
      normalizedThreshold ?? threshold,
      {
        resend: resend && alreadyRevealed,
      }
    );
  }

  /**
   * Ensure any thresholds met by current progress are automatically revealed.
   * @param {string} topicId
   */
  async _autoRevealThresholds(topicId) {
    const topic = this.topics.get(topicId);
    if (!topic) return;

    const progress = Number(topic.progress ?? 0);
    const thresholds = Array.isArray(topic.thresholds) ? topic.thresholds : [];
    const revealed = new Set(
      Array.isArray(topic.revealedThresholdIds) ? topic.revealedThresholdIds : []
    );

    const newlyUnlocked = thresholds.filter((threshold) => {
      const cost = Number.isFinite(threshold.points)
        ? Number(threshold.points)
        : 0;
      return progress >= cost && !revealed.has(threshold.id);
    });

    if (!newlyUnlocked.length) return;

    const timestamp = Date.now();
    newlyUnlocked.forEach((threshold) => {
      revealed.add(threshold.id);
      threshold.revealedAt = timestamp;
    });
    topic.revealedThresholdIds = Array.from(revealed);
    this.topics.set(topicId, this._normalizeTopic(topic));
    await this._saveState();

    for (const threshold of newlyUnlocked) {
      const normalizedTopic = this.getTopic(topicId);
      const normalizedThreshold = normalizedTopic?.thresholds?.find(
        (entry) => entry.id === threshold.id
      );
      await this._notifyThresholdReveal(
        normalizedTopic,
        normalizedThreshold ?? threshold,
        {
          resend: false,
        }
      );
      await this.recordLog({
        topicId,
        message:
          game?.i18n?.format?.(
            "PF2E.PointsTracker.Research.RevealUnlockedLog",
            {
              topic: normalizedTopic?.name ?? "",
              points: threshold.points ?? 0,
            }
          ) ?? `Unlocked reveal at ${threshold.points} RP for ${normalizedTopic?.name ?? ""}.`,
      });
    }
  }

  /**
   * Notify the table that a threshold has been revealed.
   * @param {ResearchTopic} topic
   * @param {ResearchRevealThreshold} threshold
   * @param {object} [options]
   * @param {boolean} [options.resend]
   */
  async _notifyThresholdReveal(topic, threshold, { resend = false } = {}) {
    if (!topic || !threshold) return;
    if (!game?.users) return;

    const headerText =
      game?.i18n?.format?.("PF2E.PointsTracker.Research.RevealMessageHeader", {
        topic: topic.name,
        points: threshold.points ?? 0,
      }) ?? `${topic.name} - ${threshold.points ?? 0} RP`;

    const playerRecipients = game.users
      .filter((user) => !user.isGM)
      .map((user) => user.id);
    const gmRecipients = ChatMessage?.getWhisperRecipients
      ? ChatMessage.getWhisperRecipients("GM").map((user) => user.id)
      : [];

    const playerText = threshold.playerText?.trim();
    if (playerText) {
      const enrichedPlayer = await this._enrichText(playerText);
      await ChatMessage?.create?.({
        user: game.user?.id,
        speaker: { alias: topic.name },
        content: `<div class="pf2e-research-reveal pf2e-research-reveal--player"><p><strong>${headerText}</strong></p>${enrichedPlayer}</div>`,
        whisper: playerRecipients.length ? playerRecipients : undefined,
      });
    }

    const gmText = threshold.gmText?.trim();
    if (gmText && gmRecipients.length) {
      const enrichedGm = await this._enrichText(gmText);
      await ChatMessage?.create?.({
        user: game.user?.id,
        speaker: { alias: topic.name },
        content: `<div class="pf2e-research-reveal pf2e-research-reveal--gm"><p><strong>${headerText}</strong></p>${enrichedGm}</div>`,
        whisper: gmRecipients,
      });
    }
  }

  /**
   * Attempt to enrich HTML content for chat display.
   * @param {string} text
   * @returns {Promise<string>}
   */
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

  /**
   * Normalize a topic, ensuring the expected shape.
   * @param {Partial<ResearchTopic>} topic
   * @returns {ResearchTopic}
   */
  _normalizeTopic(topic) {
    const target = Number.isFinite(topic.target) ? Number(topic.target) : 0;
    const progress = Number.isFinite(topic.progress) ? Number(topic.progress) : 0;
    const participants = Array.isArray(topic.participants) ? topic.participants : [];
    const { thresholds, revealedThresholdIds } = this._normalizeThresholds(
      topic,
      progress
    );
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
      thresholds,
      revealedThresholdIds,
      progressPercent: Math.round(percent * 100) / 100,
    };
  }

  /**
   * Normalize the threshold structure on a topic.
   * @param {Partial<ResearchTopic>} topic
   * @param {number} progress
   * @returns {{thresholds: ResearchRevealThreshold[], revealedThresholdIds: string[]}}
   */
  _normalizeThresholds(topic, progress) {
    const rawThresholds = Array.isArray(topic.thresholds)
      ? topic.thresholds.slice()
      : [];
    const withIds = rawThresholds.map((threshold, index) => {
      const fallbackId = `${topic.id ?? "threshold"}-${index}`;
      const rawId = threshold?.id ?? fallbackId;
      return {
        id: String(rawId || createId()),
        points: Number.isFinite(threshold?.points)
          ? Number(threshold.points)
          : 0,
        gmText: threshold?.gmText ?? "",
        playerText: threshold?.playerText ?? "",
        revealedAt: Number.isFinite(threshold?.revealedAt)
          ? Number(threshold.revealedAt)
          : null,
        order: index,
      };
    });

    withIds.sort((a, b) => {
      if (a.points === b.points) return a.order - b.order;
      return a.points - b.points;
    });

    const rawRevealed = Array.isArray(topic.revealedThresholdIds)
      ? topic.revealedThresholdIds
      : [];
    const validIds = new Set(withIds.map((threshold) => threshold.id));
    const revealedSet = new Set(
      rawRevealed
        .map((id) => String(id))
        .filter((id) => validIds.has(id))
    );

    const normalizedThresholds = withIds.map((threshold) => {
      const isRevealed = revealedSet.has(threshold.id);
      return {
        id: threshold.id,
        points: threshold.points,
        gmText: threshold.gmText,
        playerText: threshold.playerText,
        revealedAt:
          Number.isFinite(threshold.revealedAt) && threshold.revealedAt !== null
            ? Number(threshold.revealedAt)
            : isRevealed
            ? threshold.revealedAt ?? null
            : null,
      };
    });

    const normalizedRevealed = Array.from(revealedSet);

    return { thresholds: normalizedThresholds, revealedThresholdIds: normalizedRevealed };
  }
}

export function createResearchTracker(options) {
  return new ResearchTracker(options);
}
