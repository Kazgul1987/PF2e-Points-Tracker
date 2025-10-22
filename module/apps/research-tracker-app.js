import { ResearchImportExport } from "../research/importer.js";

const MODULE_ID = "pf2e-points-tracker";

const HTML_ESCAPE_LOOKUP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value) {
  if (!value) return "";
  if (foundry?.utils?.escapeHTML) {
    try {
      return foundry.utils.escapeHTML(value);
    } catch (error) {
      console.error(error);
    }
  }
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_LOOKUP[char] ?? char);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

export class ResearchTrackerApp extends FormApplication {
  /**
   * @param {ResearchTracker} tracker
   * @param {object} [options]
   */
  constructor(tracker, options = {}) {
    super(tracker, options);
    this.tracker = tracker;
    this._dragDropHandlers = [];
    this._expandedTopics = new Set();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "research-tracker-app",
      template: `modules/${MODULE_ID}/module/templates/research-tracker.hbs`,
      title: game.i18n.localize("PF2E.PointsTracker.Research.Title"),
      width: 720,
      height: "auto",
      resizable: true,
      closeOnSubmit: false,
    });
  }

  /**
   * Provide template data.
   */
  async getData() {
    const topics = this.tracker.getTopics();
    const topicIds = new Set();
    for (const topic of topics) {
      if (topic?.id) topicIds.add(topic.id);
    }
    for (const topicId of Array.from(this._expandedTopics)) {
      if (!topicIds.has(topicId)) {
        this._expandedTopics.delete(topicId);
      }
    }
    const log = this.tracker
      .getLog()
      .slice()
      .reverse()
      .map((entry) => ({
        ...entry,
        timestampFormatted: new Date(entry.timestamp).toLocaleString(),
        rollSummary: this._formatRoll(entry.roll),
      }));
    const isGM = game.user?.isGM ?? false;

    const enrichedTopics = [];
    const partyActors = this._getPartyActors();
    const partyActorLookup = new Map();
    for (const actor of partyActors) {
      const uuid = actor?.uuid ?? actor?.id;
      if (uuid) {
        partyActorLookup.set(uuid, actor);
      }
      if (actor?.id && !partyActorLookup.has(actor.id)) {
        partyActorLookup.set(actor.id, actor);
      }
    }
    for (const topic of topics) {
      const thresholds = (topic.thresholds ?? []).map((threshold) => ({
        ...threshold,
        isUnlocked: topic.progress >= threshold.points,
        isRevealed: Array.isArray(topic.revealedThresholdIds)
          ? topic.revealedThresholdIds.includes(threshold.id)
          : Boolean(threshold.revealedAt),
      }));

      const normalizedLocations = (topic.locations ?? []).map((location) => {
        const revealedAt =
          Number.isFinite(location.revealedAt) && location.revealedAt !== null
            ? Number(location.revealedAt)
            : null;
        const isRevealed =
          typeof location.isRevealed === "boolean"
            ? location.isRevealed
            : revealedAt !== null;
        const maxPoints = Number.isFinite(location.maxPoints)
          ? Number(location.maxPoints)
          : 0;
        const collected = Number.isFinite(location.collected)
          ? Number(location.collected)
          : 0;
        const percent = maxPoints > 0 ? Math.min((collected / maxPoints) * 100, 100) : 0;
        const displayMax =
          maxPoints > 0
            ? maxPoints
            : game.i18n.localize("PF2E.PointsTracker.Research.LocationUnlimited");
        const normalizedChecks = this._normalizeLocationChecks(location);
        const checkSummaries = normalizedChecks
          .map((entry) => {
            const skillLabel = entry.skill
              ? game.i18n.format("PF2E.PointsTracker.Research.LocationSkillLabel", {
                  skill: entry.skill,
                })
              : "";
            const dcLabel = isGM && entry.dc !== null
              ? game.i18n.format("PF2E.PointsTracker.Research.LocationDCLabel", {
                  dc: entry.dc,
                })
              : "";
            const parts = [];
            if (skillLabel) parts.push(skillLabel);
            else if (entry.skill) parts.push(entry.skill);
            if (dcLabel) parts.push(dcLabel);
            return parts.join(" • ").trim();
          })
          .filter((summary) => summary);
        const hasRollableCheck = normalizedChecks.some(
          (entry) => entry.skill && entry.dc !== null
        );
        const description = typeof location.description === "string"
          ? location.description.trim()
          : "";
        const assignedActorsRaw = Array.isArray(location.assignedActors)
          ? location.assignedActors
          : [];
        const assignedActors = assignedActorsRaw
          .map((assigned) => {
            const toTrimmedString = (value) =>
              typeof value === "string" ? value.trim() : "";

            const uuid =
              typeof assigned?.uuid === "string"
                ? toTrimmedString(assigned.uuid)
                : typeof assigned?.id === "string"
                ? toTrimmedString(assigned.id)
                : "";
            if (!uuid) return null;

            const fallbackName = toTrimmedString(assigned?.name);
            const match = partyActorLookup.get(uuid) ?? partyActorLookup.get(String(uuid));
            const name = match?.name ?? fallbackName ?? uuid;

            const storedTokenUuid =
              toTrimmedString(assigned?.tokenUuid ?? assigned?.tokenUUID ?? assigned?.tokenId);
            const storedTokenImg = toTrimmedString(
              assigned?.tokenImg ?? assigned?.tokenImage ?? assigned?.imgToken
            );
            const storedActorImg = toTrimmedString(
              assigned?.actorImg ??
                assigned?.actorImage ??
                assigned?.imgActor ??
                assigned?.actorTokenImg
            );
            const storedFinalImg = toTrimmedString(assigned?.img ?? assigned?.image);

            const matchTokenImg = (() => {
              if (!match) return "";
              const texture = match.prototypeToken?.texture;
              const textureSrc =
                typeof texture?.src === "string"
                  ? texture.src.trim()
                  : typeof texture === "string"
                  ? texture.trim()
                  : "";
              const actorImg = toTrimmedString(match.img ?? match.data?.img);
              return textureSrc || actorImg;
            })();

            const finalImg = storedFinalImg || storedTokenImg || storedActorImg || matchTokenImg;

            const result = {
              uuid,
              name,
              isActive: Boolean(match),
            };

            if (storedTokenUuid) result.tokenUuid = storedTokenUuid;
            if (storedTokenImg) result.tokenImg = storedTokenImg;
            if (storedActorImg) result.actorImg = storedActorImg;
            if (finalImg) result.img = finalImg;

            return result;
          })
          .filter((actor) => actor && actor.uuid);
        return {
          ...location,
          isRevealed,
          revealedAt,
          maxPoints,
          collected,
          percent: Math.round(percent * 100) / 100,
          displayMax,
          checkSummaries,
          description,
          hasCheckData: hasRollableCheck,
          assignedActors,
          hasMissingAssignments: assignedActors.some((actor) => !actor.isActive),
        };
      });

      const visibleLocations = isGM
        ? normalizedLocations
        : normalizedLocations.filter((location) => location.isRevealed);

      const totalCollected = visibleLocations.reduce(
        (sum, location) => sum + location.collected,
        0
      );
      const totalMax = visibleLocations.reduce(
        (sum, location) => sum + location.maxPoints,
        0
      );
      const hasUnlimitedLocation = visibleLocations.some(
        (location) => location.maxPoints === 0
      );
      const totalDisplayMax = hasUnlimitedLocation
        ? game.i18n.localize("PF2E.PointsTracker.Research.LocationUnlimited")
        : totalMax;

      const levelNumber = Number(topic.level);
      const hasLevel =
        topic.level !== null && topic.level !== undefined && Number.isFinite(levelNumber);

      enrichedTopics.push({
        ...topic,
        level: hasLevel ? Number(levelNumber) : null,
        hasLevel,
        completed: topic.target > 0 && topic.progress >= topic.target,
        thresholds,
        locations: visibleLocations,
        hasHiddenLocations: normalizedLocations.some((location) => !location.isRevealed),
        isCollapsed: !this._expandedTopics.has(topic.id),
        locationTotals: {
          collected: totalCollected,
          max: totalMax,
          displayMax: totalDisplayMax,
          hasUnlimited: hasUnlimitedLocation,
        },
        gatherInformationHtml: await this._enrichText(topic.gatherInformation ?? ""),
        researchChecksHtml: await this._enrichText(topic.researchChecks ?? ""),
        summaryHtml: await this._enrichText(topic.summary ?? ""),
      });
    }

    return {
      isGM,
      topics: enrichedTopics,
      log,
    };
  }

  /**
   * Register event listeners for controls.
   * @param {JQuery} html
   */
  activateListeners(html) {
    super.activateListeners(html);

    html
      .find("[data-action='create-topic']")
      .off("click")
      .on("click", (event) => this._onCreateTopic(event));
    html
      .find("[data-action='toggle-topic']")
      .off("click")
      .on("click", (event) => this._onToggleTopic(event));
    html
      .find("[data-action='edit-topic']")
      .off("click")
      .on("click", (event) => this._onEditTopic(event));
    html
      .find("[data-action='manage-locations']")
      .off("click")
      .on("click", (event) => this._onManageLocations(event));
    html
      .find("[data-action='delete-topic']")
      .off("click")
      .on("click", (event) => this._onDeleteTopic(event));
    html
      .find("[data-action='add-points']")
      .off("click")
      .on("click", (event) => this._onAdjustPoints(event, 1));
    html
      .find("[data-action='spend-points']")
      .off("click")
      .on("click", (event) => this._onAdjustPoints(event, -1));
    html
      .find("[data-action='nudge-location']")
      .off("click")
      .on("click", (event) => this._onNudgeLocation(event));
    html
      .find("[data-action='perform-roll']")
      .off("click")
      .on("click", (event) => this._onPerformRoll(event));
    html
      .find("[data-action='send-reveal']")
      .off("click")
      .on("click", (event) => this._onSendReveal(event, false));
    html
      .find("[data-action='resend-reveal']")
      .off("click")
      .on("click", (event) => this._onSendReveal(event, true));
    html
      .find("[data-action='import-topics']")
      .off("click")
      .on("click", (event) => this._onImportTopics(event));
    html
      .find("[data-action='export-topics']")
      .off("click")
      .on("click", (event) => this._onExportTopics(event));
    html
      .find("[data-action='create-location']")
      .off("click")
      .on("click", (event) => this._onCreateLocation(event));
    html
      .find("[data-action='edit-location']")
      .off("click")
      .on("click", (event) => this._onEditLocation(event));
    html
      .find("[data-action='delete-location']")
      .off("click")
      .on("click", (event) => this._onDeleteLocation(event));
    html
      .find("[data-action='post-location-check']")
      .off("click")
      .on("click", (event) => this._onPostLocationCheck(event));
    html
      .find("[data-action='reveal-location']")
      .off("click")
      .on("click", (event) => this._onRevealLocation(event, false));
    html
      .find("[data-action='resend-location']")
      .off("click")
      .on("click", (event) => this._onRevealLocation(event, true));

    this._setupLocationDragAndDrop(html);
    html
      .find("[data-action='remove-assigned-actor']")
      .off("click")
      .on("click", (event) => this._onRemoveAssignedActor(event));
  }

  /** @private */
  _onToggleTopic(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const topicElement = button.closest("[data-topic-id]");
    if (!topicElement) return;

    const topicId = topicElement.dataset.topicId;
    if (!topicId) return;

    const body = topicElement.querySelector("[data-topic-body]");
    if (!body) return;

    const shouldCollapse = !body.classList.contains("is-collapsed");
    body.classList.toggle("is-collapsed", shouldCollapse);
    button.setAttribute("aria-expanded", shouldCollapse ? "false" : "true");

    const labelKey = shouldCollapse
      ? "PF2E.PointsTracker.Research.ExpandTopic"
      : "PF2E.PointsTracker.Research.CollapseTopic";
    const label = game.i18n?.localize?.(labelKey) ?? labelKey;
    button.setAttribute("title", label);
    button.setAttribute("aria-label", label);

    if (shouldCollapse) this._expandedTopics.delete(topicId);
    else this._expandedTopics.add(topicId);
  }

  /** @private */
  async _onCreateTopic(event) {
    event.preventDefault();
    const data = await this._promptTopicDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Research.CreateTopic"),
      label: game.i18n.localize("PF2E.PointsTracker.Research.Create"),
      includeLocations: true,
      initial: {
        target: 10,
        thresholds: [],
      },
    });

    if (!data) return;

    await this.tracker.createTopic(data);
    this.render();
  }

  /** @private */
  async _onEditTopic(event) {
    event.preventDefault();
    const topicId = event.currentTarget.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

    const topic = this.tracker.getTopic(topicId);
    if (!topic) return;

    const updates = await this._promptTopicDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Research.EditTopic"),
      label: game.i18n.localize("PF2E.PointsTracker.Research.Save"),
      initial: {
        name: topic.name,
        target: topic.target,
        level: topic.level,
        summary: topic.summary,
        gatherInformation: topic.gatherInformation,
        researchChecks: topic.researchChecks,
        thresholds: Array.isArray(topic.thresholds) ? topic.thresholds : [],
      },
      disableTarget: Array.isArray(topic.locations) && topic.locations.length > 0,
    });

    if (!updates) return;

    await this.tracker.updateTopic(topicId, updates);
    this.render();
  }

  /** @private */
  async _onManageLocations(event) {
    event.preventDefault();
    const topicId = event.currentTarget.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

    const topic = this.tracker.getTopic(topicId);
    if (!topic) return;

    const locations = Array.isArray(topic.locations) ? topic.locations : [];
    if (!locations.length) {
      await this._openLocationDialog(topicId);
      return;
    }

    const createLabel = game.i18n.localize(
      "PF2E.PointsTracker.Research.ManageLocationsCreate"
    );
    const unlimitedLabel = game.i18n.localize(
      "PF2E.PointsTracker.Research.LocationUnlimited"
    );

    const optionMarkup = locations
      .map((location) => {
        const idRaw = location?.id;
        const id =
          idRaw !== undefined && idRaw !== null ? String(idRaw).trim() : "";
        if (!id) return "";

        const nameRaw =
          typeof location?.name === "string" ? location.name.trim() : "";
        const name =
          nameRaw ||
          game.i18n.localize("PF2E.PointsTracker.Research.LocationDefaultName");
        const collectedValue = Number(location?.collected);
        const collected = Number.isFinite(collectedValue)
          ? collectedValue
          : 0;
        const maxValue = Number(location?.maxPoints);
        const displayMax = Number.isFinite(maxValue) && maxValue > 0
          ? maxValue
          : unlimitedLabel;
        const label = game.i18n.format(
          "PF2E.PointsTracker.Research.LocationOptionLabel",
          {
            name,
            collected,
            max: displayMax,
          }
        );
        return `<option value="${escapeAttribute(id)}">${escapeHtml(label)}</option>`;
      })
      .filter((entry) => entry)
      .join("");

    if (!optionMarkup) {
      await this._openLocationDialog(topicId);
      return;
    }

    const options = [
      optionMarkup,
      `<option value="__create__">${escapeHtml(createLabel)}</option>`,
    ].join("");

    const template = `
      <form class="flexcol">
        <div class="form-group">
          <label>${game.i18n.localize(
            "PF2E.PointsTracker.Research.ManageLocationsSelect"
          )}</label>
          <select name="selection">${options}</select>
        </div>
        <p class="notes">${game.i18n.localize(
          "PF2E.PointsTracker.Research.ManageLocationsHint"
        )}</p>
      </form>
    `;

    const selection = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.ManageLocations"),
      content: template,
      label: game.i18n.localize(
        "PF2E.PointsTracker.Research.ManageLocationsOpen"
      ),
      callback: (html) => {
        const form = html?.[0]?.querySelector("form");
        if (!form) return "";
        const select = form.querySelector("select[name='selection']");
        if (!select) return "";
        const rawValue = select.value;
        if (rawValue === undefined || rawValue === null) return "";
        if (typeof rawValue === "string") return rawValue.trim();
        return String(rawValue);
      },
      rejectClose: false,
    });

    if (selection === undefined) return;
    if (!selection) return;

    if (selection === "__create__") {
      await this._openLocationDialog(topicId);
      return;
    }

    const hasLocation = locations.some((location) => {
      const id =
        location?.id !== undefined && location?.id !== null
          ? String(location.id).trim()
          : "";
      return id === selection;
    });
    if (!hasLocation) {
      ui.notifications?.warn?.(
        game.i18n.localize(
          "PF2E.PointsTracker.Research.ManageLocationsMissing"
        )
      );
      return;
    }

    await this._openLocationDialog(topicId, selection);
  }

  /** @private */
  async _openLocationDialog(topicId, locationId) {
    const topicWrapper = document.createElement("div");
    topicWrapper.dataset.topicId = topicId;
    const button = document.createElement("button");

    if (locationId) {
      const locationWrapper = document.createElement("div");
      locationWrapper.dataset.locationId = locationId;
      locationWrapper.appendChild(button);
      topicWrapper.appendChild(locationWrapper);
      await this._onEditLocation({
        preventDefault() {},
        currentTarget: button,
      });
      return;
    }

    topicWrapper.appendChild(button);
    await this._onCreateLocation({
      preventDefault() {},
      currentTarget: button,
    });
  }

  /**
   * Display a dialog for creating or editing a topic.
   * @param {object} options
   * @param {string} options.title
   * @param {string} options.label
   * @param {object} [options.initial]
   * @param {boolean} [options.includeLocations=false]
   * @param {boolean} [options.disableTarget=false]
   * @returns {Promise<object|undefined>}
   */
  async _promptTopicDialog({
    title,
    label,
    initial = {},
    includeLocations = false,
    disableTarget = false,
  }) {
    const hasInitialLevel =
      initial.level !== undefined &&
      initial.level !== null &&
      Number.isFinite(Number(initial.level));
    const values = {
      name: initial.name ?? "",
      target: Number.isFinite(initial.target)
        ? Number(initial.target)
        : includeLocations
        ? 10
        : 0,
      level: hasInitialLevel ? Number(initial.level) : "",
      summary: initial.summary ?? "",
      gatherInformation: initial.gatherInformation ?? "",
      researchChecks: initial.researchChecks ?? "",
      thresholds: Array.isArray(initial.thresholds) ? initial.thresholds : [],
      locations: Array.isArray(initial.locations) ? initial.locations : [],
    };

    const template = `
      <form class="flexcol">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.TopicName")}</label>
          <input type="text" name="name" value="" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Target")}</label>
          <input type="number" name="target" value="" min="1" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Level")}</label>
          <input type="number" name="level" value="" min="0" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Summary")}</label>
          <textarea name="summary" rows="3"></textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.GatherInformation")}</label>
          <textarea name="gatherInformation" rows="3"></textarea>
        </div>
        ${
          includeLocations
            ? ""
            : `
                <div class="form-group">
                  <label>${game.i18n.localize("PF2E.PointsTracker.Research.ResearchChecks")}</label>
                  <textarea name="researchChecks" rows="3"></textarea>
                </div>
              `
        }
        <fieldset class="form-group research-topic__thresholds-editor" data-thresholds>
          <legend>${game.i18n.localize("PF2E.PointsTracker.Research.Thresholds")}</legend>
          <div class="research-topic__thresholds-list" data-threshold-list></div>
          <button type="button" class="dialog-button" data-add-threshold>
            <i class="fas fa-plus"></i>
            ${game.i18n.localize("PF2E.PointsTracker.Research.AddThreshold")}
          </button>
        </fieldset>
        ${
          includeLocations
            ? `
                <fieldset class="form-group research-topic__locations">
                  <legend>${game.i18n.localize("PF2E.PointsTracker.Research.LocationList")}</legend>
                  <p class="notes">${game.i18n.localize("PF2E.PointsTracker.Research.LocationListHint")}</p>
                  <div class="research-topic__location-editor" data-locations></div>
                  <button type="button" class="dialog-button" data-add-location>
                    <i class="fas fa-plus"></i>
                    ${game.i18n.localize("PF2E.PointsTracker.Research.AddLocation")}
                  </button>
                </fieldset>
              `
            : ""
        }
      </form>
    `;

    const result = await Dialog.prompt({
      title,
      content: template,
      label,
      callback: (html) => {
        const form = html[0].querySelector("form");
        if (!form) return undefined;
        const fd = new FormData(form);

        const trimmed = (key) => {
          const raw = fd.get(key);
          return raw !== null ? raw.toString().trim() : undefined;
        };

        const payload = {};

        const nameValue = trimmed("name");
        if (nameValue) {
          payload.name = nameValue;
        }

        const levelRaw = trimmed("level");
        if (levelRaw !== undefined) {
          if (!levelRaw) {
            payload.level = undefined;
          } else {
            const numericLevel = Number(levelRaw);
            if (Number.isFinite(numericLevel)) {
              payload.level = Number(numericLevel);
            }
          }
        }

        const summaryValue = trimmed("summary");
        if (summaryValue !== undefined) {
          payload.summary = summaryValue ?? "";
        }

        const gatherValue = trimmed("gatherInformation");
        if (gatherValue !== undefined) {
          payload.gatherInformation = gatherValue ?? "";
        }

        const researchValue = trimmed("researchChecks");
        if (researchValue !== undefined) {
          payload.researchChecks = researchValue ?? "";
        }

        if (fd.has("target")) {
          payload.target = Number(fd.get("target")) || 0;
        }

        const thresholdEntries = Array.from(
          form.querySelectorAll("[data-threshold-entry]")
        )
          .map((element) => {
            const pointsField = element.querySelector(
              "[data-threshold-field='points']"
            );
            const pointsRaw = pointsField?.value;
            const numericPoints = Number(pointsRaw);
            const hasPoints = Number.isFinite(numericPoints);
            const playerField = element.querySelector(
              "[data-threshold-field='playerText']"
            );
            const gmField = element.querySelector("[data-threshold-field='gmText']");
            const playerText = playerField?.value?.trim() ?? "";
            const gmText = gmField?.value?.trim() ?? "";
            const hasText = Boolean(playerText) || Boolean(gmText);
            if (!hasPoints && !hasText) {
              return null;
            }
            if (!hasPoints) {
              return null;
            }
            const entry = {
              points: numericPoints,
              playerText,
            };
            const id = element.dataset.thresholdId;
            if (id) {
              entry.id = id;
            }
            if (gmField) {
              entry.gmText = gmText;
            }
            return entry;
          })
          .filter((entry) => entry);

        payload.thresholds = thresholdEntries;

        if (includeLocations) {
          const locationEntries = Array.from(
            form.querySelectorAll("[data-location-entry]")
          )
            .map((element) => {
              const name = element.querySelector("[data-field='name']")?.value?.trim();
              const maxPointsValue = element.querySelector("[data-field='maxPoints']")?.value;
              const collectedValue = element.querySelector("[data-field='collected']")?.value;
              const descriptionValue = element
                .querySelector("[data-field='description']")
                ?.value?.trim();
              const maxPoints = Number(maxPointsValue);
              const collected = Number(collectedValue);
              const checks = Array.from(
                element.querySelectorAll("[data-check-entry]")
              )
                .map((checkElement) => {
                  const skill = checkElement
                    .querySelector("[data-check-field='skill']")
                    ?.value?.trim();
                  const dcRaw = checkElement
                    .querySelector("[data-check-field='dc']")
                    ?.value;
                  const dcNumeric = Number(dcRaw);
                  const hasDc = Number.isFinite(dcNumeric) && dcNumeric > 0;
                  const hasSkill = Boolean(skill);
                  if (!hasSkill && !hasDc) return null;
                  const entry = {};
                  if (hasSkill) entry.skill = skill;
                  entry.dc = hasDc ? Number(dcNumeric) : null;
                  return entry;
                })
                .filter((entry) => entry);
              const entry = {
                name: name || undefined,
                maxPoints: Number.isFinite(maxPoints) ? maxPoints : 0,
                collected: Number.isFinite(collected) ? collected : 0,
              };
              if (checks.length) {
                entry.checks = checks;
                const primary = checks[0];
                if (primary?.skill) entry.skill = primary.skill;
                if (primary && primary.dc !== undefined && primary.dc !== null)
                  entry.dc = primary.dc;
              }
              if (descriptionValue) entry.description = descriptionValue;
              const hasData =
                Boolean(entry.name) ||
                (Number.isFinite(entry.maxPoints) && entry.maxPoints > 0) ||
                (Number.isFinite(entry.collected) && entry.collected > 0) ||
                Boolean(entry.description) ||
                checks.length > 0;
              return hasData ? entry : null;
            })
            .filter((entry) => entry);
          payload.locations = locationEntries;
        }

        return payload;
      },
      render: (html) => {
        const root = html[0];
        const form = root.querySelector("form");
        if (!form) return;

        const setValue = (name, value) => {
          const field = form.elements.namedItem(name);
          if (!field) return;
          field.value = value ?? "";
        };

        setValue("name", values.name ?? "");
        setValue("target", values.target ?? 0);
        setValue("level", values.level ?? "");

        const summaryField = form.querySelector("textarea[name='summary']");
        if (summaryField) summaryField.value = values.summary ?? "";
        const gatherField = form.querySelector("textarea[name='gatherInformation']");
        if (gatherField) gatherField.value = values.gatherInformation ?? "";
        const checksField = form.querySelector("textarea[name='researchChecks']");
        if (checksField) checksField.value = values.researchChecks ?? "";

        const targetInput = form.elements.namedItem("target");
        if (targetInput) {
          targetInput.disabled = Boolean(disableTarget);
        }

        const thresholdsFieldset = form.querySelector("[data-thresholds]");
        if (thresholdsFieldset) {
          const list = thresholdsFieldset.querySelector("[data-threshold-list]");
          const addButton = thresholdsFieldset.querySelector("[data-add-threshold]");
          if (list && addButton) {
            list.innerHTML = "";
            const pointsLabel = game.i18n.localize(
              "PF2E.PointsTracker.Research.ThresholdPointsLabel"
            );
            const playerLabel = game.i18n.localize(
              "PF2E.PointsTracker.Research.RevealText"
            );
            const gmLabel = game.i18n.localize("PF2E.PointsTracker.Research.GMText");
            const removeLabel = game.i18n.localize(
              "PF2E.PointsTracker.Research.RemoveThreshold"
            );

            const addRow = (rowValues = {}) => {
              const row = document.createElement("div");
              row.classList.add("research-threshold-editor__row");
              row.dataset.thresholdEntry = "true";
              if (rowValues?.id) {
                row.dataset.thresholdId = String(rowValues.id);
              }

              const pointsGroup = document.createElement("div");
              pointsGroup.classList.add("research-threshold-editor__points");
              const pointsLabelEl = document.createElement("label");
              pointsLabelEl.textContent = pointsLabel;
              const pointsInput = document.createElement("input");
              pointsInput.type = "number";
              pointsInput.min = "0";
              pointsInput.step = "1";
              pointsInput.dataset.thresholdField = "points";
              const pointsValue = rowValues?.points;
              if (pointsValue !== undefined && pointsValue !== null) {
                pointsInput.value = String(pointsValue);
              }
              pointsGroup.appendChild(pointsLabelEl);
              pointsGroup.appendChild(pointsInput);

              const playerGroup = document.createElement("div");
              playerGroup.classList.add("research-threshold-editor__player");
              const playerLabelEl = document.createElement("label");
              playerLabelEl.textContent = playerLabel;
              const playerTextarea = document.createElement("textarea");
              playerTextarea.rows = 3;
              playerTextarea.dataset.thresholdField = "playerText";
              if (typeof rowValues?.playerText === "string") {
                playerTextarea.value = rowValues.playerText;
              }
              playerGroup.appendChild(playerLabelEl);
              playerGroup.appendChild(playerTextarea);

              const gmGroup = document.createElement("div");
              gmGroup.classList.add("research-threshold-editor__gm");
              const gmLabelEl = document.createElement("label");
              gmLabelEl.textContent = gmLabel;
              const gmTextarea = document.createElement("textarea");
              gmTextarea.rows = 3;
              gmTextarea.dataset.thresholdField = "gmText";
              if (typeof rowValues?.gmText === "string") {
                gmTextarea.value = rowValues.gmText;
              }
              gmGroup.appendChild(gmLabelEl);
              gmGroup.appendChild(gmTextarea);

              const controls = document.createElement("div");
              controls.classList.add("research-threshold-editor__controls");
              const removeButton = document.createElement("button");
              removeButton.type = "button";
              removeButton.classList.add("icon");
              removeButton.dataset.removeThreshold = "true";
              removeButton.setAttribute("aria-label", removeLabel);
              removeButton.innerHTML = '<i class="fas fa-trash"></i>';
              removeButton.addEventListener("click", () => row.remove());
              controls.appendChild(removeButton);

              row.appendChild(pointsGroup);
              row.appendChild(playerGroup);
              row.appendChild(gmGroup);
              row.appendChild(controls);
              list.appendChild(row);
            };

            addButton.addEventListener("click", (event) => {
              event.preventDefault();
              addRow();
            });

            if (values.thresholds.length) {
              values.thresholds.forEach((threshold) => addRow(threshold));
            } else {
              addRow();
            }
          }
        }

        if (includeLocations) {
          const container = form.querySelector("[data-locations]");
          const addButton = form.querySelector("[data-add-location]");
          if (!container || !addButton) return;

          const createInput = (type, datasetKey, value) => {
            const input = document.createElement("input");
            input.type = type;
            input.dataset.field = datasetKey;
            if (type === "number") {
              input.min = "0";
              input.step = "1";
            }
            if (value !== undefined && value !== null) {
              input.value = String(value);
            }
            return input;
          };

          const addRow = (rowValues = {}) => {
            const row = document.createElement("div");
            row.classList.add("research-location-editor-row");
            row.dataset.locationEntry = "true";

            const fields = document.createElement("div");
            fields.classList.add("research-location-editor-row__fields");

            const nameInput = createInput("text", "name", rowValues.name ?? "");
            nameInput.placeholder = game.i18n.localize(
              "PF2E.PointsTracker.Research.LocationName"
            );
            const skillLabelText = game.i18n.localize(
              "PF2E.PointsTracker.Research.LocationSkill"
            );
            const dcLabelText = game.i18n.localize(
              "PF2E.PointsTracker.Research.LocationDC"
            );
            const maxInput = createInput("number", "maxPoints", rowValues.maxPoints ?? 0);
            const collectedInput = createInput(
              "number",
              "collected",
              rowValues.collected ?? 0
            );
            const descriptionInput = createInput(
              "text",
              "description",
              rowValues.description ?? ""
            );
            descriptionInput.placeholder = game.i18n.localize(
              "PF2E.PointsTracker.Research.LocationDescription"
            );

            const checksWrapper = document.createElement("div");
            checksWrapper.classList.add("research-location-editor-row__checks");

            const checksLabel = document.createElement("span");
            checksLabel.classList.add("research-location-editor-row__checks-label");
            checksLabel.textContent = `${skillLabelText} / ${dcLabelText}`;
            checksWrapper.appendChild(checksLabel);

            const checksList = document.createElement("div");
            checksList.classList.add("research-location-editor-row__check-list");
            checksWrapper.appendChild(checksList);

            const addCheckButton = document.createElement("button");
            addCheckButton.type = "button";
            addCheckButton.classList.add("dialog-button");
            addCheckButton.dataset.addCheck = "true";
            addCheckButton.innerHTML = `<i class="fas fa-plus"></i> ${game.i18n.localize(
              "PF2E.PointsTracker.Research.AddCheck"
            )}`;
            checksWrapper.appendChild(addCheckButton);

            const addCheckRow = (values = {}) => {
              const checkRow = document.createElement("div");
              checkRow.classList.add("research-location-editor-check-row");
              checkRow.dataset.checkEntry = "true";

              const checkSkillInput = createInput(
                "text",
                "check-skill",
                values?.skill ?? ""
              );
              checkSkillInput.dataset.checkField = "skill";
              checkSkillInput.placeholder = skillLabelText;

              const checkDcValue = values?.dc ?? "";
              const checkDcInput = createInput("number", "check-dc", checkDcValue ?? "");
              checkDcInput.dataset.checkField = "dc";

              const removeCheckButton = document.createElement("button");
              removeCheckButton.type = "button";
              removeCheckButton.classList.add("icon");
              removeCheckButton.dataset.removeCheck = "true";
              removeCheckButton.setAttribute(
                "aria-label",
                game.i18n.localize("PF2E.PointsTracker.Research.RemoveCheck")
              );
              removeCheckButton.innerHTML = '<i class="fas fa-times"></i>';
              removeCheckButton.addEventListener("click", () => checkRow.remove());

              checkRow.appendChild(checkSkillInput);
              checkRow.appendChild(checkDcInput);
              checkRow.appendChild(removeCheckButton);
              checksList.appendChild(checkRow);
            };

            addCheckButton.addEventListener("click", (event) => {
              event.preventDefault();
              addCheckRow();
            });

            const initialChecks = Array.isArray(rowValues.checks) && rowValues.checks.length
              ? rowValues.checks
              : (() => {
                  const fallbackSkill = rowValues.skill ?? "";
                  const fallbackDc = rowValues.dc ?? null;
                  if (fallbackSkill || fallbackDc) {
                    return [
                      {
                        skill: fallbackSkill,
                        dc: fallbackDc,
                      },
                    ];
                  }
                  return [{}];
                })();
            initialChecks.forEach((check) => addCheckRow(check));

            fields.appendChild(nameInput);
            fields.appendChild(maxInput);
            fields.appendChild(collectedInput);
            fields.appendChild(checksWrapper);
            fields.appendChild(descriptionInput);

            const removeButton = document.createElement("button");
            removeButton.type = "button";
            removeButton.classList.add("icon");
            removeButton.dataset.removeLocation = "true";
            removeButton.setAttribute(
              "aria-label",
              game.i18n.localize("PF2E.PointsTracker.Research.RemoveLocation")
            );
            removeButton.innerHTML = '<i class="fas fa-trash"></i>';
            removeButton.addEventListener("click", () => row.remove());

            row.appendChild(fields);
            row.appendChild(removeButton);
            container.appendChild(row);
          };

          addButton.addEventListener("click", (event) => {
            event.preventDefault();
            addRow();
          });

          if (values.locations.length) {
            values.locations.forEach((location) => addRow(location));
          } else {
            addRow();
          }
        }
      },
      rejectClose: false,
    });

    return result ?? undefined;
  }

  /** @private */
  async _onDeleteTopic(event) {
    event.preventDefault();
    const topicId = event.currentTarget.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Research.DeleteTopic"),
      content: `<p>${game.i18n.localize("PF2E.PointsTracker.Research.DeleteTopicConfirm")}</p>`,
    });
    if (!confirmed) return;

    await this.tracker.deleteTopic(topicId);
    this.render();
  }

  /** @private */
  async _onAdjustPoints(event, direction) {
    event.preventDefault();
    const topicId = event.currentTarget.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

    const topic = this.tracker.getTopic(topicId);
    if (!topic) return;

    const locationId = event.currentTarget.dataset.locationId;
    const hasLocations = Array.isArray(topic.locations) && topic.locations.length > 0;
    const defaultValue = direction > 0 ? Math.abs(direction) : -Math.abs(direction);

    const locationOptions = hasLocations
      ? topic.locations
          .map((location) => {
            const isSelected = String(locationId ?? "") === String(location.id);
            const totalLabel = game.i18n.format(
              "PF2E.PointsTracker.Research.LocationOptionLabel",
              {
                name: location.name,
                collected: location.collected,
                max:
                  location.maxPoints ||
                  game.i18n.localize("PF2E.PointsTracker.Research.LocationUnlimited"),
              }
            );
            const selectedAttribute = isSelected ? " selected" : "";
            return `<option value="${escapeAttribute(location.id)}"${selectedAttribute}>${escapeHtml(totalLabel)}</option>`;
          })
          .join("")
      : "";

    const locationPlaceholder = escapeHtml(
      game.i18n.localize("PF2E.PointsTracker.Research.LocationSelectPlaceholder")
    );

    const locationSelect = hasLocations
      ? `
                <div class="form-group">
                  <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationSelect")}</label>
                  <select name="locationId">
                    ${
                      locationId
                        ? locationOptions
                        : `<option value="" selected>${locationPlaceholder}</option>${locationOptions}`
                    }
                  </select>
                </div>
              `
      : "";

    const template = `
      <form class="flexcol">
        ${locationSelect}
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.PointChange")}</label>
          <input type="number" name="points" value="${defaultValue}" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Reason")}</label>
          <input type="text" name="reason" value="" />
        </div>
      </form>
    `;

    const response = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.AdjustPoints"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Apply"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const fd = new FormData(form);
        const value = Number(fd.get("points")) || 0;
        return {
          points: value,
          reason: fd.get("reason")?.toString().trim() || undefined,
          locationId: fd.get("locationId")?.toString() || undefined,
        };
      },
      rejectClose: false,
    });

    if (!response) return;

    if (hasLocations && !response.locationId) {
      ui.notifications?.warn?.(
        game.i18n.localize("PF2E.PointsTracker.Research.LocationSelectRequired")
      );
      return;
    }

    if (hasLocations) {
      await this.tracker.adjustLocationPoints(topicId, response.locationId, response.points, {
        reason: response.reason,
      });
    } else {
      await this.tracker.adjustPoints(topicId, response.points, {
        reason: response.reason,
      });
    }
    this.render();
  }

  /** @private */
  async _onNudgeLocation(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const topicId = button.closest("[data-topic-id]")?.dataset.topicId ?? button.dataset.topicId;
    const locationId = button.dataset.locationId ?? button.closest("[data-location-id]")?.dataset.locationId;
    if (!topicId || !locationId) return;

    const delta = Number(button.dataset.delta);
    if (!Number.isFinite(delta) || Math.abs(delta) !== 1) return;

    const reason = typeof button.dataset.reason === "string" ? button.dataset.reason.trim() : "";
    const metadata = reason ? { reason } : undefined;

    await this.tracker.adjustLocationPoints(topicId, locationId, delta, metadata);
    this.render();
  }

  /** @private */
  async _onCreateLocation(event) {
    event.preventDefault();
    const topicId = event.currentTarget.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

    const partyActors = this._getPartyActors();
    const assignmentOptions = partyActors
      .map((actor) => {
        const uuid = actor?.uuid ?? actor?.id;
        if (!uuid) return "";
        const name = actor?.name ?? uuid;
        return `<label class="research-location__assignment-option"><input type="checkbox" name="assignedActors" value="${escapeAttribute(
          uuid
        )}" data-actor-name="${escapeAttribute(name)}" /> ${escapeHtml(name)}</label>`;
      })
      .filter((markup) => markup)
      .join("");
    const assignmentsSection = assignmentOptions
      ? `
        <fieldset class="form-group research-location__assignment-fieldset">
          <legend>${game.i18n.localize("PF2E.PointsTracker.Research.LocationAssignments")}</legend>
          <p class="notes">${game.i18n.localize("PF2E.PointsTracker.Research.LocationAssignmentsHint")}</p>
          <div class="research-location__assignment-options">${assignmentOptions}</div>
        </fieldset>
      `
      : `
        <p class="notes research-location__assignment-empty">${game.i18n.localize(
          "PF2E.PointsTracker.Research.LocationAssignmentsUnavailable"
        )}</p>
      `;

    const template = `
      <form class="flexcol">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationName")}</label>
          <input type="text" name="name" value="" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationSkill")} / ${game.i18n.localize("PF2E.PointsTracker.Research.LocationDC")}</label>
          <div class="research-location__check-editor" data-checks></div>
          <button type="button" class="dialog-button" data-add-check>
            <i class="fas fa-plus"></i>
            ${game.i18n.localize("PF2E.PointsTracker.Research.AddCheck")}
          </button>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationMaxPoints")}</label>
          <input type="number" name="maxPoints" value="10" min="0" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationCollected")}</label>
          <input type="number" name="collected" value="0" min="0" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationDescription")}</label>
          <textarea name="description" rows="3"></textarea>
        </div>
        ${assignmentsSection}
      </form>
    `;

    const response = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.CreateLocation"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Create"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const fd = new FormData(form);
        const selectedAssignments = Array.from(
          form.querySelectorAll("input[name='assignedActors']:checked")
        )
          .map((input) => ({
            uuid: input.value?.toString() ?? "",
            name: input.dataset.actorName ?? "",
          }))
          .filter((entry) => entry.uuid);
        const checks = Array.from(form.querySelectorAll("[data-check-entry]"))
          .map((row) => {
            const skillElement = row.querySelector("[data-check-field='skill']");
            const rawSkill = skillElement?.value;
            const skill =
              typeof rawSkill === "string"
                ? rawSkill.trim()
                : rawSkill !== undefined && rawSkill !== null
                ? String(rawSkill).trim()
                : "";
            const dcRaw = row.querySelector("[data-check-field='dc']")?.value;
            const dcNumeric = Number(dcRaw);
            const hasDc = Number.isFinite(dcNumeric) && dcNumeric > 0;
            const hasSkill = Boolean(skill);
            if (!hasSkill && !hasDc) return null;
            const entry = {};
            if (hasSkill) entry.skill = skill;
            entry.dc = hasDc ? Number(dcNumeric) : null;
            return entry;
          })
          .filter((entry) => entry);
        const primaryCheck = checks[0];
        return {
          name: fd.get("name")?.toString().trim() || undefined,
          maxPoints: Number(fd.get("maxPoints")) || 0,
          collected: Number(fd.get("collected")) || 0,
          description: fd.get("description")?.toString().trim() || undefined,
          assignedActors: selectedAssignments,
          checks,
          skill: primaryCheck?.skill,
          dc: primaryCheck?.dc ?? null,
        };
      },
      rejectClose: false,
      render: (html) => {
        const form = html[0].querySelector("form");
        if (!form) return;
        const container = form.querySelector("[data-checks]");
        const addButton = form.querySelector("[data-add-check]");
        this._setupCheckEditor(container, addButton, []);
      },
    });

    if (!response) return;
    await this.tracker.createLocation(topicId, response);
    this.render();
  }

  /** @private */
  async _onEditLocation(event) {
    event.preventDefault();
    const container = event.currentTarget.closest("[data-location-id]");
    if (!container) return;
    const topicId = container.closest("[data-topic-id]")?.dataset.topicId;
    const locationId = container.dataset.locationId;
    if (!topicId || !locationId) return;

    const topic = this.tracker.getTopic(topicId);
    const location = topic?.locations?.find((entry) => entry.id === locationId);
    if (!topic || !location) return;

    const partyActors = this._getPartyActors();
    const currentAssignments = Array.isArray(location.assignedActors)
      ? location.assignedActors
      : [];
    const assignedMap = new Map();
    for (const assigned of currentAssignments) {
      const uuid =
        typeof assigned?.uuid === "string"
          ? assigned.uuid
          : typeof assigned?.id === "string"
          ? assigned.id
          : "";
      if (!uuid) continue;
      const name =
        typeof assigned?.name === "string" && assigned.name.trim()
          ? assigned.name.trim()
          : uuid;
      assignedMap.set(uuid, name);
    }
    const partyAssignmentOptions = partyActors
      .map((actor) => {
        const uuid = actor?.uuid ?? actor?.id;
        if (!uuid) return "";
        const name = actor?.name ?? uuid;
        const checked = assignedMap.has(uuid) ? "checked" : "";
        return `<label class="research-location__assignment-option"><input type="checkbox" name="assignedActors" value="${escapeAttribute(
          uuid
        )}" data-actor-name="${escapeAttribute(name)}" ${checked} /> ${escapeHtml(name)}</label>`;
      })
      .filter((markup) => markup)
      .join("");
    const missingAssignments = currentAssignments.filter((assigned) => {
      const uuid =
        typeof assigned?.uuid === "string"
          ? assigned.uuid
          : typeof assigned?.id === "string"
          ? assigned.id
          : "";
      if (!uuid) return false;
      const hasParty = partyActors.some((actor) => (actor?.uuid ?? actor?.id) === uuid);
      return !hasParty;
    });
    const missingOptions = missingAssignments
      .map((assigned) => {
        const uuid =
          typeof assigned?.uuid === "string"
            ? assigned.uuid
            : typeof assigned?.id === "string"
            ? assigned.id
            : "";
        if (!uuid) return "";
        const storedName =
          typeof assigned?.name === "string" && assigned.name.trim()
            ? assigned.name.trim()
            : uuid;
        const label = game.i18n.format(
          "PF2E.PointsTracker.Research.LocationAssignmentsMissing",
          { name: storedName }
        );
        return `<label class="research-location__assignment-option"><input type="checkbox" name="assignedActors" value="${escapeAttribute(
          uuid
        )}" data-actor-name="${escapeAttribute(storedName)}" checked /> ${escapeHtml(label)}</label>`;
      })
      .filter((markup) => markup)
      .join("");
    const assignmentOptions = [partyAssignmentOptions, missingOptions]
      .filter((section) => section)
      .join("");
    const assignmentsSection = assignmentOptions
      ? `
        <fieldset class="form-group research-location__assignment-fieldset">
          <legend>${game.i18n.localize("PF2E.PointsTracker.Research.LocationAssignments")}</legend>
          <p class="notes">${game.i18n.localize("PF2E.PointsTracker.Research.LocationAssignmentsHint")}</p>
          <div class="research-location__assignment-options">${assignmentOptions}</div>
        </fieldset>
      `
      : `
        <p class="notes research-location__assignment-empty">${game.i18n.localize(
          "PF2E.PointsTracker.Research.LocationAssignmentsUnavailable"
        )}</p>
      `;

    const template = `
      <form class="flexcol">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationName")}</label>
          <input type="text" name="name" value="${location.name}" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationSkill")} / ${game.i18n.localize("PF2E.PointsTracker.Research.LocationDC")}</label>
          <div class="research-location__check-editor" data-checks></div>
          <button type="button" class="dialog-button" data-add-check>
            <i class="fas fa-plus"></i>
            ${game.i18n.localize("PF2E.PointsTracker.Research.AddCheck")}
          </button>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationMaxPoints")}</label>
          <input type="number" name="maxPoints" value="${location.maxPoints}" min="0" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationCollected")}</label>
          <input type="number" name="collected" value="${location.collected}" min="0" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationDescription")}</label>
          <textarea name="description" rows="3">${location.description ?? ""}</textarea>
        </div>
        ${assignmentsSection}
      </form>
    `;

    const response = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.EditLocation"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Save"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const fd = new FormData(form);
        const descriptionRaw = fd.get("description");
        const descriptionValue =
          descriptionRaw !== null ? descriptionRaw.toString().trim() : undefined;
        const selectedAssignments = Array.from(
          form.querySelectorAll("input[name='assignedActors']:checked")
        )
          .map((input) => ({
            uuid: input.value?.toString() ?? "",
            name: input.dataset.actorName ?? "",
          }))
          .filter((entry) => entry.uuid);
        const checks = Array.from(form.querySelectorAll("[data-check-entry]"))
          .map((row) => {
            const skillElement = row.querySelector("[data-check-field='skill']");
            const rawSkill = skillElement?.value;
            const skill =
              typeof rawSkill === "string"
                ? rawSkill.trim()
                : rawSkill !== undefined && rawSkill !== null
                ? String(rawSkill).trim()
                : "";
            const dcRaw = row.querySelector("[data-check-field='dc']")?.value;
            const dcNumeric = Number(dcRaw);
            const hasDc = Number.isFinite(dcNumeric) && dcNumeric > 0;
            const hasSkill = Boolean(skill);
            if (!hasSkill && !hasDc) return null;
            const entry = {};
            if (hasSkill) entry.skill = skill;
            entry.dc = hasDc ? Number(dcNumeric) : null;
            return entry;
          })
          .filter((entry) => entry);
        const primaryCheck = checks[0];
        return {
          name: fd.get("name")?.toString().trim() || undefined,
          maxPoints: Number(fd.get("maxPoints")) || 0,
          collected: Number(fd.get("collected")) || 0,
          ...(descriptionValue !== undefined ? { description: descriptionValue } : {}),
          assignedActors: selectedAssignments,
          checks,
          ...(primaryCheck?.skill ? { skill: primaryCheck.skill } : {}),
          dc: primaryCheck?.dc ?? null,
        };
      },
      rejectClose: false,
      render: (html) => {
        const form = html[0].querySelector("form");
        if (!form) return;
        const container = form.querySelector("[data-checks]");
        const addButton = form.querySelector("[data-add-check]");
        const initialChecks = Array.isArray(location.checks) && location.checks.length
          ? location.checks
          : (() => {
              const fallbackSkill = location.skill ?? "";
              const fallbackDc = location.dc ?? null;
              if (fallbackSkill || fallbackDc) {
                return [
                  {
                    skill: fallbackSkill,
                    dc: fallbackDc,
                  },
                ];
              }
              return [];
            })();
        this._setupCheckEditor(container, addButton, initialChecks);
      },
    });

    if (!response) return;

    await this.tracker.updateLocation(topicId, locationId, response);
    this.render();
  }

  /** @private */
  async _onDeleteLocation(event) {
    event.preventDefault();
    const container = event.currentTarget.closest("[data-location-id]");
    if (!container) return;
    const topicId = container.closest("[data-topic-id]")?.dataset.topicId;
    const locationId = container.dataset.locationId;
    if (!topicId || !locationId) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Research.DeleteLocation"),
      content: `<p>${game.i18n.localize("PF2E.PointsTracker.Research.DeleteLocationConfirm")}</p>`,
    });
    if (!confirmed) return;

    await this.tracker.deleteLocation(topicId, locationId);
    this.render();
  }

  /** @private */
  async _onPostLocationCheck(event) {
    event.preventDefault();
    const container = event.currentTarget.closest("[data-location-id]");
    if (!container) return;
    const topicId = container.closest("[data-topic-id]")?.dataset.topicId;
    const locationId = container.dataset.locationId;
    if (!topicId || !locationId) return;

    const topic = this.tracker.getTopic(topicId);
    const location = topic?.locations?.find((entry) => entry.id === locationId);
    if (!topic || !location) return;

    const normalizedChecks = this._normalizeLocationChecks(location);
    const hasSkill = normalizedChecks.some((entry) => entry.skill);
    if (!hasSkill) {
      ui.notifications?.warn?.(
        game.i18n.localize("PF2E.PointsTracker.Research.LocationMissingSkill")
      );
      return;
    }

    const rollableChecks = normalizedChecks.filter(
      (entry) => entry.skill && entry.dc !== null
    );
    if (!rollableChecks.length) {
      ui.notifications?.warn?.(
        game.i18n.localize("PF2E.PointsTracker.Research.LocationMissingDC")
      );
      return;
    }

    const locationName =
      location.name ?? game.i18n.localize("PF2E.PointsTracker.Research.LocationName");
    const createInlineForCheck = (check) => {
      const skillKey = typeof check.skill === "string" ? check.skill : "";
      const skillSlug = skillKey && skillKey.trim() ? skillKey.toLowerCase() : "";
      const parts = [];
      if (skillSlug) {
        parts.push(skillSlug);
      }
      const dcValue = Number(check.dc);
      if (Number.isFinite(dcValue)) {
        parts.push(`dc:${dcValue}`);
      }
      const skillConfig =
        skillSlug && CONFIG?.PF2E?.skills ? CONFIG.PF2E.skills[skillSlug] : null;
      if (typeof skillConfig === "string" && skillConfig.trim()) {
        return `@Check[${parts.join("|")}]{${
          typeof game.i18n?.localize === "function"
            ? game.i18n.localize(skillConfig)
            : skillConfig
        }}`;
      }
      if (skillConfig && typeof skillConfig?.label === "string" && skillConfig.label.trim()) {
        return `@Check[${parts.join("|")}]{${skillConfig.label.trim()}}`;
      }
      if (skillKey) {
        return `@Check[${parts.join("|")}]{${skillKey}}`;
      }
      return `@Check[${parts.join("|")}]{${locationName}}`;
    };

    const inlineChecks = rollableChecks.map((check) => createInlineForCheck(check));

    const description =
      typeof location.description === "string" ? location.description.trim() : "";
    const contentParts = [
      `<p>${escapeHtml(locationName)} ${inlineChecks.join(" ")}</p>`,
    ];
    if (description) {
      contentParts.push(`<p>${escapeHtml(description)}</p>`);
    }

    const speaker = ChatMessage.getSpeaker();
    const payload = {
      content: contentParts.join(""),
      speaker,
    };
    const messageType =
      typeof CONST !== "undefined" ? CONST?.CHAT_MESSAGE_TYPES?.OTHER : undefined;
    if (messageType !== undefined) {
      payload.type = messageType;
    }

    await ChatMessage.create(payload);
  }

  _setupLocationDragAndDrop(html) {
    const root = html?.[0];
    if (!root || typeof DragDrop === "undefined") return;

    if (Array.isArray(this._dragDropHandlers)) {
      for (const handler of this._dragDropHandlers) {
        if (handler?.unbind) {
          handler.unbind();
        }
      }
    }
    this._dragDropHandlers = [];

    const participants = root.querySelectorAll("[data-draggable='participant']");
    participants.forEach((element) => {
      element.addEventListener("dragend", () => {
        element.classList.remove("is-dragging");
      });
    });

    const topics = root.querySelectorAll(".research-topic");
    topics.forEach((topicElement) => {
      const dropZones = topicElement.querySelectorAll("[data-dropzone='location']");
      if (!dropZones.length) return;

      dropZones.forEach((zone) => {
        zone.setAttribute("aria-dropeffect", "move");
        zone.addEventListener("dragenter", (event) => {
          event.preventDefault();
          this._setDropzoneState(zone, true);
        });
        zone.addEventListener("dragover", (event) => {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
          this._setDropzoneState(zone, true);
        });
        zone.addEventListener("dragleave", (event) => {
          const related = event.relatedTarget;
          if (!zone.contains(related)) {
            this._setDropzoneState(zone, false);
          }
        });
        zone.addEventListener("drop", () => this._setDropzoneState(zone, false));
      });

      const dragDrop = new DragDrop({
        dragSelector: "[data-draggable='participant']",
        dropSelector: "[data-dropzone='location']",
        permissions: { dragstart: () => true, drop: () => true },
        callbacks: {
          dragstart: (event) => this._onDragParticipant(event),
          drop: (event, data) => this._onDropParticipant(event, data),
        },
      });
      dragDrop.bind(topicElement);
      this._dragDropHandlers.push(dragDrop);
    });
  }

  _setDropzoneState(zone, isActive) {
    if (!zone) return;
    zone.classList.toggle("is-dragover", Boolean(isActive));
  }

  _normalizeAssignedActors(assignments = []) {
    return assignments
      .map((entry) => {
        const uuid =
          typeof entry?.uuid === "string"
            ? entry.uuid
            : typeof entry?.id === "string"
            ? entry.id
            : "";
        if (!uuid) return null;
        const trimmedUuid = uuid.trim();
        if (!trimmedUuid) return null;

        const normalized = {};
        const skipKeys = new Set(["uuid", "id", "_id", "isActive"]);
        if (entry && typeof entry === "object") {
          for (const [key, value] of Object.entries(entry)) {
            if (skipKeys.has(key)) continue;
            if (value === undefined || value === null) continue;
            if (typeof value === "string") {
              const trimmedValue = value.trim();
              if (!trimmedValue) continue;
              normalized[key] = trimmedValue;
            } else {
              normalized[key] = value;
            }
          }
        }

        const name =
          typeof entry?.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : typeof normalized?.name === "string" && normalized.name.trim()
            ? normalized.name.trim()
            : undefined;

        if (name) {
          normalized.name = name;
        } else {
          delete normalized.name;
        }

        return { uuid: trimmedUuid, ...normalized };
      })
      .filter((entry) => entry && entry.uuid);
  }

  _onDragParticipant(event) {
    const element = event?.currentTarget;
    if (!element) return null;
    element.classList.add("is-dragging");

    if (event?.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }

    const actorUuid = element.dataset.actorUuid;
    if (!actorUuid) {
      element.classList.remove("is-dragging");
      return null;
    }

    const actorName = element.dataset.actorName?.trim() ?? "";
    const topicId = element.closest("[data-topic-id]")?.dataset.topicId;
    return {
      type: "pf2e-research-participant",
      actorUuid,
      actorName,
      topicId,
    };
  }

  async _onDropParticipant(event, data) {
    event.preventDefault();

    if (!data) {
      const dataTransfer = event?.originalEvent?.dataTransfer ?? event?.dataTransfer;
      const getData = dataTransfer?.getData?.bind(dataTransfer);
      if (getData) {
        const rawPayload = getData("text/plain");
        if (rawPayload) {
          try {
            const parsed = JSON.parse(rawPayload);
            const type = typeof parsed?.type === "string" ? parsed.type : "";
            const uuid = typeof parsed?.uuid === "string" ? parsed.uuid.trim() : "";
            const isSupportedType = type === "Actor" || type === "Token";
            if (isSupportedType && uuid) {
              data = parsed;
            }
          } catch (error) {
            console.error(error);
          }
        }
      }
    }

    const dropZone = event?.currentTarget;
    if (!dropZone) return;

    const topicId = dropZone.closest("[data-topic-id]")?.dataset.topicId;
    const locationId = dropZone.closest("[data-location-id]")?.dataset.locationId;
    if (!topicId || !locationId) return;

    const isActorDrag =
      data?.type === "pf2e-research-participant" ||
      data?.type === "Actor" ||
      data?.type === "Token" ||
      data?.actorUuid !== undefined ||
      data?.actorId !== undefined;
    if (!isActorDrag) return;

    const trimString = (value) => (typeof value === "string" ? value.trim() : "");
    const getTextureSrc = (texture) => {
      if (!texture) return "";
      if (typeof texture === "string") return trimString(texture);
      if (typeof texture?.src === "string") return trimString(texture.src);
      return "";
    };

    const rawActorUuid = trimString(data?.actorUuid);
    const rawActorId = trimString(data?.actorId);
    const rawTokenUuid = trimString(data?.tokenUuid);
    const rawUuid = trimString(data?.uuid);
    const rawId = trimString(data?.id);
    const rawDocumentId = trimString(data?.documentId);
    const rawUnderscoreId = trimString(data?._id);

    let actorUuid = "";
    let tokenUuid = rawTokenUuid;
    let tokenDocument = null;

    if (rawActorUuid) actorUuid = rawActorUuid;
    else if (rawActorId) actorUuid = rawActorId;
    else if (rawUuid) actorUuid = rawUuid;
    else if (rawId) actorUuid = rawId;
    else if (rawDocumentId) actorUuid = rawDocumentId;
    else if (rawUnderscoreId) actorUuid = rawUnderscoreId;

    if (!tokenUuid && data?.type === "Token") {
      if (rawUuid && (rawUuid.startsWith("Scene.") || rawUuid.startsWith("Token."))) {
        tokenUuid = rawUuid;
      } else {
        const sceneId = trimString(data?.sceneId);
        const tokenId = trimString(data?.tokenId);
        if (sceneId && tokenId) {
          tokenUuid = `Scene.${sceneId}.Token.${tokenId}`;
        }
      }
    }

    if (actorUuid.startsWith("Scene.") || actorUuid.startsWith("Token.")) {
      if (!tokenUuid) tokenUuid = actorUuid;
      actorUuid = "";
    }

    const hasDocumentPrefix =
      actorUuid.startsWith("Actor.") ||
      actorUuid.startsWith("Compendium.") ||
      actorUuid.includes(".");
    if (actorUuid && !hasDocumentPrefix) {
      actorUuid = `Actor.${actorUuid}`;
    }

    let actorDocument = null;
    if (actorUuid && typeof fromUuid === "function") {
      try {
        actorDocument = await fromUuid(actorUuid);
      } catch (error) {
        console.warn(error);
      }
    }

    if ((!actorDocument || !actorUuid) && tokenUuid && typeof fromUuid === "function") {
      try {
        tokenDocument = await fromUuid(tokenUuid);
        const tokenActor = tokenDocument?.actor;
        if (tokenActor) {
          actorDocument = tokenActor;
          actorUuid = tokenActor.uuid ?? actorUuid;
        }
      } catch (error) {
        console.warn(error);
      }
    }

    if (!tokenUuid) {
      tokenUuid = trimString(tokenDocument?.uuid ?? "");
    }

    if (!actorUuid) {
      actorUuid = trimString(actorDocument?.uuid);
    }

    if (!actorUuid) return;

    const hasFinalPrefix =
      actorUuid.startsWith("Actor.") ||
      actorUuid.startsWith("Compendium.") ||
      actorUuid.includes(".");
    if (actorUuid && !hasFinalPrefix) {
      actorUuid = `Actor.${actorUuid}`;
    }

    let actorName =
      (typeof data?.actorName === "string" && data.actorName.trim())
        ? data.actorName.trim()
        : typeof data?.name === "string"
        ? data.name
        : typeof data?.data?.name === "string"
        ? data.data.name
        : "";

    if (!actorName && actorDocument?.name) {
      actorName = actorDocument.name;
    } else if (!actorName && actorUuid && typeof fromUuid === "function") {
      try {
        const actor = await fromUuid(actorUuid);
        if (actor?.name) {
          actorName = actor.name;
        }
      } catch (error) {
        console.warn(error);
      }
    }

    const tokenImg =
      getTextureSrc(tokenDocument?.texture) ||
      trimString(tokenDocument?.img ?? tokenDocument?.data?.img);
    const actorPrototypeImg = getTextureSrc(actorDocument?.prototypeToken?.texture);
    const actorPortraitImg =
      trimString(actorDocument?.img ?? actorDocument?.data?.img) || actorPrototypeImg;
    const finalImg = tokenImg || actorPrototypeImg || actorPortraitImg;

    const topic = this.tracker.getTopic(topicId);
    const location = topic?.locations?.find((entry) => entry.id === locationId);
    if (!location) return;

    const normalized = this._normalizeAssignedActors(location.assignedActors);
    if (normalized.some((entry) => entry.uuid === actorUuid)) {
      return;
    }

    const newAssignment = { uuid: actorUuid };
    if (actorName) newAssignment.name = actorName;
    if (tokenUuid) newAssignment.tokenUuid = tokenUuid;
    if (tokenImg) newAssignment.tokenImg = tokenImg;
    if (actorPrototypeImg) newAssignment.actorTokenImg = actorPrototypeImg;
    if (actorPortraitImg) newAssignment.actorImg = actorPortraitImg;
    if (finalImg) newAssignment.img = finalImg;

    const newAssignments = [...normalized, newAssignment];

    await this.tracker.updateLocation(topicId, locationId, {
      assignedActors: newAssignments,
    });
    this.render();
  }

  async _onRemoveAssignedActor(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const actorUuid = button?.dataset.actorUuid;
    const topicId = button?.closest("[data-topic-id]")?.dataset.topicId;
    const locationId = button?.closest("[data-location-id]")?.dataset.locationId;
    if (!topicId || !locationId || !actorUuid) return;

    const topic = this.tracker.getTopic(topicId);
    const location = topic?.locations?.find((entry) => entry.id === locationId);
    if (!location) return;

    const normalized = this._normalizeAssignedActors(location.assignedActors);
    const filtered = normalized.filter((entry) => entry.uuid !== actorUuid);
    if (filtered.length === normalized.length) return;

    await this.tracker.updateLocation(topicId, locationId, {
      assignedActors: filtered,
    });
    this.render();
  }

  /** @private */
  async _onPerformRoll(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const topicId = button.closest("[data-topic-id]")?.dataset.topicId;
    const actorUuid =
      button.dataset.actorUuid ?? button.closest("[data-actor-uuid]")?.dataset.actorUuid;
    if (!topicId || !actorUuid) return;

    const topic = this.tracker.getTopic(topicId);
    if (!topic) return;

    const candidateLocations = Array.isArray(topic.locations) ? topic.locations : [];
    const candidateSkills = [];
    for (const location of candidateLocations) {
      const checks = Array.isArray(location?.checks) ? location.checks : [];
      for (const check of checks) {
        if (typeof check?.skill === "string" && check.skill.trim()) {
          candidateSkills.push(check.skill.trim());
        }
      }
      if (!checks.length && typeof location?.skill === "string" && location.skill.trim()) {
        candidateSkills.push(location.skill.trim());
      }
    }

    const legacyTopicSkill =
      typeof topic?.skill === "string" && topic.skill.trim() ? topic.skill.trim() : "";
    if (legacyTopicSkill) {
      candidateSkills.unshift(legacyTopicSkill);
    }

    const topicSkill = candidateSkills.find((skill) => skill);
    if (!topicSkill) {
      ui.notifications.warn(
        game.i18n.localize("PF2E.PointsTracker.Research.NoSkillConfigured")
      );
      return;
    }

    let actor;
    try {
      actor = await fromUuid(actorUuid);
    } catch (error) {
      console.error(error);
    }

    if (!actor) {
      ui.notifications.warn(game.i18n.localize("PF2E.PointsTracker.Research.NoActor"));
      return;
    }

    if (!(actor.skills)) {
      ui.notifications.warn(game.i18n.localize("PF2E.PointsTracker.Research.ActorMissingSkills"));
      return;
    }

    const normalizedSkill =
      typeof topicSkill === "string" ? topicSkill.trim().toLowerCase() : "";
    const skill = actor.skills[normalizedSkill] ?? actor.skills[topicSkill];
    if (!skill?.roll) {
      ui.notifications.warn(game.i18n.localize("PF2E.PointsTracker.Research.SkillUnavailable"));
      return;
    }

    const roll = await skill.roll({
      event,
      callback: null,
      createMessage: true,
      extraRollOptions: ["research"],
      dc: null,
    });

    if (!roll) return;

    const adjustment = await this._promptForPoints(roll.total, topic);
    if (!adjustment) return;

    if (topic?.locations?.length) {
      const locationId = adjustment.locationId ?? topic.locations[0]?.id;
      if (!locationId) return;
      await this.tracker.adjustLocationPoints(topicId, locationId, adjustment.points, {
        actorUuid: actor.uuid ?? actorUuid,
        actorName: actor.name,
        reason: adjustment.reason,
        roll: roll.toJSON ? roll.toJSON() : roll,
      });
    } else {
      await this.tracker.adjustPoints(topicId, adjustment.points, {
        actorUuid: actor.uuid ?? actorUuid,
        actorName: actor.name,
        reason: adjustment.reason,
        roll: roll.toJSON ? roll.toJSON() : roll,
      });
    }
    this.render();
  }

  /** @private */
  async _onSendReveal(event, resend) {
    event.preventDefault();
    const button = event.currentTarget;
    const topicId = button.closest("[data-topic-id]")?.dataset.topicId;
    const thresholdId = button.dataset.thresholdId;
    if (!topicId || !thresholdId) return;

    await this.tracker.sendThresholdReveal(topicId, thresholdId, { resend });
    this.render();
  }

  /** @private */
  async _onRevealLocation(event, resend) {
    event.preventDefault();
    const button = event.currentTarget;
    const row = button.closest("[data-location-id]");
    const topicId = button.closest("[data-topic-id]")?.dataset.topicId;
    const locationId = row?.dataset.locationId ?? button.dataset.locationId;
    if (!topicId || !locationId) return;

    await this.tracker.sendLocationReveal(topicId, locationId, { resend });
    this.render();
  }

  /** @private */
  async _onImportTopics(event) {
    event.preventDefault();
    await ResearchImportExport.promptImport(this.tracker);
    this.render();
  }

  /** @private */
  async _onExportTopics(event) {
    event.preventDefault();
    await ResearchImportExport.exportTopics(this.tracker);
  }

  /**
   * Retrieve the actors that should be considered part of the party.
   * @returns {Actor[]}
   */
  _getPartyActors() {
    const party = game?.actors?.party;
    if (party?.members?.length) {
      return party.members;
    }
    const actors = game?.actors?.contents ?? [];
    return actors.filter((actor) => actor.type === "character" && actor.hasPlayerOwner);
  }

  _normalizeLocationChecks(location) {
    const entries = Array.isArray(location?.checks) ? location.checks : [];
    return entries
      .map((check, index) => {
        const skill = typeof check?.skill === "string" ? check.skill.trim() : "";
        const dcValue = Number(check?.dc);
        const dc = Number.isFinite(dcValue) && dcValue > 0 ? Number(dcValue) : null;
        return {
          index,
          skill,
          dc,
        };
      })
      .filter((entry) => entry.skill || entry.dc !== null);
  }

  _setupCheckEditor(container, addButton, initialChecks = []) {
    if (!container) return;
    const skillLabel = game.i18n.localize("PF2E.PointsTracker.Research.LocationSkill");
    const dcLabel = game.i18n.localize("PF2E.PointsTracker.Research.LocationDC");

    container.innerHTML = "";

    const pf2eSkills =
      game?.system?.id === "pf2e" && CONFIG?.PF2E?.skills
        ? CONFIG.PF2E.skills
        : null;

    const createInput = (type, value) => {
      const input = document.createElement("input");
      input.type = type;
      if (type === "number") {
        input.min = "0";
        input.step = "1";
      }
      if (value !== undefined && value !== null && value !== "") {
        input.value = String(value);
      }
      return input;
    };

    const addRow = (values = {}) => {
      const row = document.createElement("div");
      row.classList.add("research-location-check-editor__row");
      row.dataset.checkEntry = "true";

      let skillInput;
      if (pf2eSkills) {
        skillInput = document.createElement("select");
        skillInput.dataset.checkField = "skill";
        const emptyOption = document.createElement("option");
        emptyOption.value = "";
        emptyOption.textContent = skillLabel;
        skillInput.appendChild(emptyOption);
        const getSkillLabel = (skillKey, skillData) => {
          let label = "";
          if (skillData && typeof skillData === "object") {
            if (typeof skillData.label === "string" && skillData.label.trim()) {
              label = skillData.label.trim();
            } else if (typeof skillData.value === "string" && skillData.value.trim()) {
              label = skillData.value.trim();
            }
          } else if (typeof skillData === "string" && skillData.trim()) {
            label = skillData.trim();
          }

          if (!label) {
            label = skillKey;
          }

          const i18n = game?.i18n;
          if (i18n && typeof label === "string" && label.trim()) {
            try {
              if (typeof i18n.has === "function" && i18n.has(label)) {
                return i18n.localize(label);
              }
            } catch (error) {
              console.error(error);
            }
          }

          return label;
        };

        for (const [skillKey, skillName] of Object.entries(pf2eSkills)) {
          const option = document.createElement("option");
          option.value = skillKey;
          option.textContent = getSkillLabel(skillKey, skillName);
          skillInput.appendChild(option);
        }
        const selectedValue = values?.skill ?? "";
        if (selectedValue) {
          skillInput.value = selectedValue;
          if (skillInput.value !== selectedValue) {
            const customOption = document.createElement("option");
            customOption.value = selectedValue;
            customOption.textContent = selectedValue;
            skillInput.appendChild(customOption);
            skillInput.value = selectedValue;
          }
        }
      } else {
        skillInput = createInput("text", values?.skill ?? "");
        skillInput.dataset.checkField = "skill";
        skillInput.placeholder = skillLabel;
      }

      const dcValue = values?.dc ?? "";
      const dcInput = createInput("number", dcValue ?? "");
      dcInput.dataset.checkField = "dc";
      dcInput.placeholder = dcLabel;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.classList.add("icon");
      removeButton.dataset.removeCheck = "true";
      removeButton.setAttribute(
        "aria-label",
        game.i18n.localize("PF2E.PointsTracker.Research.RemoveCheck")
      );
      removeButton.innerHTML = '<i class="fas fa-times"></i>';
      removeButton.addEventListener("click", () => row.remove());

      row.appendChild(skillInput);
      row.appendChild(dcInput);
      row.appendChild(removeButton);
      container.appendChild(row);
    };

    if (addButton) {
      addButton.addEventListener("click", (event) => {
        event.preventDefault();
        addRow();
      });
    }

    const seeds = Array.isArray(initialChecks) && initialChecks.length
      ? initialChecks
      : [{}];
    seeds.forEach((entry) => addRow(entry));
  }

  /**
   * Ask the user how many points were gained or lost from a roll.
   * @param {number} rollTotal
   */
  async _promptForPoints(rollTotal, topic) {
    const hasLocations = Array.isArray(topic?.locations) && topic.locations.length > 0;
    const locationOptions = hasLocations
      ? topic.locations
          .map((location) => {
            const totalLabel = game.i18n.format(
              "PF2E.PointsTracker.Research.LocationOptionLabel",
              {
                name: location.name,
                collected: location.collected,
                max: location.maxPoints || game.i18n.localize(
                  "PF2E.PointsTracker.Research.LocationUnlimited"
                ),
              }
            );
            return `<option value="${location.id}">${totalLabel}</option>`;
          })
          .join("")
      : "";

    const template = `
      <form class="flexcol">
        <p>${game.i18n.format("PF2E.PointsTracker.Research.RollResult", { total: rollTotal ?? "--" })}</p>
        ${
          hasLocations
            ? `
                <div class="form-group">
                  <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationSelect")}</label>
                  <select name="locationId">${locationOptions}</select>
                </div>
              `
            : ""
        }
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.PointChange")}</label>
          <input type="number" name="points" value="0" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Reason")}</label>
          <input type="text" name="reason" value="" />
        </div>
      </form>
    `;

    return Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.ApplyPoints"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Apply"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const fd = new FormData(form);
        return {
          points: Number(fd.get("points")) || 0,
          reason: fd.get("reason")?.toString().trim() || undefined,
          locationId: fd.get("locationId")?.toString() || undefined,
        };
      },
      rejectClose: false,
    });
  }

  /**
   * Attempt to enrich text for HTML rendering.
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
    return text.replace(/\n/g, "<br />");
  }

  /**
   * Format the roll data into a short summary string.
   * @param {object} roll
   * @returns {string}
   */
  _formatRoll(roll) {
    if (!roll) return "";
    if (roll.total !== undefined) {
      return game.i18n.format("PF2E.PointsTracker.Research.RollSummary", { total: roll.total });
    }
    return "";
  }

  /**
   * Render a singleton instance of the tracker app.
   * @param {ResearchTracker} tracker
   */
  static open(tracker) {
    if (!this._instance) {
      this._instance = new ResearchTrackerApp(tracker);
    }
    this._instance.render(true, { focus: true });
    return this._instance;
  }
}
