const MODULE_ID = "pf2e-points-tracker";

function createLocalId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10);
}

function clampNumber(value, { min = -999999, max = 999999, fallback = 0 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function sanitizeString(value) {
  if (typeof value !== "string") return undefined;
  return value.trim();
}

function sanitizeStructured(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return clampNumber(value);
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    const sanitized = value
      .map((entry) => sanitizeStructured(entry))
      .filter((entry) => {
        if (entry === undefined) return false;
        if (Array.isArray(entry)) return entry.length > 0;
        if (entry && typeof entry === "object") return Object.keys(entry).length > 0;
        return true;
      });
    return sanitized.length ? sanitized : undefined;
  }
  if (value && typeof value === "object") {
    const sanitizedObject = Object.entries(value).reduce((acc, [key, entry]) => {
      const sanitizedEntry = sanitizeStructured(entry);
      if (sanitizedEntry === undefined) return acc;
      acc[key] = sanitizedEntry;
      return acc;
    }, {});
    return Object.keys(sanitizedObject).length ? sanitizedObject : undefined;
  }
  return undefined;
}

function sanitizeLocationEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = entry.id ? String(entry.id) : createLocalId();
  const name = sanitizeString(entry.name);
  const maxPoints = clampNumber(entry.maxPoints, {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    fallback: 0,
  });
  const collected = clampNumber(entry.collected, {
    min: 0,
    max: maxPoints || Number.MAX_SAFE_INTEGER,
    fallback: 0,
  });
  const payload = {
    id,
    maxPoints,
    collected,
  };
  if (name) payload.name = name;
  return payload;
}

function sanitizeLocationTotals(source, entries) {
  if (source && typeof source === "object") {
    const collected = clampNumber(source.collected, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      fallback: 0,
    });
    const max = clampNumber(source.max, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
      fallback: 0,
    });
    return { collected, max };
  }
  if (Array.isArray(entries) && entries.length) {
    const collected = entries.reduce(
      (sum, entry) => sum + (Number.isFinite(entry.collected) ? Number(entry.collected) : 0),
      0
    );
    const max = entries.reduce(
      (sum, entry) => sum + (Number.isFinite(entry.maxPoints) ? Number(entry.maxPoints) : 0),
      0
    );
    return { collected, max };
  }
  return undefined;
}

function buildLocationObject({ entries = [], totals } = {}) {
  const result = {};
  if (entries.length) result.entries = entries;
  if (totals) result.totals = totals;
  return Object.keys(result).length ? result : undefined;
}

function sanitizeLocations(value) {
  const rawEntries = Array.isArray(value)
    ? value
    : Array.isArray(value?.entries)
    ? value.entries
    : [];
  const entries = rawEntries
    .map((entry) => sanitizeLocationEntry(entry))
    .filter((entry) => entry);

  const totalsSource =
    value && typeof value === "object" && !Array.isArray(value)
      ? value.totals ?? value.locationTotals ?? value.total
      : undefined;
  const totals = sanitizeLocationTotals(totalsSource, entries);

  return { entries, totals };
}

function sanitizeStatblock(rawStatblock, fallbackLocations) {
  if (!rawStatblock || typeof rawStatblock !== "object") return undefined;
  const sanitized = sanitizeStructured(rawStatblock);
  if (!sanitized || typeof sanitized !== "object") return undefined;

  if (sanitized.locations !== undefined) {
    const { entries, totals } = sanitizeLocations(sanitized.locations);
    const normalized = buildLocationObject({ entries, totals });
    if (normalized) sanitized.locations = normalized;
    else delete sanitized.locations;
  } else if (fallbackLocations?.entries?.length || fallbackLocations?.totals) {
    const normalized = buildLocationObject(fallbackLocations);
    if (normalized) sanitized.locations = normalized;
  }

  if (sanitized.knowledgeChecks || sanitized.knowledge) {
    const knowledgeSection =
      sanitized.knowledge && typeof sanitized.knowledge === "object" && !Array.isArray(sanitized.knowledge)
        ? { ...sanitized.knowledge }
        : {};
    if (Array.isArray(sanitized.knowledgeChecks)) {
      knowledgeSection.checks = sanitized.knowledgeChecks;
    } else if (Array.isArray(knowledgeSection.checks)) {
      knowledgeSection.checks = knowledgeSection.checks;
    }
    if (Object.keys(knowledgeSection).length) sanitized.knowledge = knowledgeSection;
    else delete sanitized.knowledge;
    delete sanitized.knowledgeChecks;
  }

  if (sanitized.researchChecks || sanitized.research) {
    const researchSection =
      sanitized.research && typeof sanitized.research === "object" && !Array.isArray(sanitized.research)
        ? { ...sanitized.research }
        : {};
    if (Array.isArray(sanitized.researchChecks)) {
      researchSection.checks = sanitized.researchChecks;
    } else if (Array.isArray(researchSection.checks)) {
      researchSection.checks = researchSection.checks;
    }
    if (Object.keys(researchSection).length) sanitized.research = researchSection;
    else delete sanitized.research;
    delete sanitized.researchChecks;
  }

  return Object.keys(sanitized).length ? sanitized : undefined;
}

function sanitizeParticipant(participant) {
  if (!participant || typeof participant !== "object") return null;
  const id = participant.id ? String(participant.id) : createLocalId();
  const name = participant.name ? String(participant.name) : undefined;
  const actorUuid = participant.actorUuid ? String(participant.actorUuid) : "";
  const skill = participant.skill ? String(participant.skill) : undefined;
  const role = participant.role ? String(participant.role) : undefined;
  return {
    id,
    ...(name ? { name } : {}),
    actorUuid,
    ...(skill ? { skill } : {}),
    ...(role ? { role } : {}),
  };
}

function sanitizeThreshold(threshold) {
  if (!threshold || typeof threshold !== "object") return null;
  const points = Number.isFinite(threshold.points) ? Number(threshold.points) : 0;
  return {
    ...(threshold.id ? { id: String(threshold.id) } : {}),
    points,
    gmText: typeof threshold.gmText === "string" ? threshold.gmText : "",
    playerText: typeof threshold.playerText === "string" ? threshold.playerText : "",
    revealedAt: Number.isFinite(threshold.revealedAt)
      ? Number(threshold.revealedAt)
      : null,
  };
}

function sanitizeTopic(topic) {
  if (!topic || typeof topic !== "object") return null;
  const name = typeof topic.name === "string" ? topic.name.trim() : "";
  if (!name) return null;

  const statblockSource = topic.statblock && typeof topic.statblock === "object"
    ? topic.statblock
    : undefined;

  const summary = sanitizeString(topic.summary ?? statblockSource?.summary);
  const gatherInformation = sanitizeString(
    topic.gatherInformation ?? statblockSource?.gatherInformation
  );
  const researchChecks = sanitizeString(
    topic.researchChecks ??
      statblockSource?.researchChecks ??
      (statblockSource?.research &&
        typeof statblockSource.research === "object"
        ? statblockSource.research.text
        : undefined)
  );

  const thresholds = Array.isArray(topic.thresholds)
    ? topic.thresholds
        .map((entry) => sanitizeThreshold(entry))
        .filter((entry) => entry)
        .sort((a, b) => a.points - b.points)
    : [];

  const revealed = Array.isArray(topic.revealedThresholdIds)
    ? topic.revealedThresholdIds.map((id) => String(id))
    : [];

  const participants = Array.isArray(topic.participants)
    ? topic.participants
        .map((entry) => sanitizeParticipant(entry))
        .filter((entry) => entry)
    : [];

  const { entries: locations, totals: locationTotals } = sanitizeLocations(
    topic.locations !== undefined ? topic.locations : statblockSource?.locations
  );

  const statblock = sanitizeStatblock(statblockSource, {
    entries: locations,
    totals: locationTotals,
  });

  if (statblock) {
    if (summary !== undefined) statblock.summary = summary;
    if (gatherInformation !== undefined) statblock.gatherInformation = gatherInformation;

    const locationsPayload = buildLocationObject({
      entries: locations,
      totals: locationTotals,
    });
    if (locationsPayload) statblock.locations = locationsPayload;
    else delete statblock.locations;

    const knowledgeSection =
      statblock.knowledge && typeof statblock.knowledge === "object" && !Array.isArray(statblock.knowledge)
        ? { ...statblock.knowledge }
        : {};
    if (Array.isArray(statblock.knowledgeChecks)) {
      knowledgeSection.checks = statblock.knowledgeChecks;
    } else if (Array.isArray(statblock.knowledge?.checks)) {
      knowledgeSection.checks = statblock.knowledge.checks;
    }
    if (Object.keys(knowledgeSection).length) {
      statblock.knowledge = knowledgeSection;
    } else {
      delete statblock.knowledge;
    }
    delete statblock.knowledgeChecks;

    const researchSection =
      statblock.research && typeof statblock.research === "object" && !Array.isArray(statblock.research)
        ? { ...statblock.research }
        : {};
    if (Array.isArray(statblock.researchChecks)) {
      researchSection.checks = statblock.researchChecks;
    } else if (Array.isArray(statblock.research?.checks)) {
      researchSection.checks = statblock.research.checks;
    }
    if (researchChecks !== undefined) researchSection.text = researchChecks;
    if (Object.keys(researchSection).length) {
      statblock.research = researchSection;
    } else {
      delete statblock.research;
    }
    delete statblock.researchChecks;
  }

  const payload = {
    ...(topic.id ? { id: String(topic.id) } : {}),
    name,
    progress: Number.isFinite(topic.progress) ? Number(topic.progress) : 0,
    target: Number.isFinite(topic.target) ? Number(topic.target) : 0,
    difficulty:
      typeof topic.difficulty === "string" ? topic.difficulty.trim() : undefined,
    skill: typeof topic.skill === "string" ? topic.skill.trim() : undefined,
    ...(summary !== undefined ? { summary } : {}),
    ...(gatherInformation !== undefined ? { gatherInformation } : {}),
    ...(researchChecks !== undefined ? { researchChecks } : {}),
    thresholds,
    revealedThresholdIds: revealed,
    participants,
    locations,
    ...(locationTotals ? { locationTotals } : {}),
    ...(statblock ? { statblock } : {}),
  };

  const knowledgeChecks = Array.isArray(statblock?.knowledgeChecks)
    ? statblock.knowledgeChecks
    : Array.isArray(statblock?.knowledge?.checks)
    ? statblock.knowledge.checks
    : undefined;
  if (Array.isArray(knowledgeChecks) && knowledgeChecks.length) {
    payload.knowledgeChecks = knowledgeChecks;
  }

  const researchCheckEntries = Array.isArray(statblock?.researchChecks)
    ? statblock.researchChecks
    : Array.isArray(statblock?.research?.checks)
    ? statblock.research.checks
    : undefined;
  if (Array.isArray(researchCheckEntries) && researchCheckEntries.length) {
    payload.researchCheckEntries = researchCheckEntries;
  }

  return payload;
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const topics = Array.isArray(payload.topics) ? payload.topics : [];
  return topics
    .map((topic) => sanitizeTopic(topic))
    .filter((topic) => topic);
}

async function mergeTopic(tracker, topicData) {
  const existingById = topicData.id ? tracker.getTopic(topicData.id) : undefined;
  const existingByName = existingById
    ? undefined
    : tracker.getTopics().find((candidate) => candidate.name === topicData.name);
  const existing = existingById ?? existingByName;

  const payload = {
    id: topicData.id,
    name: topicData.name,
    progress: topicData.progress,
    target: topicData.target,
    difficulty: topicData.difficulty,
    skill: topicData.skill,
    summary: topicData.summary,
    gatherInformation: topicData.gatherInformation,
    researchChecks: topicData.researchChecks,
    participants: topicData.participants,
    thresholds: topicData.thresholds,
    locations: topicData.locations,
    revealedThresholdIds: topicData.revealedThresholdIds,
    ...(topicData.statblock ? { statblock: topicData.statblock } : {}),
    ...(Array.isArray(topicData.knowledgeChecks)
      ? { knowledgeChecks: topicData.knowledgeChecks }
      : {}),
    ...(Array.isArray(topicData.researchCheckEntries)
      ? { researchCheckEntries: topicData.researchCheckEntries }
      : {}),
  };

  if (existing) {
    await tracker.updateTopic(existing.id, payload);
    return { type: "updated", id: existing.id };
  }

  const created = await tracker.createTopic(payload);
  return { type: "created", id: created?.id ?? payload.id };
}

function buildExportPayload(tracker) {
  const topics = tracker.getTopics().map((topic) => {
    const { progressPercent, ...rest } = topic;

    const summary = sanitizeString(rest.summary ?? "") ?? "";
    const gatherInformation = sanitizeString(rest.gatherInformation ?? "") ?? "";
    const researchChecks = sanitizeString(rest.researchChecks ?? "") ?? "";

    const participants = (rest.participants ?? [])
      .map((participant) => sanitizeParticipant(participant))
      .filter((participant) => participant);

    const thresholds = (rest.thresholds ?? [])
      .map((threshold) => sanitizeThreshold(threshold))
      .filter((threshold) => threshold);

    const { entries: locations, totals: locationTotals } = sanitizeLocations(
      rest.locations ?? []
    );

    const statblockSource = rest.statblock && typeof rest.statblock === "object"
      ? rest.statblock
      : undefined;
    const baseStatblock = sanitizeStatblock(statblockSource, {
      entries: locations,
      totals: locationTotals,
    }) ?? {};

    const knowledgeChecksData = sanitizeStructured(rest.knowledgeChecks);
    if (Array.isArray(knowledgeChecksData)) {
      const knowledgeSection =
        baseStatblock.knowledge && typeof baseStatblock.knowledge === "object" && !Array.isArray(baseStatblock.knowledge)
          ? { ...baseStatblock.knowledge, checks: knowledgeChecksData }
          : { checks: knowledgeChecksData };
      baseStatblock.knowledge = knowledgeSection;
    }

    const researchChecksData = sanitizeStructured(rest.researchCheckEntries);
    if (Array.isArray(researchChecksData)) {
      const researchSection =
        baseStatblock.research && typeof baseStatblock.research === "object" && !Array.isArray(baseStatblock.research)
          ? { ...baseStatblock.research, checks: researchChecksData }
          : { checks: researchChecksData };
      baseStatblock.research = researchSection;
    }

    delete baseStatblock.knowledgeChecks;
    delete baseStatblock.researchChecks;

    if (summary !== undefined) baseStatblock.summary = summary;
    if (gatherInformation !== undefined)
      baseStatblock.gatherInformation = gatherInformation;
    if (researchChecks !== undefined) {
      const existingResearch =
        baseStatblock.research &&
        typeof baseStatblock.research === "object" &&
        !Array.isArray(baseStatblock.research)
          ? baseStatblock.research
          : undefined;
      const researchSection = existingResearch ? { ...existingResearch } : {};
      researchSection.text = researchChecks;
      baseStatblock.research = researchSection;
    }
    const locationPayload = buildLocationObject({ entries: locations, totals: locationTotals });
    if (locationPayload) baseStatblock.locations = locationPayload;
    else delete baseStatblock.locations;

    const statblock = Object.keys(baseStatblock).length ? baseStatblock : undefined;

    const exportedKnowledgeChecks = Array.isArray(statblock?.knowledge?.checks)
      ? statblock.knowledge.checks
      : Array.isArray(knowledgeChecksData)
      ? knowledgeChecksData
      : undefined;
    const exportedResearchChecks = Array.isArray(statblock?.research?.checks)
      ? statblock.research.checks
      : Array.isArray(researchChecksData)
      ? researchChecksData
      : undefined;

    return {
      ...rest,
      summary,
      gatherInformation,
      researchChecks,
      participants,
      thresholds,
      locations,
      ...(locationTotals ? { locationTotals } : {}),
      ...(statblock ? { statblock } : {}),
      ...(Array.isArray(exportedKnowledgeChecks) && exportedKnowledgeChecks.length
        ? { knowledgeChecks: exportedKnowledgeChecks }
        : {}),
      ...(Array.isArray(exportedResearchChecks) && exportedResearchChecks.length
        ? { researchCheckEntries: exportedResearchChecks }
        : {}),
    };
  });
  return { topics };
}

export class ResearchImportExport {
  /**
   * Display a prompt to import topics from a JSON file.
   * @param {ResearchTracker} tracker
   */
  static async promptImport(tracker) {
    const content = `
      <form class="flexcol">
        <p>${game.i18n.localize(
          "PF2E.PointsTracker.Research.ImportDescription"
        )}</p>
        <div class="form-group">
          <input type="file" name="import-file" accept=".json,application/json" />
        </div>
      </form>
    `;

    const file = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.ImportTitle"),
      content,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Import"),
      callback: (html) => {
        const input = html[0].querySelector("input[name='import-file']");
        return input?.files?.[0];
      },
      rejectClose: false,
    });

    if (!file) {
      ui.notifications?.warn?.(
        game.i18n.localize("PF2E.PointsTracker.Research.ImportNoFile")
      );
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch (error) {
      console.error(error);
      ui.notifications?.error?.(
        game.i18n.localize("PF2E.PointsTracker.Research.ImportFailure")
      );
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      console.error(error);
      ui.notifications?.error?.(
        game.i18n.localize("PF2E.PointsTracker.Research.ImportInvalid")
      );
      return;
    }

    const topics = sanitizePayload(parsed);
    if (!topics.length) {
      ui.notifications?.warn?.(
        game.i18n.localize("PF2E.PointsTracker.Research.ImportInvalid")
      );
      return;
    }

    let created = 0;
    let updated = 0;
    for (const topic of topics) {
      const result = await mergeTopic(tracker, topic);
      if (result.type === "created") created += 1;
      if (result.type === "updated") updated += 1;
    }

    ui.notifications?.info?.(
      game.i18n.format("PF2E.PointsTracker.Research.ImportSuccess", {
        count: topics.length,
        created,
        updated,
      })
    );
  }

  /**
   * Export the current tracker topics to a JSON file.
   * @param {ResearchTracker} tracker
   */
  static async exportTopics(tracker) {
    const payload = buildExportPayload(tracker);
    const json = JSON.stringify(payload, null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${MODULE_ID}-research-${timestamp}.json`;

    if (typeof saveDataToFile === "function") {
      await saveDataToFile(json, "text/json", filename);
    } else {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 0);
    }

    ui.notifications?.info?.(
      game.i18n.localize("PF2E.PointsTracker.Research.ExportSuccess")
    );
  }
}
