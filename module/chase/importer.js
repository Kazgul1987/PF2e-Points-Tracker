import { assertTrackerPermission, TrackerPermission } from "../utils/permissions.js";
import { logger } from "../utils/logger.js";

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function namedEntry(value) {
  if (!record(value) || typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("Each chase entry requires a name.");
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error("Descriptions must be strings.");
  }
  return { name: value.name.trim(), description: value.description?.trim() ?? "" };
}

/** Validate the entire file before importing; runtime IDs and session state are discarded. */
export function sanitizeChaseImportPayload(data) {
  const events = Array.isArray(data) ? data : record(data) && "events" in data ? data.events : [data];
  if (!Array.isArray(events) || !events.length) throw new Error("Expected chase events.");
  return events.map((event) => {
    const normalized = namedEntry(event);
    for (const key of ["obstacles", "opportunities"]) {
      if (event[key] !== undefined && !Array.isArray(event[key])) {
        throw new Error(`${key} must be an array.`);
      }
    }
    normalized.obstacles = (event.obstacles ?? []).map((obstacle) => {
      const entry = namedEntry(obstacle);
      const requiredPoints = obstacle.requiredPoints ?? 0;
      if (typeof requiredPoints !== "number" || !Number.isFinite(requiredPoints) || requiredPoints < 0) {
        throw new Error("requiredPoints must be a nonnegative finite number.");
      }
      const resolutionMode = obstacle.resolutionMode ?? "group";
      if (!["group", "individual"].includes(resolutionMode)) throw new Error("Invalid resolutionMode.");
      return { ...entry, requiredPoints, resolutionMode };
    });
    normalized.opportunities = (event.opportunities ?? []).map(namedEntry);
    return normalized;
  });
}

export class ChaseImportExport {
  static async promptImport(tracker) {
    assertTrackerPermission(TrackerPermission.IMPORT_EXPORT);
    const localize = (key) => game.i18n.localize(`PF2E.PointsTracker.Chase.${key}`);
    const file = await Dialog.prompt({
      title: localize("ImportTitle"),
      content: `<form><p>${localize("ImportDescription")}</p><input type="file" name="import-file" accept=".json,application/json"></form>`,
      label: localize("Import"),
      callback: (html) => html[0].querySelector("input[name='import-file']")?.files?.[0],
      rejectClose: false,
    });
    if (!file) return [];
    let events;
    try {
      events = sanitizeChaseImportPayload(JSON.parse(await file.text()));
    } catch (error) {
      logger.error("Invalid chase import.", error);
      ui.notifications?.error?.(localize("ImportInvalid"));
      return [];
    }
    try {
      const created = await tracker.importEvents(events);
      ui.notifications?.info?.(game.i18n.format("PF2E.PointsTracker.Chase.ImportSuccess", { count: created.length }));
      return created;
    } catch (error) {
      logger.error("Failed to save chase import.", error);
      ui.notifications?.error?.(localize("ImportFailure"));
      return [];
    }
  }
}
