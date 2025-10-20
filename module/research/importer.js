const MODULE_ID = "pf2e-points-tracker";

function createLocalId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2, 10);
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

  return {
    ...(topic.id ? { id: String(topic.id) } : {}),
    name,
    progress: Number.isFinite(topic.progress) ? Number(topic.progress) : 0,
    target: Number.isFinite(topic.target) ? Number(topic.target) : 0,
    difficulty:
      typeof topic.difficulty === "string" ? topic.difficulty : undefined,
    skill: typeof topic.skill === "string" ? topic.skill : undefined,
    summary: typeof topic.summary === "string" ? topic.summary : undefined,
    thresholds,
    revealedThresholdIds: revealed,
    participants,
  };
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
    participants: topicData.participants,
    thresholds: topicData.thresholds,
    revealedThresholdIds: topicData.revealedThresholdIds,
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
    return {
      ...rest,
      participants: (rest.participants ?? []).map((participant) => ({
        id: participant.id,
        name: participant.name,
        actorUuid: participant.actorUuid,
        skill: participant.skill,
        role: participant.role,
      })),
      thresholds: (rest.thresholds ?? []).map((threshold) => ({
        id: threshold.id,
        points: threshold.points,
        gmText: threshold.gmText ?? "",
        playerText: threshold.playerText ?? "",
        revealedAt: Number.isFinite(threshold.revealedAt)
          ? Number(threshold.revealedAt)
          : null,
      })),
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
