import { logger } from "../utils/logger.js";
const MODULE_ID = "pf2e-points-tracker";

function clampNumber(value, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function sanitizeString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function pickString(...candidates) {
  for (const candidate of candidates) {
    const sanitized = sanitizeString(candidate);
    if (sanitized) return sanitized;
  }
  return undefined;
}

function sanitizeTraits(raw) {
  const source = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
    ? raw.split(/[,;\n]/)
    : raw && typeof raw === "object" && Array.isArray(raw.values)
    ? raw.values
    : [];

  const traits = [];
  const seen = new Set();

  for (const entry of source) {
    const value = sanitizeString(
      typeof entry === "string"
        ? entry
        : typeof entry?.label === "string"
        ? entry.label
        : typeof entry?.name === "string"
        ? entry.name
        : typeof entry?.value === "string"
        ? entry.value
        : typeof entry?.slug === "string"
        ? entry.slug
        : undefined
    );
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    traits.push(value);
  }

  return traits;
}

function sanitizeSkillEntry(entry) {
  if (entry === null || entry === undefined) return null;
  if (typeof entry === "string") {
    const skill = sanitizeString(entry);
    return skill ? { skill } : null;
  }
  if (typeof entry !== "object") return null;

  const skill = pickString(entry.skill, entry.slug, entry.name, entry.label, entry.title);
  const dcSource = entry.dc ?? entry.DC ?? entry.value ?? entry.target ?? entry.dcValue;
  const dcNumber = Number(dcSource);
  const dc = Number.isFinite(dcNumber) ? Number(dcNumber) : null;

  const payload = {};
  if (skill) payload.skill = skill;
  if (dc !== null) payload.dc = dc;
  if (typeof entry.id === "string" && entry.id.trim()) payload.id = entry.id.trim();
  return Object.keys(payload).length ? payload : null;
}

function sanitizeSkillCollection(source) {
  let entriesSource = source;
  let note = undefined;

  if (typeof entriesSource === "string") {
    note = sanitizeString(entriesSource);
    entriesSource = [];
  } else if (entriesSource && typeof entriesSource === "object" && !Array.isArray(entriesSource)) {
    note = sanitizeString(entriesSource.notes ?? entriesSource.note);
    entriesSource = Array.isArray(entriesSource.entries) ? entriesSource.entries : [];
  } else if (!Array.isArray(entriesSource)) {
    entriesSource = [];
  }

  const seen = new Set();
  const entries = [];
  for (const entry of entriesSource) {
    const sanitized = sanitizeSkillEntry(entry);
    if (!sanitized) continue;
    const key = `${sanitized.skill ?? ""}::${sanitized.dc ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(sanitized);
  }

  return { entries, note };
}

function sanitizeThreshold(threshold) {
  if (!threshold || typeof threshold !== "object") return null;

  const points = clampNumber(threshold.points ?? threshold.value ?? threshold.threshold, {
    min: 0,
    fallback: 0,
  });

  const payload = { points };

  if (typeof threshold.id === "string" && threshold.id.trim()) payload.id = threshold.id.trim();

  const gmText = pickString(threshold.gmText, threshold.gmNotes, threshold.gm, threshold.notes);
  if (gmText !== undefined) payload.gmText = gmText;

  const playerText = pickString(
    threshold.playerText,
    threshold.revealText,
    threshold.text,
    threshold.player,
    threshold.description
  );
  if (playerText !== undefined) payload.playerText = playerText;

  const reward = pickString(threshold.reward, threshold.outcome, threshold.effect);
  if (reward !== undefined) payload.reward = reward;

  const revealedAtSource = threshold.revealedAt ?? threshold.revealedOn ?? threshold.revealed;
  const revealedAtNumber = Number(revealedAtSource);
  if (Number.isFinite(revealedAtNumber)) {
    payload.revealedAt = Number(revealedAtNumber);
  } else if (threshold.isRevealed === true) {
    payload.revealedAt = Date.now();
  }

  return payload;
}

function sanitizeThresholds(source) {
  const list = Array.isArray(source)
    ? source
    : source && typeof source === "object" && Array.isArray(source.entries)
    ? source.entries
    : [];

  return list
    .map((entry) => sanitizeThreshold(entry))
    .filter((entry) => entry)
    .sort((a, b) => a.points - b.points);
}

function sanitizeNpc(entry) {
  if (!entry || typeof entry !== "object") return null;

  const biography = entry.biography && typeof entry.biography === "object" ? entry.biography : {};

  const name = pickString(entry.name, entry.title, entry.label);
  const currentInfluence = clampNumber(
    entry.currentInfluence ?? entry.current ?? entry.influence ?? entry.value,
    { min: 0, fallback: 0 }
  );
  const maxInfluence = clampNumber(entry.maxInfluence ?? entry.maximum ?? entry.target ?? entry.max, {
    min: 0,
    fallback: 0,
  });

  const showInfluenceSkillsToPlayers =
    typeof entry.showInfluenceSkillsToPlayers === "boolean"
      ? entry.showInfluenceSkillsToPlayers
      : true;

  const img = pickString(entry.img, entry.image, entry.portrait, entry.thumbnail);
  const imageUuid = pickString(
    entry.imageUuid,
    entry.imageUUID,
    entry.imgUuid,
    entry.portraitUuid,
    entry.imageId
  );

  const skillCollection = sanitizeSkillCollection(
    entry.skillDcs ?? entry.skills ?? entry.skillChecks ?? entry.dcEntries
  );
  const discoveryCollection = sanitizeSkillCollection(
    entry.discoveryChecks ?? entry.discovery ?? entry.discoveryCheckEntries
  );
  const influenceCollection = sanitizeSkillCollection(
    entry.influenceChecks ?? entry.influence ?? entry.influenceCheckEntries
  );

  const discoveryNotes = pickString(entry.discoveryNotes, discoveryCollection.note);
  const influenceNotes = pickString(entry.influenceNotes, influenceCollection.note);

  const npc = {};
  if (name) npc.name = name;
  npc.currentInfluence = currentInfluence;
  npc.maxInfluence = maxInfluence;
  if (img) npc.img = img;
  if (imageUuid) npc.imageUuid = imageUuid;
  if (skillCollection.entries.length) npc.skillDcs = skillCollection.entries;
  if (discoveryCollection.entries.length) npc.discoveryChecks = discoveryCollection.entries;
  if (discoveryNotes !== undefined) npc.discoveryNotes = discoveryNotes;
  if (influenceCollection.entries.length) npc.influenceChecks = influenceCollection.entries;
  if (influenceNotes !== undefined) npc.influenceNotes = influenceNotes;

  const penalty = pickString(entry.penalty, entry.penalties);
  if (penalty !== undefined) npc.penalty = penalty;

  const resistances = pickString(entry.resistances, entry.resistance, entry.resists);
  if (resistances !== undefined) npc.resistances = resistances;

  const weaknesses = pickString(entry.weaknesses, entry.weakness, entry.weak);
  if (weaknesses !== undefined) npc.weaknesses = weaknesses;

  const notes = pickString(entry.notes, entry.note, entry.summary, entry.description);
  if (notes !== undefined) npc.notes = notes;

  const background = pickString(entry.background, entry.backstory, entry.history, entry.bio, biography.background);
  if (background !== undefined) npc.background = background;

  const appearance = pickString(
    entry.appearance,
    entry.description,
    entry.look,
    entry.visual,
    biography.appearance
  );
  if (appearance !== undefined) npc.appearance = appearance;

  const personality = pickString(
    entry.personality,
    entry.behavior,
    entry.attitude,
    entry.mannerisms,
    biography.personality
  );
  if (personality !== undefined) npc.personality = personality;

  const traits = sanitizeTraits(entry.traits ?? entry.trait ?? entry.tags);
  if (traits.length) npc.traits = traits;

  const thresholds = sanitizeThresholds(entry.thresholds ?? entry.reveals ?? entry.rewards);
  if (thresholds.length) npc.thresholds = thresholds;

  npc.showInfluenceSkillsToPlayers = showInfluenceSkillsToPlayers;

  if (Object.prototype.hasOwnProperty.call(entry, "isCollapsed")) {
    npc.isCollapsed = Boolean(entry.isCollapsed);
  }

  const createdAtNumber = Number(entry.createdAt ?? entry.created);
  if (Number.isFinite(createdAtNumber)) npc.createdAt = Number(createdAtNumber);

  const updatedAtNumber = Number(entry.updatedAt ?? entry.updated ?? entry.modifiedAt);
  if (Number.isFinite(updatedAtNumber)) npc.updatedAt = Number(updatedAtNumber);

  return npc;
}

function sanitizePayload(data) {
  const source = (() => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.npcs)) return data.npcs;
    if (Array.isArray(data?.entries)) return data.entries;
    if (Array.isArray(data?.influence?.npcs)) return data.influence.npcs;
    if (Array.isArray(data?.influence)) return data.influence;
    return [];
  })();

  return source
    .map((entry) => sanitizeNpc(entry))
    .filter((entry) => entry && Object.keys(entry).length);
}

export class InfluenceImportExport {
  static sanitize(data) {
    return sanitizePayload(data);
  }

  static async promptImport() {
    const content = `
      <form class="flexcol">
        <p>${game.i18n.localize("PF2E.PointsTracker.Influence.ImportDescription")}</p>
        <div class="form-group">
          <input type="file" name="import-file" accept=".json,application/json" />
        </div>
      </form>
    `;

    const file = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.ImportTitle"),
      content,
      label: game.i18n.localize("PF2E.PointsTracker.Influence.Import"),
      callback: (html) => {
        const input = html[0].querySelector("input[name='import-file']");
        return input?.files?.[0];
      },
      rejectClose: false,
    });

    if (!file) {
      ui.notifications?.warn?.(
        game.i18n.localize("PF2E.PointsTracker.Influence.ImportNoFile")
      );
      return null;
    }

    let text;
    try {
      text = await file.text();
    } catch (error) {
      logger.error(`${MODULE_ID} | Failed to read influence NPC import.`, error);
      ui.notifications?.error?.(
        game.i18n.localize("PF2E.PointsTracker.Influence.ImportFailure")
      );
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      logger.error(`${MODULE_ID} | Failed to parse influence NPC import.`, error);
      ui.notifications?.error?.(
        game.i18n.localize("PF2E.PointsTracker.Influence.ImportInvalid")
      );
      return null;
    }

    const npcs = sanitizePayload(parsed);
    if (!npcs.length) {
      ui.notifications?.warn?.(
        game.i18n.localize("PF2E.PointsTracker.Influence.ImportInvalid")
      );
      return [];
    }

    return npcs;
  }
}

export function sanitizeInfluenceImportPayload(data) {
  return sanitizePayload(data);
}
