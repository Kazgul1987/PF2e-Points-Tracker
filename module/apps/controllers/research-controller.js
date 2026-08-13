import { ResearchImportExport } from "../../research/importer.js";
import { logger } from "../../utils/logger.js";

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
      logger.error(error);
    }
  }
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_LOOKUP[char] ?? char);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ResearchTrackerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {ResearchTracker} tracker
   * @param {object} [options]
   */
  constructor(tracker, options = {}) {
    super(options);
    this.tracker = tracker;
    this._dragDropHandlers = [];
    this._expandedTopics = new Set();
  }

  static DEFAULT_OPTIONS = {
    id: "research-tracker-app",
    classes: ["pf2e-points-tracker"],
    position: { width: 720, height: "auto" },
    window: { resizable: true },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/module/templates/research-tracker.hbs` },
  };

  get title() {
    return game.i18n.localize("PF2E.PointsTracker.Research.Title");
  }

  /**
   * Provide template data.
   */
  async _prepareContext() {
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
      const rawThresholds = Array.isArray(topic.thresholds)
        ? topic.thresholds
        : [];
      const highestThresholdPoints = rawThresholds.reduce(
        (max, threshold) =>
          Math.max(max, Number.isFinite(threshold?.points) ? Number(threshold.points) : 0),
        0
      );
      const topicProgress = Number.isFinite(topic.progress) ? Number(topic.progress) : 0;
      const topicTarget = Number.isFinite(topic.target) ? Number(topic.target) : 0;
      const markerReference = topicTarget > 0
        ? topicTarget
        : Math.max(highestThresholdPoints, topicProgress);
      const thresholds = rawThresholds.map((threshold) => {
        const points = Number.isFinite(threshold?.points) ? Number(threshold.points) : 0;
        const isUnlocked = topicProgress >= points;
        const isRevealed = Array.isArray(topic.revealedThresholdIds)
          ? topic.revealedThresholdIds.includes(threshold.id)
          : Boolean(threshold.revealedAt);
        const markerPercentRaw = markerReference > 0 ? (points / markerReference) * 100 : 0;
        const markerPercent = markerReference > 0
          ? Math.max(
              0,
              Math.min(100, Math.round((markerPercentRaw + Number.EPSILON) * 100) / 100)
            )
          : 0;
        return {
          ...threshold,
          points,
          isUnlocked,
          isRevealed,
          markerPercent,
        };
      });

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
        const isComplete = maxPoints > 0 && collected >= maxPoints;
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
          isComplete,
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

      const sanitizedLocations = isGM
        ? visibleLocations
        : visibleLocations.map((location) => ({
            ...location,
            collected: null,
            maxPoints: null,
            displayMax: null,
          }));

      const levelNumber = Number(topic.level);
      const hasLevel =
        topic.level !== null && topic.level !== undefined && Number.isFinite(levelNumber);

      enrichedTopics.push({
        ...topic,
        level: hasLevel ? Number(levelNumber) : null,
        hasLevel,
        completed: topic.target > 0 && topic.progress >= topic.target,
        thresholds,
        locations: sanitizedLocations,
        hasHiddenLocations: normalizedLocations.some((location) => !location.isRevealed),
        isCollapsed: !this._expandedTopics.has(topic.id),
        locationTotals: {
          collected: isGM ? totalCollected : null,
          max: isGM ? totalMax : null,
          displayMax: isGM ? totalDisplayMax : null,
          hasUnlimited: hasUnlimitedLocation,
        },
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
  _onRender(context, options) {
    super._onRender(context, options);
    const html = globalThis.jQuery(this.element);

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
      .find("[data-action='select-topic-portrait']")
      .off("click")
      .on("click", (event) => this._onSelectTopicPortrait(event));
    html
      .find("[data-action='clear-topic-portrait']")
      .off("click")
      .on("click", (event) => this._onClearTopicPortrait(event));
    html
      .find("[data-action='reveal-location']")
      .off("click")
      .on("click", (event) => this._onRevealLocation(event, false));
    html
      .find("[data-action='resend-location']")
      .off("click")
      .on("click", (event) => this._onRevealLocation(event, true));

    this._bindTopicPortraitDropzones(html);
    this._setupAssignmentDragAndDrop(html);
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
    const wasRevealed = Boolean(location.isRevealed);
    const isRevealed = wasRevealed;
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
        <div class="form-group">
          <label class="checkbox">
            <input type="checkbox" name="isRevealed" ${isRevealed ? "checked" : ""} />
            ${game.i18n.localize("PF2E.PointsTracker.Research.LocationRevealVisible")}
          </label>
          <p class="notes">${game.i18n.localize("PF2E.PointsTracker.Research.LocationRevealVisibleHint")}</p>
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
        const revealCheckbox = form.querySelector("input[name='isRevealed']");
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
          isRevealed: Boolean(revealCheckbox?.checked),
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
    if (!wasRevealed && Boolean(response.isRevealed)) {
      await this.tracker.sendLocationReveal(topicId, locationId);
    }
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

    const normalizedAssignments = this._normalizeAssignedActors(location.assignedActors);
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

    const recipients = await this._getAssignedPlayerRecipients(normalizedAssignments);
    if (recipients.length) {
      payload.whisper = recipients;
    }

    await ChatMessage.create(payload);
  }

  _resetDragDropHandlers() {
    if (!Array.isArray(this._dragDropHandlers)) return;
    for (const handler of this._dragDropHandlers) {
      try {
        handler?.unbind?.();
      } catch (error) {
        logger.error(error);
      }
    }
    this._dragDropHandlers = [];
  }

  _bindTopicPortraitDropzones(html) {
    const root = html?.[0] ?? html;
    if (!root || !game.user?.isGM) return;
    const zones = root.querySelectorAll?.("[data-topic-portrait]");
    if (!zones?.length) return;

    zones.forEach((zone) => {
      if (!(zone instanceof HTMLElement)) return;
      const isInteractive = zone.dataset.dropzone === "topic-portrait";
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
          this._onDropTopicPortrait(event);
        });
        zone.addEventListener("keydown", (event) => {
          if (event.defaultPrevented) return;
          const key = event.key;
          if (key !== "Enter" && key !== " ") return;
          event.preventDefault();
          this._onSelectTopicPortrait(event);
        });
      }
    });
  }



  async _onDropTopicPortrait(event) {
    event.preventDefault();

    if (!game.user?.isGM) return;

    const zone = event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : event.target instanceof HTMLElement
      ? event.target.closest?.("[data-topic-portrait]")
      : null;
    if (!zone) return;

    const topicId = zone.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

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

    const portrait = await this._resolveTopicPortrait(dropPayload);
    if (!portrait || !portrait.img) return;

    await this._setTopicPortrait(topicId, portrait);
  }



  async _resolvePortrait(payload) {
    const trim = (value) => (typeof value === "string" ? value.trim() : "");

    if (!payload) return null;
    if (typeof payload === "string") {
      const trimmed = trim(payload);
      if (!trimmed) return null;
      return { img: trimmed, imageUuid: "" };
    }

    const images = [];
    const uuids = [];
    const seen = new WeakSet();

    const pushImage = (value, { priority = false } = {}) => {
      const trimmed = trim(value);
      if (!trimmed) return;
      if (images.includes(trimmed)) return;
      if (priority) images.unshift(trimmed);
      else images.push(trimmed);
    };

    const pushUuid = (value) => {
      const trimmed = trim(value);
      if (!trimmed) return;
      if (uuids.includes(trimmed)) return;
      uuids.push(trimmed);
    };

    const collect = (source, { priority = false } = {}) => {
      if (!source || typeof source !== "object") return;
      if (seen.has(source)) return;
      seen.add(source);

      const imageKeys = ["img", "image", "imgPath", "path", "icon", "portrait", "thumbnail", "imgSrc"];
      for (const key of imageKeys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          pushImage(source[key], { priority });
        }
      }

      const textures = [source.texture, source.imgTexture, source.imageTexture];
      for (const texture of textures) {
        if (!texture) continue;
        if (typeof texture === "string") {
          pushImage(texture, { priority });
        } else if (typeof texture === "object") {
          pushImage(texture.src, { priority });
        }
      }

      if (Array.isArray(source.images)) {
        for (const entry of source.images) {
          pushImage(entry, { priority });
        }
      }

      const uuidKeys = [
        "uuid",
        "actorUuid",
        "tokenUuid",
        "itemUuid",
        "imageUuid",
        "documentUuid",
        "actorId",
        "tokenId",
        "itemId",
        "id",
      ];
      for (const key of uuidKeys) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          pushUuid(source[key]);
        }
      }

      if (typeof source.collection === "string" && typeof source.id === "string") {
        pushUuid(`${source.collection}.${source.id}`);
      }
      if (typeof source.collection === "string" && typeof source.documentId === "string") {
        pushUuid(`${source.collection}.${source.documentId}`);
      }
      if (typeof source.pack === "string" && typeof source.id === "string") {
        pushUuid(`${source.pack}.${source.collection ?? source.type ?? ""}.${source.id}`);
      }

      const coreSourceId = source?.flags?.core?.sourceId ?? source?.flags?.core?.sourceID;
      pushUuid(coreSourceId);

      if (source.data && typeof source.data === "object" && source.data !== source) {
        collect(source.data, { priority });
      }
      if (source.actor && typeof source.actor === "object") {
        collect(source.actor, { priority });
      }
      if (source.prototypeToken && typeof source.prototypeToken === "object") {
        collect(source.prototypeToken, { priority });
      }
      if (source.token && typeof source.token === "object") {
        collect(source.token, { priority });
      }
    };

    collect(payload);
    if (payload.document && typeof payload.document === "object") {
      collect(payload.document, { priority: true });
    }

    let resolvedUuid = "";
    let document = null;
    const fromUuidFunc = typeof fromUuid === "function" ? fromUuid : null;
    if (fromUuidFunc) {
      for (const candidate of uuids) {
        try {
          const fetched = await fromUuidFunc(candidate);
          if (fetched) {
            document = fetched;
            resolvedUuid = fetched.uuid ?? candidate;
            break;
          }
        } catch (error) {
          logger.error(error);
        }
      }
    }

    const tryLocalCollection = (candidate) => {
      const trimmed = trim(candidate);
      if (!trimmed) return null;
      if (trimmed.startsWith("Actor.")) {
        const id = trimmed.split(".")[1] ?? trimmed;
        const actor = game.actors?.get?.(id);
        if (actor) return actor;
      }
      if (trimmed.startsWith("Item.")) {
        const id = trimmed.split(".")[1] ?? trimmed;
        const item = game.items?.get?.(id);
        if (item) return item;
      }
      const collectionId = trimmed.split(".")[0];
      const documentId = trimmed.substring(collectionId.length + 1);
      const collection = game.collections?.get?.(collectionId);
      if (collection?.get && documentId) {
        try {
          return collection.get(documentId);
        } catch (error) {
          logger.error(error);
        }
      }
      return null;
    };

    if (!document) {
      for (const candidate of uuids) {
        const local = tryLocalCollection(candidate);
        if (local) {
          document = local;
          resolvedUuid = local.uuid ?? candidate;
          break;
        }
      }
    }

    if (document) {
      collect(document, { priority: true });
      const texture = document.texture ?? document.imgTexture ?? document.prototypeToken?.texture;
      if (texture) collect(texture, { priority: true });
      if (document.actor) collect(document.actor, { priority: true });
    }

    const img = images.find((entry) => entry);
    if (!img) return null;

    const imageUuid = resolvedUuid || uuids.find((entry) => entry && entry.includes(".")) || "";
    return { img, imageUuid };
  }

  async _resolveTopicPortrait(payload) {
    return this._resolvePortrait(payload);
  }

  async _onSelectTopicPortrait(event) {
    event.preventDefault();

    if (!game.user?.isGM) return;

    const element = event.currentTarget instanceof HTMLElement
      ? event.currentTarget
      : event.target instanceof HTMLElement
      ? event.target.closest?.("[data-topic-portrait]")
      : null;
    if (!element) return;

    const topicId = element.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

    const topic = this.tracker.getTopic(topicId);
    const current = topic?.img ?? "";

    if (typeof FilePicker?.pick === "function") {
      try {
        const result = await FilePicker.pick({ type: "image", current: current || undefined });
        const path = typeof result === "string" ? result : typeof result?.path === "string" ? result.path : "";
        if (path) {
          await this._setTopicPortrait(topicId, { img: path, imageUuid: "" });
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
          await this._setTopicPortrait(topicId, { img: path, imageUuid: "" });
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

  async _onClearTopicPortrait(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!game.user?.isGM) return;

    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!button) return;

    const topicId = button.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

    await this._setTopicPortrait(topicId, null);
  }

  async _setTopicPortrait(topicId, portrait) {
    if (!topicId) return;

    const topic = this.tracker.getTopic(topicId);
    if (!topic) return;

    const img = typeof portrait?.img === "string" ? portrait.img.trim() : "";
    const imageUuid = typeof portrait?.imageUuid === "string" ? portrait.imageUuid.trim() : "";

    if ((topic.img ?? "") === img && (topic.imageUuid ?? "") === imageUuid) return;

    const update = {
      img,
      imageUuid,
    };

    await this.tracker.updateTopic(topicId, update);
    this.render();
  }







  _setupAssignmentDragAndDrop(html) {
    const root = html?.[0];
    if (!root || typeof DragDrop === "undefined") return;

    this._resetDragDropHandlers();

    const participants = root.querySelectorAll("[data-draggable='participant']");
    participants.forEach((element) => {
      element.addEventListener("dragend", () => {
        element.classList.remove("is-dragging");
      });
    });

    const configs = [
      { containerSelector: ".research-topic", dropSelector: "[data-dropzone='location']" },
      { containerSelector: ".influence-npc", dropSelector: "[data-dropzone='influence-assignment']" },
    ];
    if (this.chaseTracker) {
      configs.push({
        containerSelector: ".chase-event",
        dropSelector: "[data-dropzone='chase-assignment']",
      });
    }

    for (const config of configs) {
      const containers = root.querySelectorAll(config.containerSelector);
      containers.forEach((container) => {
        const dropZones = container.querySelectorAll(config.dropSelector);
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
          dropSelector: config.dropSelector,
          permissions: { dragstart: () => true, drop: () => true },
          callbacks: {
            dragstart: (event) => this._onDragParticipant(event),
            drop: (event, data) => this._onDropParticipant(event, data),
          },
        });
        dragDrop.bind(container);
        this._dragDropHandlers.push(dragDrop);
      });
    }
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

  _mapAssignedActors(assignments = [], actorLookup = new Map()) {
    const normalized = this._normalizeAssignedActors(assignments);
    return normalized.map((assigned) => {
      const candidate = actorLookup.get(assigned.uuid) ?? actorLookup.get(String(assigned.uuid));
      const actor = candidate?.actor ?? candidate?.document ?? null;
      const token = candidate?.token ?? null;

      const trim = (value) => (typeof value === "string" ? value.trim() : "");
      const storedTokenUuid =
        trim(assigned.tokenUuid) || trim(assigned.tokenUUID) || trim(assigned.tokenId);
      const storedTokenImg =
        trim(assigned.tokenImg) || trim(assigned.tokenImage) || trim(assigned.imgToken);
      const storedActorImg =
        trim(assigned.actorImg) ||
        trim(assigned.actorImage) ||
        trim(assigned.imgActor) ||
        trim(assigned.actorTokenImg);
      const storedFinalImg = trim(assigned.img) || trim(assigned.image);

      const tokenTexture = token?.texture ?? token?.data?.texture ?? token;
      const tokenImg = (() => {
        if (!tokenTexture) return "";
        if (typeof tokenTexture === "string") return trim(tokenTexture);
        if (typeof tokenTexture?.src === "string") return trim(tokenTexture.src);
        if (typeof token?.img === "string") return trim(token.img);
        if (typeof token?.data?.img === "string") return trim(token.data.img);
        return "";
      })();

      const actorPrototypeImg = (() => {
        const proto = actor?.prototypeToken?.texture ?? actor?.prototypeToken;
        if (!proto) return "";
        if (typeof proto === "string") return trim(proto);
        if (typeof proto?.src === "string") return trim(proto.src);
        return "";
      })();

      const actorPortraitImg = trim(actor?.img) || trim(actor?.data?.img) || actorPrototypeImg;
      const finalImg = storedFinalImg || storedTokenImg || storedActorImg || tokenImg || actorPortraitImg;

      const name =
        trim(assigned.name) || trim(candidate?.name) || trim(actor?.name) || assigned.uuid;

      const result = {
        ...assigned,
        uuid: assigned.uuid,
        name,
        img: finalImg,
        isActive: Boolean(actor || token),
      };

      if (!result.tokenUuid && storedTokenUuid) {
        result.tokenUuid = storedTokenUuid;
      }

      return result;
    });
  }

  async _getAssignedPlayerRecipients(assignments = []) {
    const sourceAssignments = Array.isArray(assignments) ? assignments : [];
    const normalized = sourceAssignments.every(
      (entry) => entry && typeof entry.uuid === "string" && entry.uuid
    )
      ? sourceAssignments.filter((entry) => entry && entry.uuid)
      : this._normalizeAssignedActors(sourceAssignments);
    if (!normalized.length) return [];

    const users = Array.isArray(game.users) ? game.users : [];
    if (!users.length) return [];

    const constSource = typeof CONST !== "undefined" ? CONST : foundry?.CONST ?? {};
    const permissionLevels =
      constSource?.DOCUMENT_PERMISSION_LEVELS ?? constSource?.DOCUMENT_OWNERSHIP_LEVELS ?? {};
    const ownerLevel =
      (typeof permissionLevels?.OWNER === "number"
        ? permissionLevels.OWNER
        : typeof permissionLevels?.OWNER === "string"
        ? Number.parseInt(permissionLevels.OWNER, 10)
        : null) ?? 3;

    const parseOwnershipValue = (value) => {
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const upper = value.toUpperCase();
        if (upper === "OWNER") return ownerLevel;
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    };

    const recipients = new Set();
    const actorCache = new Map();

    const addRecipientsFromActor = (actor) => {
      if (!actor) return;
      for (const user of users) {
        if (!user || user.isGM) continue;

        let hasOwnership = false;
        if (typeof actor.testUserPermission === "function") {
          try {
            hasOwnership = actor.testUserPermission(user, ownerLevel);
          } catch (error) {
            logger.warn(error);
          }
        }

        if (!hasOwnership) {
          const ownership = actor.ownership ?? actor.data?.ownership ?? {};
          const direct = parseOwnershipValue(ownership[user.id]);
          const fallbackDefault = parseOwnershipValue(ownership.default ?? ownership?.DEFAULT);
          const effectiveLevel = direct ?? fallbackDefault;
          if (effectiveLevel !== null && effectiveLevel >= ownerLevel) {
            hasOwnership = true;
          }
        }

        if (hasOwnership) {
          recipients.add(user.id);
        }
      }
    };

    const fetchActor = async (identifier) => {
      const trimmed = typeof identifier === "string" ? identifier.trim() : "";
      if (!trimmed) return null;
      if (actorCache.has(trimmed)) return actorCache.get(trimmed);

      let actorDocument = null;

      const tryStore = (actor) => {
        const value = actor ?? null;
        actorCache.set(trimmed, value);
        if (actor) {
          if (actor.uuid) actorCache.set(actor.uuid, actor);
          if (actor.id) actorCache.set(actor.id, actor);
        }
        return value;
      };

      if (typeof fromUuid === "function" && trimmed.includes(".")) {
        try {
          const document = await fromUuid(trimmed);
          if (document) {
            if (document.documentName === "Actor" || document.constructor?.name?.includes("Actor")) {
              return tryStore(document);
            }
            if (document.actor) {
              return tryStore(document.actor);
            }
          }
        } catch (error) {
          logger.warn(error);
        }
      }

      if (!actorDocument && typeof game?.actors?.get === "function") {
        const fallbackId = trimmed.startsWith("Actor.") ? trimmed.split(".").pop() : trimmed;
        actorDocument = game.actors.get(fallbackId);
        if (actorDocument) {
          return tryStore(actorDocument);
        }
      }

      return tryStore(null);
    };

    for (const assignment of normalized) {
      const candidateIds = [];
      if (typeof assignment?.tokenUuid === "string") candidateIds.push(assignment.tokenUuid);
      if (typeof assignment?.uuid === "string") candidateIds.push(assignment.uuid);
      if (typeof assignment?.actorUuid === "string") candidateIds.push(assignment.actorUuid);
      if (!candidateIds.length) continue;

      for (const candidate of candidateIds) {
        const actor = await fetchActor(candidate);
        if (actor) {
          addRecipientsFromActor(actor);
          break;
        }
      }
    }

    return Array.from(recipients);
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
    const chaseEventId = element.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    const tokenUuid = element.dataset.tokenUuid?.trim();
    const tokenImg = element.dataset.tokenImg?.trim();
    return {
      type: "pf2e-research-participant",
      actorUuid,
      actorName,
      topicId,
      chaseEventId,
      tokenUuid,
      tokenImg,
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
            logger.error(error);
          }
        }
      }
    }

    const dropZone = event?.currentTarget;
    if (!dropZone) return;

    const topicId = dropZone.closest("[data-topic-id]")?.dataset.topicId;
    const locationId = dropZone.closest("[data-location-id]")?.dataset.locationId;
    const chaseEventId = dropZone.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    const obstacleId = dropZone.closest("[data-obstacle-id]")?.dataset.obstacleId;
    const opportunityId = dropZone.closest("[data-opportunity-id]")?.dataset.opportunityId;
    const npcId = dropZone.closest("[data-npc-id]")?.dataset.npcId;

    const hasResearchContext = Boolean(topicId && locationId);
    const hasChaseContext = Boolean(chaseEventId && (obstacleId || opportunityId));
    const hasInfluenceContext = Boolean(npcId && dropZone.dataset.dropzone === "influence-assignment");
    if (!hasResearchContext && !hasChaseContext && !hasInfluenceContext) return;

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
        logger.warn(error);
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
        logger.warn(error);
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
        logger.warn(error);
      }
    }

    const tokenImg =
      getTextureSrc(tokenDocument?.texture) ||
      trimString(tokenDocument?.img ?? tokenDocument?.data?.img);
    const explicitTokenImg = trimString(data?.tokenImg);
    const actorPrototypeImg = getTextureSrc(actorDocument?.prototypeToken?.texture);
    const actorPortraitImg =
      trimString(actorDocument?.img ?? actorDocument?.data?.img) || actorPrototypeImg;
    const finalImg = explicitTokenImg || tokenImg || actorPrototypeImg || actorPortraitImg;

    const newAssignment = { uuid: actorUuid };
    if (actorName) newAssignment.name = actorName;
    if (tokenUuid) newAssignment.tokenUuid = tokenUuid;
    if (explicitTokenImg || tokenImg) newAssignment.tokenImg = explicitTokenImg || tokenImg;
    if (actorPrototypeImg) newAssignment.actorTokenImg = actorPrototypeImg;
    if (actorPortraitImg) newAssignment.actorImg = actorPortraitImg;
    if (finalImg) newAssignment.img = finalImg;

    if (hasResearchContext) {
      const topic = this.tracker.getTopic(topicId);
      const location = topic?.locations?.find((entry) => entry.id === locationId);
      if (!location) return;

      const normalized = this._normalizeAssignedActors(location.assignedActors);
      if (normalized.some((entry) => entry.uuid === actorUuid)) {
        return;
      }

      const newAssignments = [...normalized, newAssignment];

      await this.tracker.updateLocation(topicId, locationId, {
        assignedActors: newAssignments,
      });
      this.render();
      return;
    }

    if (hasInfluenceContext && this.influenceTracker) {
      const npc = this.influenceTracker.getNpc(npcId);
      if (!npc) return;

      const normalized = this._normalizeAssignedActors(npc.assignedActors);
      if (normalized.some((entry) => entry.uuid === actorUuid)) {
        return;
      }

      const newAssignments = [...normalized, newAssignment];
      await this.influenceTracker.updateNpc(npcId, { assignedActors: newAssignments });
      this.render();
      return;
    }

    if (hasChaseContext && this.chaseTracker) {
      const eventData = this.chaseTracker.getEvent(chaseEventId);
      if (!eventData) return;

      if (obstacleId) {
        const obstacle = eventData.obstacles?.find((entry) => entry.id === obstacleId);
        if (!obstacle) return;
        const normalized = this._normalizeAssignedActors(obstacle.assignedActors);
        if (normalized.some((entry) => entry.uuid === actorUuid)) {
          return;
        }
        const newAssignments = [...normalized, newAssignment];
        await this.chaseTracker.assignActorsToObstacle(
          chaseEventId,
          obstacleId,
          newAssignments
        );
        this.render();
        return;
      }

      if (opportunityId) {
        const opportunity = eventData.opportunities?.find(
          (entry) => entry.id === opportunityId
        );
        if (!opportunity) return;
        const normalized = this._normalizeAssignedActors(opportunity.assignedActors);
        if (normalized.some((entry) => entry.uuid === actorUuid)) {
          return;
        }
        const newAssignments = [...normalized, newAssignment];
        await this.chaseTracker.assignActorsToOpportunity(
          chaseEventId,
          opportunityId,
          newAssignments
        );
        this.render();
      }
    }
  }

  async _onRemoveAssignedActor(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const actorUuid = button?.dataset.actorUuid;
    const topicId = button?.closest("[data-topic-id]")?.dataset.topicId;
    const locationId = button?.closest("[data-location-id]")?.dataset.locationId;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    const obstacleId = button?.closest("[data-obstacle-id]")?.dataset.obstacleId;
    const opportunityId = button?.closest("[data-opportunity-id]")?.dataset.opportunityId;
    const npcId = button?.closest("[data-npc-id]")?.dataset.npcId;
    if (!actorUuid) return;

    if (topicId && locationId) {
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
      return;
    }

    if (npcId && this.influenceTracker) {
      const npc = this.influenceTracker.getNpc(npcId);
      if (!npc) return;

      const normalized = this._normalizeAssignedActors(npc.assignedActors);
      const filtered = normalized.filter((entry) => entry.uuid !== actorUuid);
      if (filtered.length === normalized.length) return;

      await this.influenceTracker.updateNpc(npcId, { assignedActors: filtered });
      this.render();
      return;
    }

    if (this.chaseTracker && chaseEventId && (obstacleId || opportunityId)) {
      const eventData = this.chaseTracker.getEvent(chaseEventId);
      if (!eventData) return;

      if (obstacleId) {
        const obstacle = eventData.obstacles?.find((entry) => entry.id === obstacleId);
        if (!obstacle) return;
        const normalized = this._normalizeAssignedActors(obstacle.assignedActors);
        const filtered = normalized.filter((entry) => entry.uuid !== actorUuid);
        if (filtered.length === normalized.length) return;
        await this.chaseTracker.assignActorsToObstacle(chaseEventId, obstacleId, filtered);
        this.render();
        return;
      }

      if (opportunityId) {
        const opportunity = eventData.opportunities?.find(
          (entry) => entry.id === opportunityId
        );
        if (!opportunity) return;
        const normalized = this._normalizeAssignedActors(opportunity.assignedActors);
        const filtered = normalized.filter((entry) => entry.uuid !== actorUuid);
        if (filtered.length === normalized.length) return;
        await this.chaseTracker.assignActorsToOpportunity(
          chaseEventId,
          opportunityId,
          filtered
        );
        this.render();
      }
    }
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
      logger.error(error);
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

  _getChaseActors() {
    const lookup = new Map();

    const partyActors = this._getPartyActors();
    const allowedActorIds = new Set();

    const ensureUuid = (actor) => {
      if (!actor) return "";
      if (typeof actor.uuid === "string" && actor.uuid) return actor.uuid;
      if (typeof actor.id === "string" && actor.id) return `Actor.${actor.id}`;
      if (typeof actor._id === "string" && actor._id) return `Actor.${actor._id}`;
      return "";
    };

    const registerAllowedActor = (actor) => {
      if (!actor) return;
      const uuid = ensureUuid(actor);
      if (uuid) allowedActorIds.add(uuid);
      const id = typeof actor.id === "string" && actor.id ? actor.id : null;
      if (id) allowedActorIds.add(id);
      const legacyId = typeof actor._id === "string" && actor._id ? actor._id : null;
      if (legacyId) allowedActorIds.add(legacyId);
      const actorUuid = typeof actor.uuid === "string" && actor.uuid ? actor.uuid : null;
      if (actorUuid) allowedActorIds.add(actorUuid);
    };

    for (const actor of partyActors) {
      registerAllowedActor(actor);
    }

    const getTokenData = (token) => {
      if (!token) return { tokenUuid: "", tokenImg: "" };
      const trim = (value) => (typeof value === "string" ? value.trim() : "");
      const tokenUuid = (() => {
        if (typeof token.uuid === "string" && token.uuid) return token.uuid;
        const sceneId =
          token?.scene?.id ?? token?.parent?.id ?? token?.data?.scene ?? token?.scene?._id;
        const tokenId = token?.id ?? token?._id;
        if (sceneId && tokenId) return `Scene.${sceneId}.Token.${tokenId}`;
        return "";
      })();
      const texture = token?.texture ?? token?.data?.texture ?? null;
      const tokenImg = (() => {
        if (!texture) {
          if (typeof token?.img === "string") return trim(token.img);
          if (typeof token?.data?.img === "string") return trim(token.data.img);
          return "";
        }
        if (typeof texture === "string") return trim(texture);
        if (typeof texture?.src === "string") return trim(texture.src);
        return "";
      })();
      return { tokenUuid: trim(tokenUuid), tokenImg };
    };

    const addActor = (actor, token = null) => {
      if (!actor) return;
      const uuid = ensureUuid(actor);
      if (!uuid) return;
      const existing = lookup.get(uuid) ?? {
        actor,
        uuid,
        name: actor.name ?? uuid,
        actorImg:
          (typeof actor.img === "string" && actor.img) ||
          (typeof actor.data?.img === "string" && actor.data.img) ||
          (typeof actor.prototypeToken?.texture?.src === "string"
            ? actor.prototypeToken.texture.src
            : ""),
        tokens: [],
      };

      if (!lookup.has(uuid)) {
        lookup.set(uuid, existing);
      }

      if (token) {
        existing.tokens.push(token);
      }
    };

    for (const actor of partyActors) {
      addActor(actor);
    }

    const isActorAllowed = (actor) => {
      if (!actor) return false;
      const uuid = ensureUuid(actor);
      if (uuid && allowedActorIds.has(uuid)) return true;
      if (typeof actor.uuid === "string" && allowedActorIds.has(actor.uuid)) return true;
      if (typeof actor.id === "string" && allowedActorIds.has(actor.id)) return true;
      if (typeof actor._id === "string" && allowedActorIds.has(actor._id)) return true;
      return false;
    };

    const collectFromScene = (scene) => {
      if (!scene) return;
      const tokens = Array.isArray(scene.tokens)
        ? scene.tokens
        : scene.tokens?.contents ?? [];
      for (const token of tokens) {
        const actor = token?.actor ?? (typeof token.getActor === "function" ? token.getActor() : null);
        if (!isActorAllowed(actor)) continue;
        addActor(actor, token);
      }
    };

    if (canvas?.scene) {
      collectFromScene(canvas.scene);
    }
    const activeScene = game?.scenes?.active;
    if (activeScene && activeScene !== canvas?.scene) {
      collectFromScene(activeScene);
    }

    const actors = [];
    for (const entry of lookup.values()) {
      const token = entry.tokens[0] ?? null;
      const tokenData = getTokenData(token);
      const img = tokenData.tokenImg || entry.actorImg || "";
      actors.push({
        ...entry,
        img,
        token: token ?? null,
        tokenUuid: tokenData.tokenUuid,
        tokenImg: tokenData.tokenImg,
      });
    }

    return actors;
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

    const skillDatalistId = (() => {
      const baseId = "research-location-skill-list";
      const randomId =
        typeof foundry?.utils?.randomID === "function"
          ? foundry.utils.randomID()
          : Math.random().toString(36).slice(2);
      return `${baseId}-${randomId}`;
    })();

    const skillDatalist = document.createElement("datalist");
    skillDatalist.id = skillDatalistId;

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
          logger.error(error);
        }
      }

      return label;
    };

    if (pf2eSkills) {
      for (const [skillKey, skillName] of Object.entries(pf2eSkills)) {
        const option = document.createElement("option");
        option.value = skillKey;
        const label = getSkillLabel(skillKey, skillName);
        if (label !== skillKey) {
          option.label = label;
          option.textContent = label;
        }
        skillDatalist.appendChild(option);
      }
    }

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

      if (!skillDatalist.isConnected) {
        container.appendChild(skillDatalist);
      }

      const skillInput = createInput("text", values?.skill ?? "");
      skillInput.dataset.checkField = "skill";
      skillInput.placeholder = skillLabel;
      skillInput.setAttribute("list", skillDatalistId);

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
        logger.error(error);
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
      this._instance = new this(tracker);
    }
    this._instance.render({ force: true });
    return this._instance;
  }
}

