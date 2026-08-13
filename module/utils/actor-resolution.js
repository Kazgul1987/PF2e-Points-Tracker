import { logger } from "./logger.js";

/** Resolve an Actor, TokenDocument, UUID, or world Actor id without storing document data. */
export async function resolveActorReference(reference) {
  if (!reference) return null;
  const document = reference?.document ?? reference;
  if (document?.actor) return document.actor;
  if (document?.documentName === "Actor") return document;

  const identifier = typeof reference === "string" ? reference.trim() : reference?.uuid ?? reference?.id;
  if (!identifier) return null;
  try {
    const resolved = identifier.includes(".") && typeof globalThis.fromUuid === "function"
      ? await globalThis.fromUuid(identifier)
      : globalThis.game?.actors?.get(identifier);
    return resolved?.actor ?? (resolved?.documentName === "Actor" ? resolved : null);
  } catch (error) {
    logger.warn(`Unable to resolve actor reference ${identifier}.`, error);
    return null;
  }
}
