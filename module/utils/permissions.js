import { MODULE_ID } from "./logger.js";

export const TrackerPermission = Object.freeze({
  READ: "read",
  ROLL: "roll",
  MODIFY: "modify",
  REVEAL: "reveal",
  ASSIGN_ACTOR: "assignActor",
  IMPORT_EXPORT: "importExport",
  DELETE: "delete",
});

/** Read and roll remain available to players; persistent world mutations require a GM. */
export function canPerformTrackerAction(action, user = globalThis.game?.user) {
  if (action === TrackerPermission.READ || action === TrackerPermission.ROLL) return true;
  return Boolean(user?.isGM);
}

export function assertTrackerPermission(action, user = globalThis.game?.user) {
  if (canPerformTrackerAction(action, user)) return;
  throw new Error(`${MODULE_ID} | User is not allowed to perform tracker action: ${action}.`);
}
