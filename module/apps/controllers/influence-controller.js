import { InfluenceImportExport } from "../../influence/importer.js";
import { TrackerTabController, escapeAttribute, escapeHtml } from "./tracker-tab-controller.js";

/** Owns the influence tab context, dialogs, and event handling. */
export class InfluenceController extends TrackerTabController {
  _initializeInfluenceTab() {
    if (this._initializedTabs.has("influence")) return;
    this._initializedTabs.add("influence");
    this.element.querySelector("[data-tab-panel='influence']")?.setAttribute("data-initialized", "true");
  }

  async _prepareInfluenceData({ isGM }) {
    this._ensureInfluenceLogState();
    if (!this.influenceTracker) {
      return {
        isGM,
        hasTracker: false,
        npcs: [],
        log: [],
        hasNpcs: false,
      };
    }

    const npcsRaw = this.influenceTracker.getNpcs();
    const actorLookup = new Map();
    const partyActors = this._getPartyActors();
    for (const actor of partyActors) {
      if (!actor) continue;
      const entry = { actor, name: actor.name ?? "", img: actor.img ?? actor.data?.img ?? "" };
      if (typeof actor.uuid === "string" && actor.uuid) actorLookup.set(actor.uuid, entry);
      if (typeof actor.id === "string" && actor.id) actorLookup.set(actor.id, entry);
      if (typeof actor._id === "string" && actor._id) actorLookup.set(actor._id, entry);
    }
    const npcLookup = new Map();
    const seenNpcIds = new Set();
    const slugifySkill = (value) => {
      if (!value) return "";
      if (foundry?.utils?.slugify) {
        try {
          return foundry.utils.slugify(value, { strict: true });
        } catch (error) {
          logger.error(error);
        }
      }
      return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    };
    const skillOptions = this._getPf2eSkillOptions();
    const formatCheckEntries = async (entries) => {
      const list = Array.isArray(entries) ? entries : [];
      const results = await Promise.all(
        list.map(async (entry) => {
          const rawSkill = typeof entry?.skill === "string" ? entry.skill : "";
          const skill = this._normalizeInfluenceSkillValue(rawSkill, skillOptions);
          const fallbackSkill = typeof rawSkill === "string" ? rawSkill.trim() : "";
          const dc = Number.isFinite(entry?.dc) ? Number(entry.dc) : null;
          const label = skill || fallbackSkill;
          const slug = slugifySkill(skill || fallbackSkill);
          const inlineParts = [];
          if (slug) {
            inlineParts.push(`type:${slug}`);
            if (dc !== null) inlineParts.push(`dc:${dc}`);
          }
          const displayText = label || skill || fallbackSkill;
          const inlineText = inlineParts.length && displayText
            ? `@Check[${inlineParts.join("|")}]{${displayText}}`
            : "";
          const inlineHtml = inlineText ? await this._enrichText(inlineText) : "";
          return {
            id: typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : this._generateId(),
            skill,
            dc,
            label,
            inlineHtml: inlineHtml || null,
          };
        })
      );
      return results.filter((entry) => entry.skill || entry.dc !== null || entry.label);
    };

    const npcs = [];
    for (const npc of npcsRaw) {
      npcLookup.set(npc.id, npc);
      if (npc?.id) {
        seenNpcIds.add(npc.id);
      }
      const showInfluenceSkillsToPlayers =
        typeof npc.showInfluenceSkillsToPlayers === "boolean" ? npc.showInfluenceSkillsToPlayers : true;
      const rawThresholds = Array.isArray(npc.thresholds) ? npc.thresholds : [];
      const highestThresholdPoints = rawThresholds.reduce(
        (max, threshold) =>
          Math.max(max, Number.isFinite(threshold?.points) ? Number(threshold.points) : 0),
        0
      );
      const maxInfluence = Number.isFinite(npc.maxInfluence) ? Number(npc.maxInfluence) : 0;
      const currentInfluence = Number.isFinite(npc.currentInfluence)
        ? Math.max(0, Number(npc.currentInfluence))
        : 0;
      const markerReference = maxInfluence > 0
        ? maxInfluence
        : Math.max(highestThresholdPoints, currentInfluence);
      const progressPercentRaw = markerReference > 0 ? (currentInfluence / markerReference) * 100 : 0;
      const progressPercent = markerReference > 0
        ? Math.max(
            0,
            Math.min(100, Math.round((progressPercentRaw + Number.EPSILON) * 100) / 100)
          )
        : 0;
      const traits = Array.isArray(npc.traits)
        ? npc.traits
            .map((trait) => (typeof trait === "string" ? trait.trim() : ""))
            .filter((trait) => trait)
        : [];
      const traitsLabel = traits.join(", ");
      const skillDcsRaw = Array.isArray(npc.skillDcs) ? npc.skillDcs : [];
      const skillDcs = await formatCheckEntries(skillDcsRaw);
      const thresholds = [];
      if (rawThresholds.length > 0) {
        for (const threshold of rawThresholds) {
          const points = Number.isFinite(threshold.points) ? Number(threshold.points) : 0;
          const isUnlocked = currentInfluence >= points;
          const revealedAt = Number.isFinite(threshold.revealedAt)
            ? Number(threshold.revealedAt)
            : null;
          const gmText = typeof threshold.gmText === "string" ? threshold.gmText.trim() : "";
          const playerText = typeof threshold.playerText === "string" ? threshold.playerText.trim() : "";
          const reward = typeof threshold.reward === "string" ? threshold.reward.trim() : "";
          const gmTextHtml = gmText ? await this._enrichText(gmText) : "";
          const playerTextHtml = playerText ? await this._enrichText(playerText) : "";
          const rewardHtml = reward ? await this._enrichText(reward) : "";
          const hasPlayerContent = Boolean(playerTextHtml || rewardHtml);
          const markerPercentRaw = markerReference > 0 ? (points / markerReference) * 100 : 0;
          const markerPercent = markerReference > 0
            ? Math.max(
                0,
                Math.min(100, Math.round((markerPercentRaw + Number.EPSILON) * 100) / 100)
              )
            : 0;
          thresholds.push({
            id: threshold.id,
            points,
            gmText,
            gmTextHtml,
            playerText,
            playerTextHtml,
            reward,
            rewardHtml,
            isUnlocked,
            isRevealed: revealedAt !== null,
            revealedAt,
            revealedAtFormatted: revealedAt ? new Date(revealedAt).toLocaleString() : null,
            pointsLabel: game.i18n.format("PF2E.PointsTracker.Influence.ThresholdPoints", { points }),
            canReveal: isUnlocked && revealedAt === null,
            canResend: revealedAt !== null && Boolean(gmTextHtml || playerTextHtml || rewardHtml),
            canHide: revealedAt !== null,
            showToPlayers: isUnlocked && revealedAt !== null && hasPlayerContent,
            hasPlayerText: Boolean(playerTextHtml),
            hasGmText: Boolean(gmTextHtml),
            hasReward: Boolean(rewardHtml),
            markerPercent,
          });
        }
      }

      const discoveryChecks = await formatCheckEntries(npc.discoveryChecks);
      const discoveryNotes =
        typeof npc.discoveryNotes === "string" ? npc.discoveryNotes.trim() : "";
      const discoveryNotesHtml = discoveryNotes ? await this._enrichText(discoveryNotes) : "";
      const canShowInfluenceDetails = isGM || showInfluenceSkillsToPlayers;
      const influenceChecks = canShowInfluenceDetails
        ? await formatCheckEntries(npc.influenceChecks)
        : [];
      const influenceNotes = canShowInfluenceDetails
        ? typeof npc.influenceNotes === "string"
          ? npc.influenceNotes.trim()
          : ""
        : "";
      const influenceNotesHtml = influenceNotes ? await this._enrichText(influenceNotes) : "";
      const background = typeof npc.background === "string" ? npc.background.trim() : "";
      const backgroundHtml = background ? await this._enrichText(background) : "";
      const appearance = typeof npc.appearance === "string" ? npc.appearance.trim() : "";
      const appearanceHtml = appearance ? await this._enrichText(appearance) : "";
      const personality = typeof npc.personality === "string" ? npc.personality.trim() : "";
      const personalityHtml = personality ? await this._enrichText(personality) : "";
      const penalty = npc.penalty ?? "";
      const penaltyHtml = escapeHtml(penalty).replace(/\n/g, "<br />");
      const resistances = isGM ? npc.resistances ?? "" : "";
      const resistancesHtml = isGM ? escapeHtml(resistances).replace(/\n/g, "<br />") : "";
      const weaknesses = isGM ? npc.weaknesses ?? "" : "";
      const weaknessesHtml = isGM ? escapeHtml(weaknesses).replace(/\n/g, "<br />") : "";
      const notes = npc.notes ?? "";
      const notesHtml = escapeHtml(notes).replace(/\n/g, "<br />");
      const updatedAt = Number.isFinite(npc.updatedAt) ? Number(npc.updatedAt) : null;
      const updatedAtFormatted = updatedAt ? new Date(updatedAt).toLocaleString() : null;
      const localState = this._getInfluenceNpcState(npc.id);
      const localCollapse = typeof localState.isCollapsed === "boolean" ? localState.isCollapsed : null;
      const isCollapsed = localCollapse !== null ? localCollapse : Boolean(npc.isCollapsed);
      const assignedActors = this._mapAssignedActors(npc.assignedActors, actorLookup);

      const npcLog = this.influenceTracker
        .getNpcLog(npc.id)
        .slice()
        .reverse()
        .slice(0, 10)
        .map((entry) => ({
          id: entry.id,
          npcId: entry.npcId,
          timestamp: entry.timestamp,
          timestampFormatted: new Date(entry.timestamp).toLocaleString(),
          delta: entry.delta,
          deltaLabel: Number(entry.delta) > 0 ? `+${entry.delta}` : `${entry.delta}`,
          reason: entry.reason ?? "",
          note: entry.note ?? "",
          type: entry.type ?? "adjustment",
          total: entry.total,
          totalLabel:
            entry.total !== null && entry.total !== undefined
              ? game.i18n.format("PF2E.PointsTracker.Influence.TotalAfter", {
                  total: entry.total,
                })
              : "",
          userName: entry.userName ?? "",
        }));

      const logCollapseFromStore = this._collapsedInfluenceLogs.npcs.get(npc.id);
      const localLogCollapse =
        typeof localState.isLogCollapsed === "boolean"
          ? localState.isLogCollapsed
          : typeof logCollapseFromStore === "boolean"
          ? logCollapseFromStore
          : null;
      const isLogCollapsed = localLogCollapse !== null ? localLogCollapse : Boolean(npc.isLogCollapsed);
      if (npc.id && typeof isLogCollapsed === "boolean") {
        this._collapsedInfluenceLogs.npcs.set(npc.id, isLogCollapsed);
      }

      const npcData = {
        id: npc.id,
        name: npc.name,
        img: npc.img ?? "",
        imageUuid: npc.imageUuid ?? "",
        hasPortrait: Boolean(npc.img),
        currentInfluence,
        maxInfluence,
        maxInfluenceLabel:
          maxInfluence > 0
            ? game.i18n.format("PF2E.PointsTracker.Influence.MaxInfluence", { value: maxInfluence })
            : game.i18n.localize("PF2E.PointsTracker.Influence.MaxInfluenceUnlimited"),
        progressPercent,
        traits,
        traitsLabel,
        hasTraits: traits.length > 0,
        skillDcs,
        hasSkillDcs: skillDcs.length > 0,
        thresholds,
        hasThresholds: thresholds.length > 0,
        discoveryChecks,
        hasDiscoveryChecks: discoveryChecks.length > 0 || Boolean(discoveryNotesHtml),
        hasDiscoveryCheckList: discoveryChecks.length > 0,
        discoveryNotes,
        discoveryNotesHtml,
        hasDiscoveryNotes: Boolean(discoveryNotesHtml),
        influenceChecks,
        hasInfluenceChecks: influenceChecks.length > 0 || Boolean(influenceNotesHtml),
        hasInfluenceCheckList: influenceChecks.length > 0,
        influenceNotes,
        influenceNotesHtml,
        hasInfluenceNotes: Boolean(influenceNotesHtml),
        showInfluenceSkillsToPlayers,
        background,
        backgroundHtml,
        hasBackground: Boolean(backgroundHtml),
        appearance,
        appearanceHtml,
        hasAppearance: Boolean(appearanceHtml),
        personality,
        personalityHtml,
        hasPersonality: Boolean(personalityHtml),
        penalty,
        penaltyHtml,
        resistances,
        resistancesHtml,
        hasResistances: Boolean(resistancesHtml),
        weaknesses,
        weaknessesHtml,
        hasWeaknesses: Boolean(weaknessesHtml),
        notes,
        notesHtml,
        updatedAt,
        updatedAtFormatted,
        assignedActors,
        hasAssignedActors: assignedActors.length > 0,
        logEntries: npcLog,
        hasLogEntries: npcLog.length > 0,
        canIncrease: maxInfluence === 0 || currentInfluence < maxInfluence,
        canDecrease: currentInfluence > 0,
        isCollapsed,
        isLogCollapsed,
      };
      npcs.push(npcData);
    }

    for (const storedId of Array.from(this._collapsedInfluenceLogs.npcs.keys())) {
      if (!seenNpcIds.has(storedId)) {
        this._collapsedInfluenceLogs.npcs.delete(storedId);
      }
    }

    const logEntries = this.influenceTracker
      .getLog()
      .slice()
      .reverse()
      .map((entry) => {
        const npc = entry.npcId ? npcLookup.get(entry.npcId) : null;
        const timestampFormatted = new Date(entry.timestamp).toLocaleString();
        const deltaLabel = Number(entry.delta) > 0 ? `+${entry.delta}` : `${entry.delta}`;
        const totalLabel =
          entry.total !== null && entry.total !== undefined
            ? game.i18n.format("PF2E.PointsTracker.Influence.TotalAfter", { total: entry.total })
            : "";
        const typeKey = `PF2E.PointsTracker.Influence.LogType.${entry.type ?? "adjustment"}`;
        return {
          id: entry.id,
          npcId: entry.npcId ?? "",
          npcName: npc?.name ?? game.i18n.localize("PF2E.PointsTracker.Influence.LogUnknownNpc"),
          timestamp: entry.timestamp,
          timestampFormatted,
          delta: entry.delta,
          deltaLabel,
          reason: entry.reason ?? "",
          note: entry.note ?? "",
          type: entry.type ?? "adjustment",
          typeLabel: game.i18n.localize(typeKey),
          total: entry.total,
          totalLabel,
          userName: entry.userName ?? "",
        };
      });

    const isSessionLogCollapsed = Boolean(this._collapsedInfluenceLogs.session);

    return {
      isGM,
      hasTracker: true,
      npcs,
      log: logEntries,
      hasNpcs: npcs.length > 0,
      canCreate: isGM,
      hasLog: logEntries.length > 0,
      isSessionLogCollapsed,
    };
  }

  _activateInfluenceListeners(html) {
    const panel = html.find("[data-tab-panel='influence']");
    if (!panel.length) return;

    panel
      .find("[data-action='import-influence-npcs']")
      .off("click")
      .on("click", (event) => this._onImportInfluenceNpcs(event));

    panel
      .find("[data-action='create-influence-npc']")
      .off("click")
      .on("click", (event) => this._onCreateInfluenceNpc(event));

    panel
      .find("[data-action='toggle-influence-npc']")
      .off("click")
      .on("click", (event) => this._onToggleInfluenceNpc(event));

    panel
      .find("[data-action='toggle-influence-npc-log']")
      .off("click")
      .on("click", (event) => this._onToggleInfluenceNpcLog(event));

    panel
      .find("[data-action='edit-influence-npc']")
      .off("click")
      .on("click", (event) => this._onEditInfluenceNpc(event));

    panel
      .find("[data-action='delete-influence-npc']")
      .off("click")
      .on("click", (event) => this._onDeleteInfluenceNpc(event));

    panel
      .find("[data-action='adjust-influence']")
      .off("click")
      .on("click", (event) => this._onAdjustInfluence(event));

    panel
      .find("[data-action='set-influence']")
      .off("click")
      .on("click", (event) => this._onSetInfluence(event));

    panel
      .find("[data-action='manage-influence-skills']")
      .off("click")
      .on("click", (event) => this._onManageInfluenceSkills(event));

    panel
      .find("[data-action='toggle-influence-visibility']")
      .off("click")
      .on("click", (event) => this._onToggleInfluenceVisibility(event));

    panel
      .find("[data-action='manage-influence-thresholds']")
      .off("click")
      .on("click", (event) => this._onManageInfluenceThresholds(event));

    panel
      .find("[data-action='reveal-influence-threshold']")
      .off("click")
      .on("click", (event) => this._onRevealInfluenceThreshold(event));

    panel
      .find("[data-action='resend-influence-threshold']")
      .off("click")
      .on("click", (event) => this._onResendInfluenceThreshold(event));

    panel
      .find("[data-action='hide-influence-threshold']")
      .off("click")
      .on("click", (event) => this._onHideInfluenceThreshold(event));

    panel
      .find("[data-action='select-influence-portrait']")
      .off("click")
      .on("click", (event) => this._onSelectInfluencePortrait(event));

    panel
      .find("[data-action='clear-influence-portrait']")
      .off("click")
      .on("click", (event) => this._onClearInfluencePortrait(event));

    panel
      .find("[data-action='add-influence-log-entry']")
      .off("click")
      .on("click", (event) => this._onAddInfluenceLogEntry(event));

    panel
      .find("[data-action='toggle-influence-session-log']")
      .off("click")
      .on("click", (event) => this._onToggleInfluenceSessionLog(event));

    panel
      .find("[data-action='edit-influence-log-entry']")
      .off("click")
      .on("click", (event) => this._onEditInfluenceLogEntry(event));

    panel
      .find("[data-action='delete-influence-log-entry']")
      .off("click")
      .on("click", (event) => this._onDeleteInfluenceLogEntry(event));

    this._bindInfluencePortraitDropzones(panel[0] ?? panel);
  }

  async _onImportInfluenceNpcs(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const npcs = await InfluenceImportExport.promptImport();
    if (!Array.isArray(npcs) || !npcs.length) return;

    let created = 0;
    for (const npcData of npcs) {
      try {
        const result = await this.influenceTracker.createNpc(npcData);
        if (result) created += 1;
      } catch (error) {
        logger.error(error);
      }
    }

    if (created > 0) {
      ui.notifications?.info?.(
        game.i18n.format("PF2E.PointsTracker.Influence.ImportSuccess", { count: created })
      );
      this.render();
    }
  }

  async _onCreateInfluenceNpc(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const result = await this._promptInfluenceNpcDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.CreateNpc"),
      label: game.i18n.localize("PF2E.PointsTracker.Influence.Create"),
    });
    if (!result) return;

    await this.influenceTracker.createNpc(result);
    this.render();
  }

  async _onToggleInfluenceNpc(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const button = event.currentTarget;
    const npcId = button.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;

    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const currentState = this._getInfluenceNpcState(npcId);
    const isCollapsed = !(
      typeof currentState.isCollapsed === "boolean" ? currentState.isCollapsed : Boolean(npc.isCollapsed)
    );

    this._setInfluenceNpcState(npcId, { isCollapsed });

    try {
      await this.influenceTracker.updateNpc(npcId, { isCollapsed });
    } catch (error) {
      logger.error(error);
    }
    this.render();
  }

  async _onToggleInfluenceNpcLog(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const button = event.currentTarget;
    const logSection = button.closest("[data-influence-npc-log]");
    if (!logSection) return;

    const npcId = logSection.dataset.npcId;
    if (!npcId) return;

    const body = logSection.querySelector("[data-influence-npc-log-body]");
    if (!body) return;

    const shouldCollapse = !body.classList.contains("is-collapsed");
    body.classList.toggle("is-collapsed", shouldCollapse);
    this._applyInfluenceLogToggleButtonState(button, shouldCollapse);

    this._ensureInfluenceLogState();
    this._collapsedInfluenceLogs.npcs.set(npcId, shouldCollapse);
    this._setInfluenceNpcState(npcId, { isLogCollapsed: shouldCollapse });

    try {
      await this.influenceTracker.updateNpc(npcId, { isLogCollapsed: shouldCollapse });
    } catch (error) {
      logger.error(error);
    }
  }

  _onToggleInfluenceSessionLog(event) {
    event.preventDefault();

    const button = event.currentTarget;
    const logSection = button.closest("[data-influence-session-log]");
    if (!logSection) return;

    const body = logSection.querySelector("[data-influence-session-log-body]");
    if (!body) return;

    const shouldCollapse = !body.classList.contains("is-collapsed");
    body.classList.toggle("is-collapsed", shouldCollapse);
    this._applyInfluenceLogToggleButtonState(button, shouldCollapse);

    this._ensureInfluenceLogState();
    this._collapsedInfluenceLogs.session = shouldCollapse;
  }

  _applyInfluenceLogToggleButtonState(button, isCollapsed) {
    if (!button) return;

    const icon = button.querySelector("[data-toggle-icon]");
    if (icon) {
      icon.classList.toggle("fa-angle-down", isCollapsed);
      icon.classList.toggle("fa-angle-up", !isCollapsed);
    }

    const labelElement = button.querySelector("[data-label]");
    const expandedLabel = button.dataset.labelExpanded ?? "";
    const collapsedLabel = button.dataset.labelCollapsed ?? "";
    const labelText = isCollapsed ? collapsedLabel : expandedLabel;

    if (labelElement) {
      labelElement.textContent = labelText;
    }

    if (labelText) {
      button.setAttribute("aria-label", labelText);
      button.setAttribute("title", labelText);
    } else {
      button.removeAttribute("aria-label");
      button.removeAttribute("title");
    }

    button.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  }

  _ensureInfluenceLogState() {
    if (!this._collapsedInfluenceLogs || typeof this._collapsedInfluenceLogs !== "object") {
      this._collapsedInfluenceLogs = { session: false, npcs: new Map() };
      return;
    }

    if (this._collapsedInfluenceLogs.npcs instanceof Map) {
      // no-op
    } else if (Array.isArray(this._collapsedInfluenceLogs.npcs)) {
      this._collapsedInfluenceLogs.npcs = new Map(this._collapsedInfluenceLogs.npcs);
    } else if (
      this._collapsedInfluenceLogs.npcs &&
      typeof this._collapsedInfluenceLogs.npcs === "object"
    ) {
      this._collapsedInfluenceLogs.npcs = new Map(
        Object.entries(this._collapsedInfluenceLogs.npcs)
      );
    } else {
      this._collapsedInfluenceLogs.npcs = new Map();
    }

    if (typeof this._collapsedInfluenceLogs.session !== "boolean") {
      this._collapsedInfluenceLogs.session = Boolean(this._collapsedInfluenceLogs.session);
    }
  }

  _ensureInfluenceNpcState() {
    if (this._localInfluenceNpcState instanceof Map) return;

    if (Array.isArray(this._localInfluenceNpcState)) {
      this._localInfluenceNpcState = new Map(this._localInfluenceNpcState);
    } else if (this._localInfluenceNpcState && typeof this._localInfluenceNpcState === "object") {
      this._localInfluenceNpcState = new Map(Object.entries(this._localInfluenceNpcState));
    } else {
      this._localInfluenceNpcState = new Map();
    }
  }

  _getInfluenceNpcState(npcId) {
    this._ensureInfluenceNpcState();
    if (!npcId) return {};
    return this._localInfluenceNpcState.get(npcId) ?? {};
  }

  _setInfluenceNpcState(npcId, updates = {}) {
    if (!npcId || !updates || typeof updates !== "object") return;
    this._ensureInfluenceNpcState();
    const existing = this._localInfluenceNpcState.get(npcId) ?? {};
    this._localInfluenceNpcState.set(npcId, { ...existing, ...updates });
  }

  async _onEditInfluenceNpc(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const npcId = event.currentTarget.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;
    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const result = await this._promptInfluenceNpcDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.EditNpc"),
      label: game.i18n.localize("PF2E.PointsTracker.Influence.Save"),
      initial: npc,
    });
    if (!result) return;

    await this.influenceTracker.updateNpc(npcId, result);
    this.render();
  }

  async _onDeleteInfluenceNpc(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const npcId = event.currentTarget.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;
    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.DeleteNpc"),
      content: `<p>${game.i18n.format("PF2E.PointsTracker.Influence.DeleteNpcConfirm", {
        name: escapeHtml(npc.name),
      })}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false,
    });
    if (!confirmed) return;

    await this.influenceTracker.deleteNpc(npcId);
    this.render();
  }

  async _onAdjustInfluence(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const button = event.currentTarget;
    const npcId = button.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;
    const delta = Number(button.dataset.delta ?? 0);
    if (!Number.isFinite(delta) || delta === 0) return;

    await this.influenceTracker.adjustInfluence(npcId, delta, { notify: false });
    this.render();
  }

  async _onSetInfluence(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const button = event.currentTarget;
    const npcId = button.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;
    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const result = await this._promptSetInfluenceValue({ npc, initialValue: npc.currentInfluence });
    if (result === null || result === undefined) return;

    await this.influenceTracker.setInfluence(npcId, result, { notify: false });
    this.render();
  }

  async _onManageInfluenceSkills(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const npcId = event.currentTarget.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;
    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const result = await this._promptInfluenceSkillsDialog({ npc });
    if (!result) return;

    await this.influenceTracker.updateNpc(npcId, { skillDcs: result });
    this.render();
  }

  async _onToggleInfluenceVisibility(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const npcId = event.currentTarget.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;
    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const currentVisibility =
      typeof npc.showInfluenceSkillsToPlayers === "boolean"
        ? npc.showInfluenceSkillsToPlayers
        : true;

    await this.influenceTracker.updateNpc(npcId, {
      showInfluenceSkillsToPlayers: !currentVisibility,
    });
    this.render();
  }

  async _onManageInfluenceThresholds(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const npcId = event.currentTarget.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;
    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const result = await this._promptInfluenceThresholdsDialog({ npc });
    if (!result) return;

    await this.influenceTracker.updateNpc(npcId, { thresholds: result });
    this.render();
  }

  async _onRevealInfluenceThreshold(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const button = event.currentTarget;
    const npcId = button.closest("[data-npc-id]")?.dataset.npcId;
    const thresholdId = button.closest("[data-threshold-id]")?.dataset.thresholdId;
    if (!npcId || !thresholdId) return;

    await this.influenceTracker.sendThresholdReveal(npcId, thresholdId, { resend: false });
    this.render();
  }

  async _onResendInfluenceThreshold(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const button = event.currentTarget;
    const npcId = button.closest("[data-npc-id]")?.dataset.npcId;
    const thresholdId = button.closest("[data-threshold-id]")?.dataset.thresholdId;
    if (!npcId || !thresholdId) return;

    await this.influenceTracker.sendThresholdReveal(npcId, thresholdId, { resend: true });
    this.render();
  }

  async _onHideInfluenceThreshold(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const button = event.currentTarget;
    const npcId = button.closest("[data-npc-id]")?.dataset.npcId;
    const thresholdId = button.closest("[data-threshold-id]")?.dataset.thresholdId;
    if (!npcId || !thresholdId) return;
    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const thresholds = Array.isArray(npc.thresholds) ? npc.thresholds : [];
    const updated = thresholds.map((threshold) =>
      threshold.id === thresholdId ? { ...threshold, revealedAt: null } : threshold
    );

    await this.influenceTracker.updateNpc(npcId, { thresholds: updated });
    this.render();
  }

  async _onAddInfluenceLogEntry(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const npcId = event.currentTarget.closest("[data-npc-id]")?.dataset.npcId ?? "";
    const result = await this._promptInfluenceLogDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.AddLogEntry"),
      label: game.i18n.localize("PF2E.PointsTracker.Influence.Save"),
      npcId,
    });
    if (!result) return;

    await this.influenceTracker.addLogEntry(result);
    this.render();
  }

  async _onEditInfluenceLogEntry(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const logId = event.currentTarget.closest("[data-log-id]")?.dataset.logId;
    if (!logId) return;
    const entry = this.influenceTracker.getLogEntry(logId);
    if (!entry) return;

    const result = await this._promptInfluenceLogDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.EditLogEntry"),
      label: game.i18n.localize("PF2E.PointsTracker.Influence.Save"),
      npcId: entry.npcId ?? "",
      initial: entry,
    });
    if (!result) return;

    await this.influenceTracker.updateLogEntry(logId, result);
    this.render();
  }

  async _onDeleteInfluenceLogEntry(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const logId = event.currentTarget.closest("[data-log-id]")?.dataset.logId;
    if (!logId) return;
    const entry = this.influenceTracker.getLogEntry(logId);
    if (!entry) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.DeleteLogEntry"),
      content: `<p>${game.i18n.localize("PF2E.PointsTracker.Influence.DeleteLogConfirm")}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false,
    });
    if (!confirmed) return;

    await this.influenceTracker.deleteLogEntry(logId);
    this.render();
  }

  async _promptInfluenceNpcDialog({ title, label, initial = {} }) {
    const maxInfluenceDefault = Number.isFinite(initial.maxInfluence)
      ? Math.max(0, Number(initial.maxInfluence))
      : 0;
    const currentInfluenceDefault = Number.isFinite(initial.currentInfluence)
      ? Math.max(0, Number(initial.currentInfluence))
      : 0;
    const traitsDefault = Array.isArray(initial.traits)
      ? initial.traits.join(", ")
      : typeof initial.traits === "string"
      ? initial.traits
      : "";
    const traitsPlaceholder = game.i18n.localize("PF2E.PointsTracker.Influence.TraitsPlaceholder");
    const backgroundDefault =
      typeof initial.background === "string" ? initial.background : "";
    const backgroundPlaceholder = game.i18n.localize(
      "PF2E.PointsTracker.Influence.BackgroundPlaceholder"
    );
    const appearanceDefault =
      typeof initial.appearance === "string" ? initial.appearance : "";
    const appearancePlaceholder = game.i18n.localize(
      "PF2E.PointsTracker.Influence.AppearancePlaceholder"
    );
    const personalityDefault =
      typeof initial.personality === "string" ? initial.personality : "";
    const personalityPlaceholder = game.i18n.localize(
      "PF2E.PointsTracker.Influence.PersonalityPlaceholder"
    );
    const skillOptions = this._getPf2eSkillOptions();
    const existingSkillRows = Array.isArray(initial.skillDcs) ? initial.skillDcs : [];
    const npcSkillRows = existingSkillRows.concat(new Array(3).fill(null));
    const skillFields = npcSkillRows
      .map((entry) => this._renderInfluenceSkillRow(entry, skillOptions))
      .join("");
    const discoveryCheckRows = (Array.isArray(initial.discoveryChecks) ? initial.discoveryChecks : []).concat(
      new Array(3).fill(null)
    );
    const discoveryCheckFields = discoveryCheckRows
      .map((entry) => this._renderDiscoveryCheckRow(entry, skillOptions))
      .join("");
    const discoveryNotesDefault =
      typeof initial.discoveryNotes === "string" ? initial.discoveryNotes : "";
    const discoveryChecksHint = game.i18n.localize(
      "PF2E.PointsTracker.Influence.DiscoveryChecksPlaceholder"
    );
    const discoveryNotesPlaceholder = game.i18n.localize(
      "PF2E.PointsTracker.Influence.DiscoveryNotesPlaceholder"
    );
    const influenceCheckRows = (Array.isArray(initial.influenceChecks) ? initial.influenceChecks : []).concat(
      new Array(3).fill(null)
    );
    const influenceCheckFields = influenceCheckRows
      .map((entry) => this._renderInfluenceCheckRow(entry, skillOptions))
      .join("");
    const influenceNotesDefault =
      typeof initial.influenceNotes === "string" ? initial.influenceNotes : "";
    const influenceChecksHint = game.i18n.localize(
      "PF2E.PointsTracker.Influence.InfluenceChecksPlaceholder"
    );
    const influenceNotesPlaceholder = game.i18n.localize(
      "PF2E.PointsTracker.Influence.InfluenceNotesPlaceholder"
    );

    const template = `
      <form class="flexcol points-tracker-dialog">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.NpcName")}</label>
          <input type="text" name="name" value="${escapeAttribute(initial.name ?? "")}" required>
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.CurrentInfluence")}</label>
          <input type="number" name="currentInfluence" min="0" step="1" value="${escapeAttribute(currentInfluenceDefault)}">
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.MaxInfluenceLabel")}</label>
          <input type="number" name="maxInfluence" min="0" step="1" value="${escapeAttribute(maxInfluenceDefault)}">
        </div>
        <div class="influence-skill-editor" data-skill-editor>
          <p class="notes">${game.i18n.localize("PF2E.PointsTracker.Influence.SkillHint")}</p>
          <div data-skill-rows>
            ${skillFields}
          </div>
          <button type="button" class="add-skill-row" data-action="add-skill-row">
            ${game.i18n.localize("PF2E.PointsTracker.Influence.AddSkillRow")}
          </button>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.TraitsLabel")}</label>
          <input type="text" name="traits" value="${escapeAttribute(traitsDefault)}" placeholder="${escapeAttribute(traitsPlaceholder)}">
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.BackgroundLabel")}</label>
          <textarea name="background" rows="3" placeholder="${escapeAttribute(backgroundPlaceholder)}">${escapeHtml(backgroundDefault)}</textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.AppearanceLabel")}</label>
          <textarea name="appearance" rows="3" placeholder="${escapeAttribute(appearancePlaceholder)}">${escapeHtml(appearanceDefault)}</textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.PersonalityLabel")}</label>
          <textarea name="personality" rows="3" placeholder="${escapeAttribute(personalityPlaceholder)}">${escapeHtml(personalityDefault)}</textarea>
        </div>
        <div class="influence-check-editor" data-discovery-check-editor>
          <h4>${game.i18n.localize("PF2E.PointsTracker.Influence.DiscoveryChecksLabel")}</h4>
          <p class="notes">${escapeHtml(discoveryChecksHint)}</p>
          <div data-discovery-check-rows>
            ${discoveryCheckFields}
          </div>
          <button type="button" class="add-check-row" data-action="add-discovery-check-row">
            ${game.i18n.localize("PF2E.PointsTracker.Influence.AddCheckRow")}
          </button>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.DiscoveryNotesLabel")}</label>
          <textarea name="discoveryNotes" rows="3" placeholder="${escapeAttribute(discoveryNotesPlaceholder)}">${escapeHtml(discoveryNotesDefault)}</textarea>
        </div>
        <div class="influence-check-editor" data-influence-check-editor>
          <h4>${game.i18n.localize("PF2E.PointsTracker.Influence.InfluenceChecksLabel")}</h4>
          <p class="notes">${escapeHtml(influenceChecksHint)}</p>
          <div data-influence-check-rows>
            ${influenceCheckFields}
          </div>
          <button type="button" class="add-check-row" data-action="add-influence-check-row">
            ${game.i18n.localize("PF2E.PointsTracker.Influence.AddCheckRow")}
          </button>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.InfluenceNotesLabel")}</label>
          <textarea name="influenceNotes" rows="3" placeholder="${escapeAttribute(influenceNotesPlaceholder)}">${escapeHtml(influenceNotesDefault)}</textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.PenaltyText")}</label>
          <textarea name="penalty" rows="3">${escapeHtml(initial.penalty ?? "")}</textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.Notes")}</label>
          <textarea name="notes" rows="3">${escapeHtml(initial.notes ?? "")}</textarea>
        </div>
      </form>
    `;

    return new Promise((resolve) => {
      const dialog = new Dialog({
        title,
        content: template,
        buttons: {
          confirm: {
            icon: "fas fa-save",
            label,
            callback: (html) => {
              const form = html[0].querySelector("form");
              if (!form) {
                resolve(null);
                return;
              }
              const formData = new FormData(form);
              const name = String(formData.get("name") ?? "").trim();
              if (!name) {
                ui.notifications?.warn(
                  game.i18n.localize("PF2E.PointsTracker.Influence.NameRequired")
                );
                resolve(null);
                return;
              }
              const currentInfluenceValue = Number(formData.get("currentInfluence"));
              const maxInfluenceValue = Number(formData.get("maxInfluence"));
              const traitsRaw = String(formData.get("traits") ?? "").trim();
              const penalty = String(formData.get("penalty") ?? "").trim();
              const notes = String(formData.get("notes") ?? "").trim();
              const background = String(formData.get("background") ?? "").trim();
              const appearance = String(formData.get("appearance") ?? "").trim();
              const personality = String(formData.get("personality") ?? "").trim();
              const discoveryNotes = String(formData.get("discoveryNotes") ?? "").trim();
              const influenceNotes = String(formData.get("influenceNotes") ?? "").trim();
              const ids = formData.getAll("skillId[]");
              const skills = formData.getAll("skillName[]");
              const dcs = formData.getAll("skillDc[]");
              const discoveryIds = formData.getAll("discoveryCheckId[]");
              const discoverySkills = formData.getAll("discoveryCheckSkill[]");
              const discoveryDcs = formData.getAll("discoveryCheckDc[]");
              const influenceIds = formData.getAll("influenceCheckId[]");
              const influenceSkills = formData.getAll("influenceCheckSkill[]");
              const influenceDcs = formData.getAll("influenceCheckDc[]");

              const skillDcs = [];
              const count = Math.max(ids.length, skills.length, dcs.length);
              for (let index = 0; index < count; index += 1) {
                const rawSkill = typeof skills[index] === "string" ? skills[index] : "";
                const normalizedSkill = this._normalizeInfluenceSkillValue(rawSkill, skillOptions);
                const dcRaw = Number(dcs[index]);
                const hasSkill = Boolean(normalizedSkill);
                const hasDc = Number.isFinite(dcRaw);
                if (!hasSkill && !hasDc) continue;

                let id = String(ids[index] ?? "").trim();
                if (!id) id = this._generateId();
                skillDcs.push({ id, skill: normalizedSkill, dc: hasDc ? Number(dcRaw) : null });
              }

              const discoveryChecks = [];
              const discoveryCount = Math.max(
                discoveryIds.length,
                discoverySkills.length,
                discoveryDcs.length
              );
              for (let index = 0; index < discoveryCount; index += 1) {
                const rawSkill =
                  typeof discoverySkills[index] === "string" ? discoverySkills[index] : "";
                const normalizedSkill = this._normalizeInfluenceSkillValue(rawSkill, skillOptions);
                const dcRaw = Number(discoveryDcs[index]);
                const hasSkill = Boolean(normalizedSkill);
                const hasDc = Number.isFinite(dcRaw);
                if (!hasSkill && !hasDc) continue;

                let id = String(discoveryIds[index] ?? "").trim();
                if (!id) id = this._generateId();
                discoveryChecks.push({
                  id,
                  skill: normalizedSkill,
                  dc: hasDc ? Number(dcRaw) : null,
                });
              }

              const influenceChecks = [];
              const influenceCount = Math.max(
                influenceIds.length,
                influenceSkills.length,
                influenceDcs.length
              );
              for (let index = 0; index < influenceCount; index += 1) {
                const rawSkill =
                  typeof influenceSkills[index] === "string" ? influenceSkills[index] : "";
                const normalizedSkill = this._normalizeInfluenceSkillValue(rawSkill, skillOptions);
                const dcRaw = Number(influenceDcs[index]);
                const hasSkill = Boolean(normalizedSkill);
                const hasDc = Number.isFinite(dcRaw);
                if (!hasSkill && !hasDc) continue;

                let id = String(influenceIds[index] ?? "").trim();
                if (!id) id = this._generateId();
                influenceChecks.push({
                  id,
                  skill: normalizedSkill,
                  dc: hasDc ? Number(dcRaw) : null,
                });
              }

              const payload = {
                name,
                currentInfluence: Number.isFinite(currentInfluenceValue)
                  ? Math.max(0, currentInfluenceValue)
                  : 0,
                maxInfluence: Number.isFinite(maxInfluenceValue)
                  ? Math.max(0, maxInfluenceValue)
                  : 0,
                traits: traitsRaw,
                discoveryChecks,
                discoveryNotes,
                influenceChecks,
                influenceNotes,
                penalty,
                notes,
                background,
                appearance,
                personality,
                skillDcs,
              };
              resolve(payload);
            },
          },
          cancel: {
            icon: "fas fa-times",
            label: game.i18n.localize("PF2E.PointsTracker.Cancel"),
            callback: () => resolve(null),
          },
        },
        render: (html) => {
          this._initializeInfluenceSkillEditor(html[0], skillOptions);
          this._initializeInfluenceCheckList(html[0], {
            containerSelector: "[data-discovery-check-rows]",
            buttonSelector: "[data-action='add-discovery-check-row']",
            renderRow: (entry) => this._renderDiscoveryCheckRow(entry, skillOptions),
          });
          this._initializeInfluenceCheckList(html[0], {
            containerSelector: "[data-influence-check-rows]",
            buttonSelector: "[data-action='add-influence-check-row']",
            renderRow: (entry) => this._renderInfluenceCheckRow(entry, skillOptions),
          });
        },
        default: "confirm",
        close: () => resolve(null),
      });
      dialog.render(true);
    });
  }

  _renderInfluenceSkillRow(entry = {}, skillOptions = []) {
    const id = entry?.id ?? "";
    const rawSkill = typeof entry?.skill === "string" ? entry.skill : "";
    const normalizedSkill = this._normalizeInfluenceSkillValue(rawSkill, skillOptions);
    const dc = Number.isFinite(entry?.dc) ? Number(entry.dc) : "";
    const hasSkillOptions = Array.isArray(skillOptions) && skillOptions.length > 0;

    const datalistId = hasSkillOptions
      ? id
        ? `influence-skill-options-${id}`
        : `influence-skill-options-${this._generateId()}`
      : "";
    const listAttribute = hasSkillOptions ? ` list="${escapeAttribute(datalistId)}"` : "";
    const skillTitle = game.i18n.localize("PF2E.PointsTracker.Influence.SkillInputTooltip");
    const skillField = `
      <input type="text" name="skillName[]" value="${escapeAttribute(normalizedSkill)}"${listAttribute}
        title="${escapeAttribute(skillTitle)}">
      ${hasSkillOptions
        ? `<datalist id="${escapeAttribute(datalistId)}">${this._renderInfluenceSkillDatalistOptions(
            skillOptions
          )}</datalist>`
        : ""}
    `.trim();

    return `
      <div class="influence-skill-row" data-skill-row>
        <input type="hidden" name="skillId[]" value="${escapeAttribute(id)}">
        <div class="form-group" data-has-skill-select="${hasSkillOptions}">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.SkillName")}</label>
          ${skillField}
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.SkillDC")}</label>
          <input type="number" name="skillDc[]" min="0" step="1" value="${escapeAttribute(dc)}">
        </div>
      </div>
    `;
  }

  _renderInfluenceCheckEditorRow(entry = {}, skillOptions = [], config = {}) {
    const {
      idFieldName = "checkId[]",
      skillFieldName = "checkSkill[]",
      dcFieldName = "checkDc[]",
      rowAttribute = "data-check-row",
      datalistPrefix = "influence-check-options",
    } = config;

    const id = typeof entry?.id === "string" ? entry.id : "";
    const rawSkill = typeof entry?.skill === "string" ? entry.skill : "";
    const normalizedSkill = this._normalizeInfluenceSkillValue(rawSkill, skillOptions);
    const dc = Number.isFinite(entry?.dc) ? Number(entry.dc) : "";
    const hasSkillOptions = Array.isArray(skillOptions) && skillOptions.length > 0;

    const datalistId = hasSkillOptions
      ? id
        ? `${datalistPrefix}-${id}`
        : `${datalistPrefix}-${this._generateId()}`
      : "";
    const listAttribute = hasSkillOptions ? ` list="${escapeAttribute(datalistId)}"` : "";
    const skillTitle = game.i18n.localize("PF2E.PointsTracker.Influence.SkillInputTooltip");
    const skillField = `
      <input type="text" name="${skillFieldName}" value="${escapeAttribute(normalizedSkill)}"${listAttribute}
        title="${escapeAttribute(skillTitle)}">
      ${hasSkillOptions
        ? `<datalist id="${escapeAttribute(datalistId)}">${this._renderInfluenceSkillDatalistOptions(
            skillOptions
          )}</datalist>`
        : ""}
    `.trim();

    const rowAttributeMarkup = rowAttribute ? ` ${rowAttribute}` : "";
    return `
      <div class="influence-check-row"${rowAttributeMarkup}>
        <input type="hidden" name="${idFieldName}" value="${escapeAttribute(id)}">
        <div class="form-group" data-has-skill-select="${hasSkillOptions}">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.SkillName")}</label>
          ${skillField}
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.SkillDC")}</label>
          <input type="number" name="${dcFieldName}" min="0" step="1" value="${escapeAttribute(dc)}">
        </div>
      </div>
    `;
  }

  _renderDiscoveryCheckRow(entry = {}, skillOptions = []) {
    return this._renderInfluenceCheckEditorRow(entry, skillOptions, {
      idFieldName: "discoveryCheckId[]",
      skillFieldName: "discoveryCheckSkill[]",
      dcFieldName: "discoveryCheckDc[]",
      rowAttribute: "data-discovery-check-row",
      datalistPrefix: "influence-discovery-options",
    });
  }

  _renderInfluenceCheckRow(entry = {}, skillOptions = []) {
    return this._renderInfluenceCheckEditorRow(entry, skillOptions, {
      idFieldName: "influenceCheckId[]",
      skillFieldName: "influenceCheckSkill[]",
      dcFieldName: "influenceCheckDc[]",
      rowAttribute: "data-influence-check-row",
      datalistPrefix: "influence-influence-options",
    });
  }

  _renderInfluenceSkillDatalistOptions(skillOptions = []) {
    if (!Array.isArray(skillOptions) || !skillOptions.length) return "";
    const seen = new Set();
    const options = [];
    for (const option of skillOptions) {
      const label = typeof option?.label === "string" ? option.label.trim() : "";
      const value = typeof option?.value === "string" ? option.value.trim() : "";
      const candidates = [];
      if (label) candidates.push(label);
      if (value && value !== label) candidates.push(value);
      for (const candidate of candidates) {
        const key = candidate.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(`<option value="${escapeAttribute(candidate)}"></option>`);
      }
    }
    return options.join("");
  }

  _getPf2eSkillOptions() {
    if (typeof CONFIG === "undefined") return [];
    const configSkills = CONFIG?.PF2E?.skills;
    if (!configSkills || typeof configSkills !== "object") return [];

    const options = [];
    const seenValues = new Set();
    for (const [key, value] of Object.entries(configSkills)) {
      const rawValue = typeof key === "string" ? key.trim() : "";
      const localizedLabelRaw = typeof value === "string"
        ? (game?.i18n?.localize ? game.i18n.localize(value).trim() : value.trim())
        : "";
      const fallbackLabel = typeof value === "string" ? value.trim() : "";
      const optionValue = (rawValue || localizedLabelRaw || fallbackLabel).trim();
      if (!optionValue) continue;
      const optionLabel = (localizedLabelRaw || fallbackLabel || optionValue).trim();
      if (seenValues.has(optionValue)) continue;
      seenValues.add(optionValue);
      options.push({ value: optionValue, label: optionLabel });
    }

    const locale = game?.i18n?.lang ?? undefined;
    options.sort((left, right) => left.label.localeCompare(right.label, locale));
    return options;
  }

  _normalizeInfluenceSkillValue(value, skillOptions) {
    const clean = (text) => (typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "");
    const raw = clean(value);
    if (!raw) return "";
    const options = Array.isArray(skillOptions) ? skillOptions : [];
    const lower = raw.toLowerCase();
    const matchByValue = options.find((option) => {
      const optionValue = clean(option?.value);
      if (!optionValue) return false;
      if (optionValue === raw) return true;
      return optionValue.toLowerCase() === lower;
    });
    if (matchByValue) {
      const label = clean(matchByValue.label);
      return label || clean(matchByValue.value) || raw;
    }
    const matchByLabel = options.find((option) => {
      const optionLabel = clean(option?.label);
      if (!optionLabel) return false;
      if (optionLabel === raw) return true;
      return optionLabel.toLowerCase() === lower;
    });
    if (matchByLabel) return clean(matchByLabel.label);
    return raw;
  }

  _initializeInfluenceSkillEditor(root, skillOptions) {
    if (!(root instanceof HTMLElement)) return;
    const rowsContainer = root.querySelector('[data-skill-rows]');
    if (!rowsContainer) return;
    const addButtons = Array.from(root.querySelectorAll('[data-action="add-skill-row"]'));
    if (!addButtons.length) return;

    const handleAddRow = () => {
      const template = document.createElement("template");
      template.innerHTML = this._renderInfluenceSkillRow({ id: this._generateId() }, skillOptions).trim();
      const newRow = template.content.firstElementChild;
      if (!newRow) return;
      rowsContainer.append(newRow);
      const inputField = newRow.querySelector('input[name="skillName[]"]');
      if (inputField instanceof HTMLInputElement) inputField.focus();
    };

    for (const button of addButtons) {
      button.addEventListener("click", handleAddRow);
    }
  }

  _initializeInfluenceCheckList(root, { containerSelector, buttonSelector, renderRow }) {
    if (!(root instanceof HTMLElement)) return;
    const rowsContainer = root.querySelector(containerSelector);
    if (!rowsContainer) return;
    const addButtons = Array.from(root.querySelectorAll(buttonSelector));
    if (!addButtons.length) return;

    const handleAddRow = () => {
      const template = document.createElement("template");
      template.innerHTML = renderRow({ id: this._generateId() }).trim();
      const newRow = template.content.firstElementChild;
      if (!newRow) return;
      rowsContainer.append(newRow);
      const inputField = newRow.querySelector('input[type="text"]');
      if (inputField instanceof HTMLInputElement) inputField.focus();
    };

    for (const button of addButtons) {
      button.addEventListener("click", handleAddRow);
    }
  }

  async _promptInfluenceSkillsDialog({ npc }) {
    const existing = Array.isArray(npc?.skillDcs) ? npc.skillDcs : [];
    const rows = existing.concat(new Array(3).fill(null));
    const skillOptions = this._getPf2eSkillOptions();

    const fields = rows.map((entry) => this._renderInfluenceSkillRow(entry, skillOptions)).join("");

    const template = `
      <form class="flexcol points-tracker-dialog">
        <p class="notes">${game.i18n.localize("PF2E.PointsTracker.Influence.SkillHint")}</p>
        <div data-skill-rows>
          ${fields}
        </div>
        <button type="button" class="add-skill-row" data-action="add-skill-row">
          ${game.i18n.localize("PF2E.PointsTracker.Influence.AddSkillRow")}
        </button>
      </form>
    `;

    const result = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.ManageSkills"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Influence.Save"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        if (!form) return null;
        const formData = new FormData(form);
        const ids = formData.getAll("skillId[]");
        const skills = formData.getAll("skillName[]");
        const dcs = formData.getAll("skillDc[]");

        const entries = [];
        const count = Math.max(ids.length, skills.length, dcs.length);
        for (let index = 0; index < count; index += 1) {
          const normalizedSkill = this._normalizeInfluenceSkillValue(skills[index], skillOptions);
          const dcRaw = Number(dcs[index]);
          const hasSkill = Boolean(normalizedSkill);
          const hasDc = Number.isFinite(dcRaw);
          if (!hasSkill && !hasDc) continue;

          let id = String(ids[index] ?? "").trim();
          if (!id) id = this._generateId();
          entries.push({ id, skill: normalizedSkill, dc: hasDc ? Number(dcRaw) : null });
        }

        return entries;
      },
      rejectClose: false,
      render: (html) => {
        this._initializeInfluenceSkillEditor(html[0], skillOptions);
      },
    });

    if (!result) return null;
    return result;
  }

  async _promptInfluenceThresholdsDialog({ npc }) {
    const existing = Array.isArray(npc?.thresholds) ? npc.thresholds : [];
    const rows = existing.concat(new Array(3).fill(null));
    const fields = rows
      .map((entry) => {
        const id = entry?.id ?? "";
        const points = Number.isFinite(entry?.points) ? Number(entry.points) : "";
        const gmText = entry?.gmText ?? "";
        const playerText = entry?.playerText ?? "";
        const reward = entry?.reward ?? "";
        const revealedAt = Number.isFinite(entry?.revealedAt) ? Number(entry.revealedAt) : "";
        return `
          <div class="influence-threshold-row" data-threshold-row>
            <input type="hidden" name="thresholdId[]" value="${escapeAttribute(id)}">
            <input type="hidden" name="thresholdRevealedAt[]" value="${escapeAttribute(revealedAt)}">
            <div class="form-group">
              <label>${game.i18n.localize("PF2E.PointsTracker.Influence.ThresholdPointsLabel")}</label>
              <input type="number" name="thresholdPoints[]" min="0" step="1" value="${escapeAttribute(points)}">
            </div>
            <div class="form-group">
              <label>${game.i18n.localize("PF2E.PointsTracker.Influence.ThresholdGmText")}</label>
              <textarea name="thresholdGmText[]" rows="2">${escapeHtml(gmText)}</textarea>
            </div>
            <div class="form-group">
              <label>${game.i18n.localize("PF2E.PointsTracker.Influence.ThresholdPlayerText")}</label>
              <textarea name="thresholdPlayerText[]" rows="2">${escapeHtml(playerText)}</textarea>
            </div>
            <div class="form-group">
              <label>${game.i18n.localize("PF2E.PointsTracker.Influence.ThresholdRewardText")}</label>
              <textarea name="thresholdReward[]" rows="2">${escapeHtml(reward)}</textarea>
            </div>
          </div>
        `;
      })
      .join("");

    const template = `
      <form class="flexcol points-tracker-dialog">
        <p class="notes">${game.i18n.localize("PF2E.PointsTracker.Influence.ThresholdHint")}</p>
        ${fields}
      </form>
    `;

    const result = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.ManageThresholds"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Influence.Save"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        if (!form) return null;
        const formData = new FormData(form);
        const ids = formData.getAll("thresholdId[]");
        const pointsList = formData.getAll("thresholdPoints[]");
        const gmTexts = formData.getAll("thresholdGmText[]");
        const playerTexts = formData.getAll("thresholdPlayerText[]");
        const rewards = formData.getAll("thresholdReward[]");
        const revealedValues = formData.getAll("thresholdRevealedAt[]");

        const thresholds = [];
        for (let index = 0; index < pointsList.length; index += 1) {
          const pointsRaw = Number(pointsList[index]);
          const gmText = String(gmTexts[index] ?? "").trim();
          const playerText = String(playerTexts[index] ?? "").trim();
          const reward = String(rewards[index] ?? "").trim();
          const hasPoints = Number.isFinite(pointsRaw);
          if (!hasPoints && !gmText && !playerText && !reward) continue;

          let id = String(ids[index] ?? "").trim();
          if (!id) id = this._generateId();
          const revealedAtRaw = Number(revealedValues[index]);
          const revealedAt = Number.isFinite(revealedAtRaw) ? Number(revealedAtRaw) : null;

          thresholds.push({
            id,
            points: hasPoints ? Math.max(0, Number(pointsRaw)) : 0,
            gmText,
            playerText,
            reward,
            revealedAt,
          });
        }

        thresholds.sort((a, b) => a.points - b.points);
        return thresholds;
      },
      rejectClose: false,
    });

    if (!result) return null;
    return result;
  }

  async _promptInfluenceLogDialog({ title, label, npcId = "", initial = {} }) {
    const npcs = Array.isArray(this.influenceTracker?.getNpcs())
      ? this.influenceTracker.getNpcs()
      : [];
    const options = npcs
      .map((npc) => {
        const selected = npc.id === (initial.npcId ?? npcId) ? "selected" : "";
        return `<option value="${escapeAttribute(npc.id)}" ${selected}>${escapeHtml(npc.name)}</option>`;
      })
      .join("");

    const type = typeof initial.type === "string" ? initial.type : "note";
    const template = `
      <form class="flexcol points-tracker-dialog">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.LogNpc")}</label>
          <select name="npcId">
            <option value="">${game.i18n.localize("PF2E.PointsTracker.Influence.LogNoNpc")}</option>
            ${options}
          </select>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.LogTypeLabel")}</label>
          <select name="type">
            <option value="note" ${type === "note" ? "selected" : ""}>${game.i18n.localize(
              "PF2E.PointsTracker.Influence.LogType.note"
            )}</option>
            <option value="info" ${type === "info" ? "selected" : ""}>${game.i18n.localize(
              "PF2E.PointsTracker.Influence.LogType.info"
            )}</option>
          </select>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.LogReason")}</label>
          <input type="text" name="reason" value="${escapeAttribute(initial.reason ?? "")}">
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.LogNote")}</label>
          <textarea name="note" rows="3">${escapeHtml(initial.note ?? "")}</textarea>
        </div>
      </form>
    `;

    const result = await Dialog.prompt({
      title,
      content: template,
      label,
      callback: (html) => {
        const form = html[0].querySelector("form");
        if (!form) return null;
        const formData = new FormData(form);
        const npcIdValue = String(formData.get("npcId") ?? "").trim();
        const typeValue = String(formData.get("type") ?? "note").trim() || "note";
        const reason = String(formData.get("reason") ?? "").trim();
        const note = String(formData.get("note") ?? "").trim();

        return {
          npcId: npcIdValue,
          type: typeValue,
          reason,
          note,
        };
      },
      rejectClose: false,
    });

    if (!result) return null;
    return result;
  }

  async _promptSetInfluenceValue({ npc, initialValue = 0 }) {
    const maxInfluence = Number.isFinite(npc?.maxInfluence) ? Number(npc.maxInfluence) : 0;
    const template = `
      <form class="flexcol points-tracker-dialog">
        <div class="form-group">
          <label>${game.i18n.format("PF2E.PointsTracker.Influence.SetInfluenceFor", {
            name: escapeHtml(npc?.name ?? ""),
          })}</label>
          <input type="number" name="value" min="0" step="1" value="${escapeAttribute(initialValue)}" ${
            maxInfluence > 0 ? `max="${escapeAttribute(maxInfluence)}"` : ""
          }>
        </div>
      </form>
    `;

    const result = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Influence.SetInfluence"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Influence.Save"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        if (!form) return null;
        const formData = new FormData(form);
        const value = Number(formData.get("value"));
        if (!Number.isFinite(value) || value < 0) {
          return 0;
        }
        if (maxInfluence > 0) {
          return Math.min(value, maxInfluence);
        }
        return value;
      },
      rejectClose: false,
    });

    if (result === undefined) return null;
    return result;
  }

  _bindInfluencePortraitDropzones(html) {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? html;
    if (!root || !game.user?.isGM) return;
    const zones = root.querySelectorAll?.("[data-influence-portrait]");
    if (!zones?.length) return;

    zones.forEach((zone) => {
      if (!(zone instanceof HTMLElement)) return;
      const isInteractive = zone.dataset.dropzone === "influence-portrait";
      if (isInteractive) {
        zone.addEventListener("dragenter", (event) => {
          event.preventDefault();
          this._setDropzoneState(zone, true);
        });
        zone.addEventListener("dragover", (event) => {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
          }
          this._setDropzoneState(zone, true);
        });
        zone.addEventListener("dragleave", (event) => {
          const related = event.relatedTarget;
          if (!zone.contains(related)) {
            this._setDropzoneState(zone, false);
          }
        });
        zone.addEventListener("drop", (event) => {
          this._setDropzoneState(zone, false);
          this._onDropInfluencePortrait(event);
        });
        zone.addEventListener("keydown", (event) => {
          if (event.defaultPrevented) return;
          const key = event.key;
          if (key !== "Enter" && key !== " ") return;
          event.preventDefault();
          this._onSelectInfluencePortrait(event);
        });
      }
    });
  }

  async _onDropInfluencePortrait(event) {
    event.preventDefault();

    if (!game.user?.isGM) return;

    const zone = event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : event.target instanceof HTMLElement
      ? event.target.closest?.("[data-influence-portrait]")
      : null;
    if (!zone) return;

    const npcId = zone.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;

    const dataTransfer = event?.dataTransfer ?? event?.originalEvent?.dataTransfer;
    let dropPayload = null;

    const parsePayload = (raw) => {
      if (!raw) return null;
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try {
            return JSON.parse(trimmed);
          } catch (error) {
            logger.error(error);
          }
        }
        return trimmed;
      }
      if (typeof raw === "object") return raw;
      return null;
    };

    if (dataTransfer) {
      const types = Array.from(dataTransfer.types ?? []);
      const orderedTypes = ["text/plain", "text/json", "application/json"];
      for (const type of orderedTypes) {
        if (!types.includes(type)) continue;
        try {
          const raw = dataTransfer.getData(type);
          const parsed = parsePayload(raw);
          if (parsed) {
            dropPayload = parsed;
            break;
          }
        } catch (error) {
          logger.error(error);
        }
      }

      if (!dropPayload && types.includes("text/uri-list")) {
        try {
          const raw = dataTransfer.getData("text/uri-list");
          const firstLine = typeof raw === "string" ? raw.split(/\r?\n/)[0] : raw;
          const parsed = parsePayload(firstLine);
          if (parsed) dropPayload = parsed;
        } catch (error) {
          logger.error(error);
        }
      }
    }

    if (!dropPayload && dataTransfer?.files?.length) {
      const file = dataTransfer.files[0];
      const path = file?.path ?? file?.name;
      if (path) dropPayload = path;
    }

    const portrait = await this._resolvePortrait(dropPayload);
    if (!portrait || !portrait.img) return;

    await this._setInfluencePortrait(npcId, portrait);
  }

  async _onSelectInfluencePortrait(event) {
    event.preventDefault();

    if (!game.user?.isGM || !this.influenceTracker) return;

    const element = event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : event.target instanceof HTMLElement
      ? event.target.closest?.("[data-influence-portrait]")
      : null;
    if (!element) return;

    const npcId = element.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;

    const npc = this.influenceTracker.getNpc(npcId);
    const current = npc?.img ?? "";

    if (typeof FilePicker?.pick === "function") {
      try {
        const result = await FilePicker.pick({ type: "image", current: current || undefined });
        const path = typeof result === "string" ? result : typeof result?.path === "string" ? result.path : "";
        if (path) {
          await this._setInfluencePortrait(npcId, { img: path, imageUuid: "" });
        }
        return;
      } catch (error) {
        logger.error(error);
      }
    }

    let browseTarget = current ?? "";
    if (typeof FilePicker?.browse === "function") {
      try {
        const response = await FilePicker.browse("image", browseTarget || "", { wildcard: true });
        if (response?.target) {
          browseTarget = response.target;
        }
      } catch (error) {
        logger.error(error);
      }
    }

    try {
      const picker = new FilePicker({
        type: "image",
        current: browseTarget || current || undefined,
        callback: async (path) => {
          if (!path) return;
          await this._setInfluencePortrait(npcId, { img: path, imageUuid: "" });
        },
      });
      if (typeof picker.render === "function") {
        picker.render(true);
      } else if (typeof picker.browse === "function") {
        picker.browse();
      }
    } catch (error) {
      logger.error(error);
    }
  }

  async _onClearInfluencePortrait(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!game.user?.isGM || !this.influenceTracker) return;

    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!button) return;

    const npcId = button.closest("[data-npc-id]")?.dataset.npcId;
    if (!npcId) return;

    await this._setInfluencePortrait(npcId, null);
  }

  async _setInfluencePortrait(npcId, portrait) {
    if (!npcId || !this.influenceTracker) return;

    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const img = typeof portrait?.img === "string" ? portrait.img.trim() : "";
    const imageUuid = typeof portrait?.imageUuid === "string" ? portrait.imageUuid.trim() : "";

    if ((npc.img ?? "") === img && (npc.imageUuid ?? "") === imageUuid) return;

    const update = {
      img,
      imageUuid,
    };

    await this.influenceTracker.updateNpc(npcId, update);
    this.render();
  }
}
