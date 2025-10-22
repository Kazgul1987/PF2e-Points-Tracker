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
      } else if (typeof entry.actorUuid === "string" && entry.actorUuid.trim()) {
        uuid = entry.actorUuid.trim();
      } else if (typeof entry.actorId === "string" && entry.actorId.trim()) {
        uuid = entry.actorId.trim();
      }
      if (typeof entry.name === "string" && entry.name.trim()) {
        name = entry.name.trim();
      } else if (typeof entry.actorName === "string" && entry.actorName.trim()) {
        name = entry.actorName.trim();
      }
    }

    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    normalized.push({ uuid, ...(name ? { name } : {}) });
  }

  return normalized;
}

function sanitizeCheckArray(raw, { fallbackSkill, fallbackDc, allowFallback = true } = {}) {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray(raw.entries)
    ? raw.entries
    : [];

  const entries = [];
  for (const entry of source) {
    if (entry === null || entry === undefined) continue;

    let skill = "";
    let dcValue = undefined;

    if (typeof entry === "string") {
      skill = entry.trim();
    } else if (typeof entry === "object") {
      const skillSource =
        typeof entry.skill === "string"
          ? entry.skill
          : typeof entry.slug === "string"
          ? entry.slug
          : typeof entry.name === "string"
          ? entry.name
          : "";
      if (typeof skillSource === "string") {
        skill = skillSource.trim();
      }

      if (Object.prototype.hasOwnProperty.call(entry, "dc")) {
        dcValue = entry.dc;
      } else if (Object.prototype.hasOwnProperty.call(entry, "DC")) {
        dcValue = entry.DC;
      } else if (Object.prototype.hasOwnProperty.call(entry, "difficultyClass")) {
        dcValue = entry.difficultyClass;
      } else if (Object.prototype.hasOwnProperty.call(entry, "value")) {
        dcValue = entry.value;
      }
    }

    const numericDc = Number(dcValue);
    const dc = Number.isFinite(numericDc) && numericDc > 0 ? Number(numericDc) : null;

    if (!skill && dc === null) continue;

    const normalized = {};
    if (skill) normalized.skill = skill;
    normalized.dc = dc;
    entries.push(normalized);
  }

  if (!entries.length && allowFallback) {
    const fallbackSkillValue =
      typeof fallbackSkill === "string" ? fallbackSkill.trim() : "";
    const fallbackNumericDc = Number(fallbackDc);
    const fallbackDcValue =
      Number.isFinite(fallbackNumericDc) && fallbackNumericDc > 0
        ? Number(fallbackNumericDc)
        : null;
    if (fallbackSkillValue || fallbackDcValue !== null) {
      const normalized = {};
      if (fallbackSkillValue) normalized.skill = fallbackSkillValue;
      normalized.dc = fallbackDcValue;
      entries.push(normalized);
    }
  }

  const seen = new Set();
  const unique = [];
  for (const entry of entries) {
    const key = `${entry.skill ?? ""}::${entry.dc ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  return unique;
}

/**
 * @typedef {object} ResearchRevealThreshold
 * @property {string} id
 * @property {number} points
 * @property {string} [gmText]
 * @property {string} [playerText]
 * @property {number|null} [revealedAt]
 */

/**
 * @typedef {object} ResearchLocation
 * @property {string} id
 * @property {string} name
 * @property {number} maxPoints
 * @property {number} collected
 * @property {string} [skill]
 * @property {number|null} [dc]
 * @property {{ skill?: string; dc: number|null }[]} [checks]
 * @property {string} [description]
 * @property {{uuid: string, name?: string}[]} [assignedActors]
 * @property {boolean} [isRevealed]
 * @property {number|null} [revealedAt]
 */

/**
 * @typedef {object} ResearchTopic
 * @property {string} id
 * @property {string} name
 * @property {number} progress
 * @property {number} target
 * @property {number|null} [level]
 * @property {string} [summary]
 * @property {string} [gatherInformation]
 * @property {string} [researchChecks]
 * @property {ResearchLocation[]} locations
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

    await this._runMigrations(stored);
  }

  /**
   * Persist state into the world setting.
   */
  async _saveState() {
    if (!this._initialized || !game?.settings?.set) return;

    const payload = {
      topics: this.getTopics().map((topic) => {
        const { progressPercent, thresholds, locations, ...rest } = topic;
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
      locations: (locations ?? []).map((location) => {
        const checks = sanitizeCheckArray(
          location.checks ??
            ((location.skill || location.dc !== undefined)
              ? [{ skill: location.skill, dc: location.dc }]
              : []),
          {
            fallbackSkill: location.skill,
            fallbackDc: location.dc,
          }
        );
        const primary = checks[0] ?? {};
        const revealedAt =
          Number.isFinite(location.revealedAt) && location.revealedAt !== null
            ? Number(location.revealedAt)
            : null;
        const hasRevealProps =
          Object.prototype.hasOwnProperty.call(location ?? {}, "isRevealed") ||
          Object.prototype.hasOwnProperty.call(location ?? {}, "revealedAt");
        const isRevealed =
          typeof location.isRevealed === "boolean"
            ? location.isRevealed
            : revealedAt !== null
            ? true
            : hasRevealProps
            ? false
            : true;
        return {
          id: location.id,
          name: location.name,
          maxPoints: Number.isFinite(location.maxPoints)
            ? Number(location.maxPoints)
            : 0,
          collected: Number.isFinite(location.collected)
            ? Number(location.collected)
            : 0,
          skill:
            typeof location.skill === "string" ? location.skill : primary.skill ?? "",
          dc:
            Number.isFinite(location.dc)
              ? Number(location.dc)
              : typeof primary.dc === "number"
              ? primary.dc
              : null,
          checks: checks.map((entry) => ({
            ...(entry.skill ? { skill: entry.skill } : {}),
            dc:
              Number.isFinite(entry.dc) && entry.dc > 0 ? Number(entry.dc) : null,
          })),
          description:
            typeof location.description === "string" ? location.description : "",
          assignedActors: normalizeAssignedActors(location.assignedActors ?? []).map(
            (actor) => ({
              uuid: actor.uuid,
              ...(actor.name ? { name: actor.name } : {}),
            })
          ),
          isRevealed,
          revealedAt,
        };
      }),
    };
  }),
      log: this.getLog().map((entry) => ({ ...entry })),
    };
    await game.settings.set(this.moduleId, this.settingKey, payload);
  }

  async _runMigrations(storedState) {
    if (!this._initialized) return;
    const storedTopics = Array.isArray(storedState?.topics) ? storedState.topics : [];
    const needsCheckMigration = storedTopics.some((topic) => {
      if (!topic || typeof topic !== "object") return false;
      const locations = Array.isArray(topic.locations) ? topic.locations : [];
      return locations.some((location) => {
        if (!location || typeof location !== "object") return false;
        if (Array.isArray(location.checks)) return false;
        return (
          typeof location.skill === "string" ||
          location.dc !== undefined ||
          location.checks !== undefined
        );
      });
    });

    const needsRevealMigration = storedTopics.some((topic) => {
      if (!topic || typeof topic !== "object") return false;
      const locations = Array.isArray(topic.locations) ? topic.locations : [];
      return locations.some((location) => {
        if (!location || typeof location !== "object") return false;
        const hasIsRevealed = Object.prototype.hasOwnProperty.call(
          location,
          "isRevealed"
        );
        const hasRevealedAt = Object.prototype.hasOwnProperty.call(
          location,
          "revealedAt"
        );
        return !hasIsRevealed && !hasRevealedAt;
      });
    });

    if (!needsCheckMigration && !needsRevealMigration) return;

    try {
      await this._saveState();
    } catch (error) {
      console.error("pf2e-points-tracker | Failed to migrate research tracker data.", error);
    }
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
      level: data.level,
      summary: data.summary ?? "",
      gatherInformation: data.gatherInformation ?? "",
      researchChecks: data.researchChecks ?? "",
      thresholds: Array.isArray(data.thresholds) ? data.thresholds : [],
      locations: Array.isArray(data.locations) ? data.locations : [],
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
   * Modify the number of research points on a topic.
   * @param {string} topicId
   * @param {number} delta
   * @param {object} [metadata]
   */
  async adjustPoints(topicId, delta, metadata = {}) {
    const topic = this.topics.get(topicId);
    if (!topic) return;
    const locationId = metadata.locationId;

    if (locationId && (topic.locations ?? []).length) {
      await this.adjustLocationPoints(topicId, locationId, delta, metadata);
      return;
    }

    if ((topic.locations ?? []).length) {
      console.warn(
        "Adjusting topic points directly is not supported when locations are defined. Provide a locationId in metadata instead."
      );
      return;
    }
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
   * Create a new location on a topic.
   * @param {string} topicId
   * @param {Partial<ResearchLocation>} data
   */
  async createLocation(topicId, data = {}) {
    const topic = this.topics.get(topicId);
    if (!topic) return;

    const id = data.id ?? createId();
    const assignedActors = normalizeAssignedActors(
      data.assignedActors ?? data.assignedActorIds ?? data.assignedActorUuids ?? []
    );
    const checks = sanitizeCheckArray(
      data.checks ??
        ((data.skill || data.dc !== undefined)
          ? [{ skill: data.skill, dc: data.dc }]
          : []),
      {
        fallbackSkill:
          typeof data.skill === "string"
            ? data.skill
            : typeof topic.skill === "string"
            ? topic.skill
            : "",
        fallbackDc: data.dc,
      }
    );
    const primaryCheck = checks[0] ?? {};
    const providedRevealedAt =
      Number.isFinite(data.revealedAt) && data.revealedAt !== null
        ? Number(data.revealedAt)
        : null;
    const hasRevealProps =
      Object.prototype.hasOwnProperty.call(data, "isRevealed") ||
      Object.prototype.hasOwnProperty.call(data, "revealedAt");
    const isRevealed =
      typeof data.isRevealed === "boolean"
        ? data.isRevealed
        : providedRevealedAt !== null
        ? true
        : hasRevealProps
        ? false
        : false;
    const locations = Array.isArray(topic.locations)
      ? topic.locations.slice()
      : [];
    locations.push({
      id,
      name:
        data.name ??
        game?.i18n?.localize?.("PF2E.PointsTracker.Research.LocationDefaultName") ??
          "Location",
      maxPoints: Number.isFinite(data.maxPoints) ? Number(data.maxPoints) : 0,
      collected: Number.isFinite(data.collected) ? Number(data.collected) : 0,
      skill:
        typeof data.skill === "string"
          ? data.skill.trim()
          : typeof primaryCheck.skill === "string"
          ? primaryCheck.skill
          : typeof topic.skill === "string"
          ? topic.skill
          : "",
      dc: Number.isFinite(data.dc)
        ? Number(data.dc)
        : typeof primaryCheck.dc === "number"
        ? primaryCheck.dc
        : null,
      checks,
      description:
        typeof data.description === "string"
          ? data.description.trim()
          : "",
      assignedActors,
      isRevealed,
      revealedAt: isRevealed ? providedRevealedAt ?? Date.now() : null,
    });

    const normalized = this._normalizeTopic({ ...topic, locations });
    this.topics.set(topicId, normalized);
    await this._saveState();
    return normalized.locations.find((location) => location.id === id);
  }

  /**
   * Update an existing location on a topic.
   * @param {string} topicId
   * @param {string} locationId
   * @param {Partial<ResearchLocation>} updates
   */
  async updateLocation(topicId, locationId, updates) {
    const topic = this.topics.get(topicId);
    if (!topic) return;

    const locations = Array.isArray(topic.locations)
      ? topic.locations.slice()
      : [];
    const index = locations.findIndex((location) => location.id === locationId);
    if (index === -1) return;

    const existing = locations[index];
    const assignmentProvided =
      Object.prototype.hasOwnProperty.call(updates, "assignedActors") ||
      Object.prototype.hasOwnProperty.call(updates, "assignedActorIds") ||
      Object.prototype.hasOwnProperty.call(updates, "assignedActorUuids");
    const sanitizedAssignments = assignmentProvided
      ? normalizeAssignedActors(
          updates.assignedActors ??
            updates.assignedActorIds ??
            updates.assignedActorUuids ??
            []
        )
      : existing.assignedActors;

    const {
      assignedActorIds,
      assignedActorUuids,
      checks: rawChecks,
      revealedAt: rawRevealedAt,
      isRevealed: rawIsRevealed,
      ...rest
    } = updates;
    const skillProvided = Object.prototype.hasOwnProperty.call(rest, "skill");
    const dcProvided = Object.prototype.hasOwnProperty.call(rest, "dc");
    const checksProvided = Object.prototype.hasOwnProperty.call(updates, "checks");

    let updatedChecks = sanitizeCheckArray(
      Array.isArray(existing.checks) ? existing.checks : existing.checks ?? [],
      {
        fallbackSkill: existing.skill ?? topic.skill ?? "",
        fallbackDc: existing.dc,
      }
    );

    if (checksProvided || skillProvided || dcProvided) {
      const fallbackSkillValue = skillProvided
        ? rest.skill
        : existing.skill ?? topic.skill ?? "";
      const fallbackDcValue = dcProvided ? rest.dc : existing.dc;
      const checkSource = checksProvided
        ? rawChecks
        : [
            {
              skill: fallbackSkillValue,
              dc: fallbackDcValue,
            },
          ];
      updatedChecks = sanitizeCheckArray(checkSource, {
        fallbackSkill: fallbackSkillValue,
        fallbackDc: fallbackDcValue,
        allowFallback: !checksProvided,
      });
    }

    const primaryCheck = updatedChecks[0] ?? {};
    const revealProvided =
      Object.prototype.hasOwnProperty.call(updates, "isRevealed") ||
      Object.prototype.hasOwnProperty.call(updates, "revealedAt");
    const updatedRevealedAt =
      Number.isFinite(rawRevealedAt) && rawRevealedAt !== null
        ? Number(rawRevealedAt)
        : null;
    const updatedRevealState =
      typeof rawIsRevealed === "boolean"
        ? rawIsRevealed
        : updatedRevealedAt !== null
        ? true
        : undefined;

    locations.splice(index, 1, {
      ...existing,
      ...rest,
      id: locationId,
      assignedActors: sanitizedAssignments,
      checks: updatedChecks,
      ...(skillProvided
        ? {}
        : {
            skill:
              typeof primaryCheck.skill === "string"
                ? primaryCheck.skill
                : typeof existing.skill === "string"
                ? existing.skill
                : primaryCheck.skill ?? existing.skill ?? "",
          }),
      ...(dcProvided
        ? {}
        : {
            dc:
              typeof primaryCheck.dc === "number"
                ? primaryCheck.dc
                : Number.isFinite(existing.dc)
                ? Number(existing.dc)
                : existing.dc ?? null,
          }),
      ...(revealProvided
        ? {
            isRevealed:
              updatedRevealState !== undefined
                ? updatedRevealState
                : existing.isRevealed ?? false,
            revealedAt:
              updatedRevealState === false
                ? null
                : updatedRevealedAt ?? existing.revealedAt ?? Date.now(),
          }
        : {}),
    });

    const normalized = this._normalizeTopic({ ...topic, locations });
    this.topics.set(topicId, normalized);
    await this._saveState();
    return normalized.locations.find((location) => location.id === locationId);
  }

  /**
   * Remove a location from a topic.
   * @param {string} topicId
   * @param {string} locationId
   */
  async deleteLocation(topicId, locationId) {
    const topic = this.topics.get(topicId);
    if (!topic) return;

    const locations = (topic.locations ?? []).filter(
      (location) => location.id !== locationId
    );

    const normalized = this._normalizeTopic({ ...topic, locations });
    this.topics.set(topicId, normalized);
    await this._saveState();
  }

  /**
   * Adjust collected points at a specific location.
   * @param {string} topicId
   * @param {string} locationId
   * @param {number} delta
   * @param {object} [metadata]
   */
  async adjustLocationPoints(topicId, locationId, delta, metadata = {}) {
    const topic = this.topics.get(topicId);
    if (!topic) return;

    const locations = Array.isArray(topic.locations)
      ? topic.locations.slice()
      : [];
    const index = locations.findIndex((location) => location.id === locationId);
    if (index === -1) return;

    const existing = { ...locations[index] };
    const maxPoints = Number.isFinite(existing.maxPoints)
      ? Number(existing.maxPoints)
      : 0;
    const current = Number.isFinite(existing.collected)
      ? Number(existing.collected)
      : 0;
    const change = Number(delta ?? 0);
    const newValue = Math.max(
      0,
      Math.min(maxPoints || Number.POSITIVE_INFINITY, current + change)
    );
    existing.collected = Number.isFinite(newValue) ? Number(newValue) : 0;
    locations.splice(index, 1, existing);

    const normalized = this._normalizeTopic({ ...topic, locations });
    this.topics.set(topicId, normalized);
    await this._saveState();

    if (change !== 0) {
      const { actorUuid, actorName, reason, roll } = metadata;
      await this.recordLog({
        topicId,
        message:
          reason ?? this._buildDefaultLogMessage(change, existing.name ?? ""),
        points: change,
        actorUuid,
        actorName,
        roll,
      });
    }

    await this._autoRevealThresholds(topicId);
  }

  /**
   * Reveal a location to players, optionally resending the reveal message.
   * @param {string} topicId
   * @param {string} locationId
   * @param {object} [options]
   * @param {boolean} [options.resend=false]
   */
  async sendLocationReveal(topicId, locationId, { resend = false } = {}) {
    const topic = this.topics.get(topicId);
    if (!topic) return;

    const locations = Array.isArray(topic.locations) ? topic.locations : [];
    const location = locations.find((entry) => entry.id === locationId);
    if (!location) return;

    const alreadyRevealed = Boolean(location.isRevealed);
    if (!alreadyRevealed) {
      location.isRevealed = true;
      location.revealedAt = Date.now();
      this.topics.set(topicId, this._normalizeTopic(topic));
      await this._saveState();
    } else if (!resend) {
      // If already revealed and not resending, still refresh location reference.
      this.topics.set(topicId, this._normalizeTopic(topic));
    }

    const normalizedTopic = this.getTopic(topicId);
    const normalizedLocation = normalizedTopic?.locations?.find(
      (entry) => entry.id === locationId
    );

    await this._notifyLocationReveal(normalizedTopic, normalizedLocation ?? location, {
      resend: resend && alreadyRevealed,
    });

    const logKey = resend
      ? "PF2E.PointsTracker.Research.LocationResendLog"
      : "PF2E.PointsTracker.Research.LocationRevealLog";
    await this.recordLog({
      topicId,
      message:
        game?.i18n?.format?.(logKey, {
          topic: normalizedTopic?.name ?? "",
          location: normalizedLocation?.name ?? location.name ?? "",
        }) ?? `${resend ? "Resent" : "Sent"} reveal for ${normalizedLocation?.name ?? location.name ?? ""}.`,
    });
  }

  /**
   * Internal helper to create a log message when none is provided.
   * @param {number} points
   * @returns {string}
   */
  _buildDefaultLogMessage(points, locationName = "") {
    const locationSuffix = locationName
      ? game?.i18n?.format?.(
          "PF2E.PointsTracker.Research.LocationLogSuffix",
          { location: locationName }
        ) ?? ` (${locationName})`
      : "";
    if (points > 0) {
      const base =
        game?.i18n?.format?.("PF2E.PointsTracker.Research.PointsEarned", {
          points,
        }) ?? `Earned ${points} RP`;
      return `${base}${locationSuffix}`;
    } else if (points < 0) {
      const base =
        game?.i18n?.format?.("PF2E.PointsTracker.Research.PointsSpent", {
          points: Math.abs(points),
        }) ?? `Spent ${Math.abs(points)} RP`;
      return `${base}${locationSuffix}`;
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
    const { locations, totalCollected, totalMax } = this._normalizeLocations(
      topic
    );
    const rawTarget = Number.isFinite(topic.target) ? Number(topic.target) : 0;
    const rawProgress = Number.isFinite(topic.progress)
      ? Number(topic.progress)
      : 0;
    const hasLocations = locations.length > 0;
    const target = hasLocations ? totalMax : rawTarget;
    const progress = hasLocations
      ? Math.min(totalCollected, target || totalCollected)
      : Math.max(rawProgress, 0);
    const { thresholds, revealedThresholdIds } = this._normalizeThresholds(
      topic,
      progress
    );
    const percent = target > 0 ? Math.min((progress / target) * 100, 100) : 0;
    const numericLevel = Number(topic.level);
    const level = Number.isFinite(numericLevel) ? Number(numericLevel) : null;
    return {
      id: String(topic.id ?? createId()),
      name: topic.name ?? "Research Topic",
      progress,
      target,
      level,
      summary: topic.summary ?? "",
      gatherInformation: topic.gatherInformation ?? "",
      researchChecks: topic.researchChecks ?? "",
      locations,
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

  /**
   * Normalize the locations of a topic.
   * @param {Partial<ResearchTopic>} topic
   * @returns {{ locations: ResearchLocation[]; totalCollected: number; totalMax: number }}
   */
  _normalizeLocations(topic) {
    const rawLocations = Array.isArray(topic.locations)
      ? topic.locations.slice()
      : [];

    const normalized = rawLocations.map((location, index) => {
      const fallbackId = `${topic.id ?? "location"}-${index}`;
      const rawId = location?.id ?? fallbackId;
      const id = String(rawId || createId());
      const name = location?.name
        ? String(location.name)
        : game?.i18n?.localize?.(
            "PF2E.PointsTracker.Research.LocationDefaultName"
          ) ?? "Location";
      const maxPoints = Number.isFinite(location?.maxPoints)
        ? Math.max(Number(location.maxPoints), 0)
        : 0;
      const collectedRaw = Number.isFinite(location?.collected)
        ? Number(location.collected)
        : 0;
      const collected = Math.max(0, Math.min(maxPoints || Number.POSITIVE_INFINITY, collectedRaw));
      const rawChecks =
        location?.checks ??
        location?.skills ??
        (location?.skill !== undefined || location?.dc !== undefined
          ? [
              {
                skill: location?.skill,
                dc: location?.dc,
              },
            ]
          : []);
      const checks = sanitizeCheckArray(rawChecks, {
        fallbackSkill:
          typeof location?.skill === "string"
            ? location.skill
            : typeof topic?.skill === "string"
            ? topic.skill
            : "",
        fallbackDc: location?.dc,
      });
      const primaryCheck = checks[0] ?? {};
      const skill = primaryCheck?.skill
        ? String(primaryCheck.skill).trim()
        : location?.skill
        ? String(location.skill).trim()
        : "";
      const dc = typeof primaryCheck?.dc === "number" ? primaryCheck.dc : null;
      const description = location?.description
        ? String(location.description).trim()
        : "";
      const assignedSource = [];
      if (Array.isArray(location?.assignedActors)) {
        assignedSource.push(...location.assignedActors);
      }
      if (Array.isArray(location?.assignedActorIds)) {
        assignedSource.push(...location.assignedActorIds);
      }
      if (Array.isArray(location?.assignedActorUuids)) {
        assignedSource.push(...location.assignedActorUuids);
      }
      const assignedActors = normalizeAssignedActors(assignedSource);
      const rawRevealedAt =
        Number.isFinite(location?.revealedAt) && location?.revealedAt !== null
          ? Number(location.revealedAt)
          : null;
      const hasRevealProps =
        Object.prototype.hasOwnProperty.call(location ?? {}, "isRevealed") ||
        Object.prototype.hasOwnProperty.call(location ?? {}, "revealedAt");
      const isRevealed =
        typeof location?.isRevealed === "boolean"
          ? location.isRevealed
          : rawRevealedAt !== null
          ? true
          : hasRevealProps
          ? false
          : true;
      return {
        id,
        name,
        maxPoints,
        collected,
        skill,
        dc,
        checks,
        description,
        assignedActors,
        isRevealed,
        revealedAt: isRevealed ? rawRevealedAt : null,
        order: index,
      };
    });

    normalized.sort((a, b) => a.order - b.order);

    const totalCollected = normalized.reduce(
      (sum, location) => sum + (Number.isFinite(location.collected) ? Number(location.collected) : 0),
      0
    );
    const totalMax = normalized.reduce(
      (sum, location) => sum + (Number.isFinite(location.maxPoints) ? Number(location.maxPoints) : 0),
      0
    );

    return {
      locations: normalized.map(({ order, ...entry }) => entry),
      totalCollected,
      totalMax,
    };
  }

  /**
   * Notify the table that a location has been revealed.
   * @param {ResearchTopic} topic
   * @param {ResearchLocation} location
   * @param {object} [options]
   * @param {boolean} [options.resend]
   */
  async _notifyLocationReveal(topic, location, { resend = false } = {}) {
    if (!topic || !location) return;
    if (!game?.users) return;

    const headerText =
      game?.i18n?.format?.("PF2E.PointsTracker.Research.LocationRevealMessageHeader", {
        topic: topic.name ?? "",
        location: location.name ?? "",
      }) ?? `${topic.name ?? ""} - ${location.name ?? ""}`;

    const description =
      typeof location.description === "string" ? location.description.trim() : "";
    const enrichedDescription = description
      ? await this._enrichText(description)
      : "";

    const playerRecipients = game.users
      .filter((user) => !user.isGM)
      .map((user) => user.id);
    const gmRecipients = ChatMessage?.getWhisperRecipients
      ? ChatMessage.getWhisperRecipients("GM").map((user) => user.id)
      : [];

    const playerContentParts = [`<p><strong>${headerText}</strong></p>`];
    if (enrichedDescription) {
      playerContentParts.push(`<div>${enrichedDescription}</div>`);
    }
    const playerMessage = `<div class="pf2e-research-reveal pf2e-research-reveal--player">${playerContentParts.join(
      ""
    )}</div>`;

    if (playerRecipients.length) {
      await ChatMessage?.create?.({
        user: game.user?.id,
        speaker: { alias: topic.name },
        content: playerMessage,
        whisper: playerRecipients,
      });
    } else {
      await ChatMessage?.create?.({
        user: game.user?.id,
        speaker: { alias: topic.name },
        content: playerMessage,
      });
    }

    const gmParts = [`<p><strong>${headerText}</strong></p>`];
    if (enrichedDescription) {
      gmParts.push(`<div>${enrichedDescription}</div>`);
    }

    const escapeHtml = (value) => {
      if (typeof value !== "string") return "";
      if (foundry?.utils?.escapeHTML) {
        try {
          return foundry.utils.escapeHTML(value);
        } catch (error) {
          console.error(error);
        }
      }
      const lookup = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return value.replace(/[&<>"']/g, (char) => lookup[char] ?? char);
    };

    const checkSummaries = Array.isArray(location.checks)
      ? location.checks
          .map((entry) => {
            const skill =
              typeof entry?.skill === "string" ? entry.skill.trim() : "";
            const dcValue = Number(entry?.dc);
            const dc = Number.isFinite(dcValue) && dcValue > 0 ? Number(dcValue) : null;
            const parts = [];
            if (skill) {
              const skillLabel =
                game?.i18n?.format?.("PF2E.PointsTracker.Research.LocationSkillLabel", {
                  skill,
                }) ?? `Skill: ${skill}`;
              parts.push(skillLabel);
            }
            if (dc !== null) {
              const dcLabel =
                game?.i18n?.format?.("PF2E.PointsTracker.Research.LocationDCLabel", {
                  dc,
                }) ?? `DC: ${dc}`;
              parts.push(dcLabel);
            }
            if (!parts.length) return null;
            return `<li>${escapeHtml(parts.join(" • "))}</li>`;
          })
          .filter((entry) => entry)
      : [];

    if (checkSummaries.length) {
      gmParts.push(
        `<p><strong>${
          game?.i18n?.localize?.("PF2E.PointsTracker.Research.LocationRevealChecks") ?? "Checks"
        }</strong></p><ul>${checkSummaries.join("")}</ul>`
      );
    }

    const assignedNames = Array.isArray(location.assignedActors)
      ? location.assignedActors
          .map((actor) => {
            const name =
              typeof actor?.name === "string"
                ? actor.name.trim()
                : typeof actor?.uuid === "string"
                ? actor.uuid.trim()
                : "";
            return name ? `<li>${escapeHtml(name)}</li>` : null;
          })
          .filter((entry) => entry)
      : [];

    if (assignedNames.length) {
      gmParts.push(
        `<p><strong>${
          game?.i18n?.localize?.(
            "PF2E.PointsTracker.Research.LocationRevealAssignments"
          ) ?? "Assignments"
        }</strong></p><ul>${assignedNames.join("")}</ul>`
      );
    }

    if (gmRecipients.length) {
      await ChatMessage?.create?.({
        user: game.user?.id,
        speaker: { alias: topic.name },
        content: `<div class="pf2e-research-reveal pf2e-research-reveal--gm">${gmParts.join(
          ""
        )}</div>`,
        whisper: gmRecipients,
      });
    }
  }
}

export function createResearchTracker(options) {
  return new ResearchTracker(options);
}
