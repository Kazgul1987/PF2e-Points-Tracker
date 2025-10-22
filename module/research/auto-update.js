const OUTCOME_POINTS = {
  criticalsuccess: 2,
  success: 1,
  failure: 0,
  criticalfailure: -1,
};

const OUTCOME_LABEL_KEYS = {
  criticalsuccess: "PF2E.PointsTracker.Research.AutoOutcome.criticalSuccess",
  success: "PF2E.PointsTracker.Research.AutoOutcome.success",
  failure: "PF2E.PointsTracker.Research.AutoOutcome.failure",
  criticalfailure: "PF2E.PointsTracker.Research.AutoOutcome.criticalFailure",
};

const processedMessages = new Set();

function extractLocationChecks(location, topic) {
  const entries = Array.isArray(location?.checks) ? location.checks : [];
  const normalized = entries
    .map((check) => {
      const skill = typeof check?.skill === "string" ? check.skill.trim() : "";
      const dcNumber = Number(check?.dc);
      const dc = Number.isFinite(dcNumber) && dcNumber > 0 ? Number(dcNumber) : null;
      return { skill, dc };
    })
    .filter((entry) => entry.skill);

  if (normalized.length) return normalized;

  const fallbackSkill =
    typeof location?.skill === "string" ? location.skill.trim() : "";
  if (!fallbackSkill) return [];
  const dcNumber = Number(location?.dc);
  const dc = Number.isFinite(dcNumber) && dcNumber > 0 ? Number(dcNumber) : null;
  return [{ skill: fallbackSkill, dc }];
}

/**
 * Register hooks to automatically apply research points for successful skill checks.
 * @param {import("./tracker.js").ResearchTracker} tracker
 */
export function registerResearchAutoUpdates(tracker) {
  Hooks.on("createChatMessage", async (message) => {
    try {
      await handleChatMessage(tracker, message);
    } catch (error) {
      console.error("pf2e-points-tracker | Failed to process skill check message.", error);
    }
  });
}

async function handleChatMessage(tracker, message) {
  if (!game?.user?.isGM) return;
  if (!message) return;

  const messageKey = message.uuid ?? message.id ?? null;
  if (messageKey && processedMessages.has(messageKey)) return;

  const context = message.flags?.pf2e?.context;
  if (!context) return;
  if (context.type !== "skill-check") return;

  const outcome = extractOutcome(context);
  if (!outcome) return;

  const outcomeKey = outcome.toLowerCase();
  const points = OUTCOME_POINTS[outcomeKey];
  if (typeof points !== "number") return;
  if (points === 0) return;

  const skillSlug = extractSkillSlug(context);
  if (!skillSlug) return;

  const actorData = await resolveActor(message);
  if (!actorData?.actor) return;
  if (actorData.actor?.type !== "character") return;

  const matches = findMatchingTargets(tracker, skillSlug, actorData, context);
  if (!matches.length) return;

  const reason = buildReason(context, skillSlug, outcomeKey);
  const rollData = extractRollData(message);

  for (const match of matches) {
    const metadata = {
      actorUuid: actorData.actorUuid ?? undefined,
      actorName: actorData.actorName ?? undefined,
      reason,
      roll: rollData ?? undefined,
    };

    if (match.locationId) {
      await tracker.adjustLocationPoints(match.topicId, match.locationId, points, metadata);
    } else {
      await tracker.adjustPoints(match.topicId, points, metadata);
    }
  }

  if (messageKey) processedMessages.add(messageKey);
}

function extractOutcome(context) {
  const rawOutcome =
    context?.outcome ??
    context?.degreeOfSuccess?.value ??
    context?.degreeOfSuccess ??
    context?.result ??
    null;
  if (!rawOutcome) return null;
  return String(rawOutcome);
}

function extractSkillSlug(context) {
  if (Array.isArray(context?.domains)) {
    for (const domain of context.domains) {
      if (typeof domain !== "string") continue;
      const normalized = domain.trim();
      if (normalized) return normalized.toLowerCase();
    }
  }

  const slug =
    context?.skillCheck?.slug ??
    context?.skillCheck ??
    context?.slug ??
    context?.skill ??
    findSkillInOptions(context?.options) ??
    null;
  if (!slug) return null;
  return String(slug).toLowerCase();
}

function findSkillInOptions(options) {
  if (!Array.isArray(options)) return null;
  for (const option of options) {
    if (typeof option !== "string") continue;
    const match = option.match(/^skill-check:(?<skill>[a-z0-9-]+)$/i);
    if (match?.groups?.skill) {
      return match.groups.skill.toLowerCase();
    }
  }
  return null;
}

function buildReason(context, skillSlug, outcomeKey) {
  const skillLabel =
    context?.skillCheck?.label ??
    context?.label ??
    toTitleCase(skillSlug);
  const outcomeLabel =
    game?.i18n?.localize?.(OUTCOME_LABEL_KEYS[outcomeKey]) ??
    toTitleCase(outcomeKey);
  return (
    game?.i18n?.format?.("PF2E.PointsTracker.Research.AutoReason", {
      skill: skillLabel,
      outcome: outcomeLabel,
    }) ?? `Automatic: ${skillLabel} check (${outcomeLabel}).`
  );
}

function toTitleCase(value) {
  return String(value ?? "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

async function resolveActor(message) {
  let actor = message.actor ?? (typeof message.getActor === "function" ? message.getActor() : null);
  if (!actor && message.speaker?.actor) {
    actor = game?.actors?.get?.(message.speaker.actor) ?? null;
  }

  if (!actor && message.speaker?.token) {
    const sceneId = message.speaker.scene ?? canvas?.scene?.id ?? null;
    const scene = sceneId ? game?.scenes?.get?.(sceneId) ?? null : null;
    const token = scene?.tokens?.get?.(message.speaker.token) ?? null;
    actor = token?.actor ?? null;
  }

  if (!actor && message.token?.actor) {
    actor = message.token.actor;
  }

  if (!actor) return null;

  const candidateUuids = new Set();
  if (actor.uuid) candidateUuids.add(actor.uuid);
  if (actor.id) candidateUuids.add(`Actor.${actor.id}`);
  if (message.speaker?.actor) candidateUuids.add(`Actor.${message.speaker.actor}`);
  if (message.speaker?.scene && message.speaker?.token) {
    candidateUuids.add(`Scene.${message.speaker.scene}.Token.${message.speaker.token}`);
  }

  return {
    actor,
    actorUuid: actor.uuid ?? (message.speaker?.actor ? `Actor.${message.speaker.actor}` : null),
    actorName: actor.name ?? message.speaker?.alias ?? null,
    candidateUuids,
  };
}

function findMatchingTargets(tracker, skillSlug, actorData, context) {
  const normalizedSkill = String(skillSlug ?? "").toLowerCase();
  const topics = tracker.getTopics();

  const matchesWithAssignment = [];
  const matchesWithoutAssignment = [];

  for (const topic of topics) {
    const locations = Array.isArray(topic.locations) ? topic.locations : [];
    if (locations.length) {
      for (const location of locations) {
        const checks = extractLocationChecks(location, topic);
        const matchingCheck = checks.find((check) => {
          const skillValue = (check.skill || "").toLowerCase();
          if (!skillValue || skillValue !== normalizedSkill) return false;
          return matchesDc(check.dc, context);
        });

        if (!matchingCheck) continue;

        const assignments = Array.isArray(location.assignedActors)
          ? location.assignedActors
          : [];
        const hasAssignments = assignments.length > 0;
        const assignmentMatch = hasAssignments
          ? assignments.some((assignment) =>
              assignment?.uuid ? actorData.candidateUuids.has(assignment.uuid) : false
            )
          : false;

        const matchData = {
          topicId: topic.id,
          locationId: location.id,
        };

        if (assignmentMatch) {
          matchesWithAssignment.push(matchData);
        } else if (!hasAssignments) {
          matchesWithoutAssignment.push(matchData);
        }
      }
    }
  }

  if (matchesWithAssignment.length === 1) return matchesWithAssignment;
  if (matchesWithAssignment.length > 1) {
    console.warn(
      "pf2e-points-tracker | Multiple assigned research locations matched the same skill check. Aborting automatic point adjustment."
    );
    return [];
  }

  if (matchesWithoutAssignment.length === 1) return matchesWithoutAssignment;
  if (matchesWithoutAssignment.length > 1) {
    console.warn(
      "pf2e-points-tracker | Multiple research locations matched the same skill check. Assign party members to locations to disambiguate automatic updates."
    );
    return [];
  }

  return [];
}

function matchesDc(dcValue, context) {
  const dc = Number(dcValue ?? NaN);
  if (!Number.isFinite(dc) || dc <= 0) return true;
  const contextDc = Number(context?.dc?.value ?? context?.dc ?? NaN);
  if (!Number.isFinite(contextDc)) return true;
  return Number(dc) === Number(contextDc);
}

function extractRollData(message) {
  if (Array.isArray(message.rolls) && message.rolls.length > 0) {
    const roll = message.rolls[0];
    if (roll && typeof roll.toJSON === "function") {
      return roll.toJSON();
    }
    return roll ?? null;
  }
  if (message.roll) {
    if (typeof message.roll.toJSON === "function") {
      return message.roll.toJSON();
    }
    return message.roll;
  }
  return null;
}
