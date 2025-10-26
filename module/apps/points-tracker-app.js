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

class BaseResearchTrackerApp extends FormApplication {
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
        console.error(error);
      }
    }
    this._dragDropHandlers = [];
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
            console.warn(error);
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
          console.warn(error);
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
            console.error(error);
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

    const hasResearchContext = Boolean(topicId && locationId);
    const hasChaseContext = Boolean(chaseEventId && (obstacleId || opportunityId));
    if (!hasResearchContext && !hasChaseContext) return;

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

  _getChaseActors() {
    const lookup = new Map();

    const ensureUuid = (actor) => {
      if (!actor) return "";
      if (typeof actor.uuid === "string" && actor.uuid) return actor.uuid;
      if (typeof actor.id === "string" && actor.id) return `Actor.${actor.id}`;
      if (typeof actor._id === "string" && actor._id) return `Actor.${actor._id}`;
      return "";
    };

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

    for (const actor of this._getPartyActors()) {
      addActor(actor);
    }

    const collectFromScene = (scene) => {
      if (!scene) return;
      const tokens = Array.isArray(scene.tokens)
        ? scene.tokens
        : scene.tokens?.contents ?? [];
      for (const token of tokens) {
        const actor = token?.actor ?? (typeof token.getActor === "function" ? token.getActor() : null);
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
      this._instance = new this(tracker);
    }
    this._instance.render(true, { focus: true });
    return this._instance;
  }
}

const POINTS_TRACKER_PARTIALS = [
  `modules/${MODULE_ID}/module/templates/partials/research-tab.hbs`,
  `modules/${MODULE_ID}/module/templates/partials/reputation-tab.hbs`,
  `modules/${MODULE_ID}/module/templates/partials/awareness-tab.hbs`,
  `modules/${MODULE_ID}/module/templates/partials/chase-tab.hbs`,
  `modules/${MODULE_ID}/module/templates/partials/influence-tab.hbs`,
];

export class PointsTrackerApp extends BaseResearchTrackerApp {
  /**
   * @param {object} options
   * @param {import("../research/tracker.js").ResearchTracker} [options.researchTracker]
   * @param {import("../reputation/reputation-tracker.js").ReputationTracker} [options.reputationTracker]
   * @param {import("../awareness/awareness-tracker.js").AwarenessTracker} [options.awarenessTracker]
   * @param {import("../chase/tracker.js").ChaseTracker} [options.chaseTracker]
   * @param {object} [renderOptions]
   */
  constructor(
    {
      researchTracker = null,
      reputationTracker = null,
      awarenessTracker = null,
      chaseTracker = null,
      influenceTracker = null,
    } = {},
    renderOptions = {}
  ) {
    super(researchTracker, renderOptions);
    this.researchTracker = researchTracker ?? null;
    this.reputationTracker = reputationTracker ?? null;
    this.awarenessTracker = awarenessTracker ?? null;
    this.chaseTracker = chaseTracker ?? null;
    this.influenceTracker = influenceTracker ?? null;
    this.tracker = this.researchTracker ?? this.tracker ?? null;
    this._activeTab = renderOptions?.activeTab ?? "research";
    this.options.activeTab = this._activeTab;
    this._initializedTabs = new Set();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "points-tracker-app",
      template: `modules/${MODULE_ID}/module/templates/points-tracker.hbs`,
      title: game.i18n.localize("PF2E.PointsTracker.PointsTrackerTitle"),
    });
  }

  static async preloadTemplates() {
    if (typeof loadTemplates !== "function") return;
    if (!this._preloadPromise) {
      this._preloadPromise = loadTemplates(POINTS_TRACKER_PARTIALS);
    }
    await this._preloadPromise;
  }

  static open({
    researchTracker = null,
    reputationTracker = null,
    awarenessTracker = null,
    chaseTracker = null,
    influenceTracker = null,
    activeTab = null,
  } = {}) {
    if (!this._instance) {
      this._instance = new this(
        { researchTracker, reputationTracker, awarenessTracker, chaseTracker, influenceTracker },
        { activeTab: activeTab ?? "research" }
      );
    } else {
      if (researchTracker) {
        this._instance.researchTracker = researchTracker;
        this._instance.tracker = researchTracker;
      }
      if (reputationTracker) {
        this._instance.reputationTracker = reputationTracker;
      }
      if (awarenessTracker) {
        this._instance.awarenessTracker = awarenessTracker;
      }
      if (chaseTracker) {
        this._instance.chaseTracker = chaseTracker;
      }
      if (influenceTracker) {
        this._instance.influenceTracker = influenceTracker;
      }
      if (activeTab) {
        this._instance.activeTab = activeTab;
      }
    }
    this._instance.render(true, { focus: true });
    return this._instance;
  }

  get activeTab() {
    const candidate = this._activeTab ?? "research";
    if (candidate === "awareness" && !this._canAccessAwareness()) {
      return "research";
    }
    if (candidate === "influence" && !this.influenceTracker) {
      return "research";
    }
    return candidate;
  }

  set activeTab(value) {
    const allowedTabs = new Set(["research", "reputation", "chase"]);
    if (this._canAccessAwareness()) {
      allowedTabs.add("awareness");
    }
    if (this.influenceTracker) {
      allowedTabs.add("influence");
    }
    const normalized = allowedTabs.has(value) ? value : "research";
    this._activeTab = normalized;
    this.options.activeTab = this._activeTab;
  }

  _canAccessAwareness() {
    const isGM = game.user?.isGM ?? false;
    return Boolean(isGM && this.awarenessTracker);
  }

  async getData(options) {
    const isGM = game.user?.isGM ?? false;

    let researchData = {
      isGM,
      topics: [],
      log: [],
      hasTracker: Boolean(this.researchTracker),
    };
    if (this.researchTracker) {
      researchData = await BaseResearchTrackerApp.prototype.getData.call(this, options);
      researchData.hasTracker = true;
    }

    const reputationData = this._prepareReputationData({ isGM });
    const awarenessData = this._prepareAwarenessData({ isGM });
    const chaseData = this._prepareChaseData({ isGM });
    const influenceData = await this._prepareInfluenceData({ isGM });

    const activeTab = this.activeTab;
    return {
      activeTab,
      isResearchActive: activeTab === "research",
      isReputationActive: activeTab === "reputation",
      isAwarenessActive: activeTab === "awareness",
      isChaseActive: activeTab === "chase",
      isInfluenceActive: activeTab === "influence",
      isGM,
      research: researchData,
      reputation: reputationData,
      awareness: awarenessData,
      chase: chaseData,
      influence: influenceData,
    };
  }

  activateListeners(html) {
    if (this.researchTracker) {
      super.activateListeners(html);
    } else {
      FormApplication.prototype.activateListeners.call(this, html);
    }

    this._bindTabNavigation(html);
    this._applyActiveTab(html);

    if (this.activeTab === "reputation") {
      this._initializeReputationTab(html);
    }
    if (this.activeTab === "awareness") {
      this._initializeAwarenessTab(html);
    }
    if (this.activeTab === "chase") {
      this._initializeChaseTab(html);
    }
    if (this.activeTab === "influence") {
      this._initializeInfluenceTab(html);
    }

    if (this.reputationTracker) {
      this._activateReputationListeners(html);
    }
    if (this._canAccessAwareness()) {
      this._activateAwarenessListeners(html);
    }
    if (this.chaseTracker) {
      this._activateChaseListeners(html);
    }
    if (this.influenceTracker) {
      this._activateInfluenceListeners(html);
    }
  }

  _bindTabNavigation(html) {
    html
      .find("[data-tab]")
      .off("click.pointsTracker")
      .on("click.pointsTracker", (event) => {
        event.preventDefault();
        const tab = event.currentTarget?.dataset.tab;
        if (tab === "awareness" && !this._canAccessAwareness()) return;
        if (tab === "influence" && !this.influenceTracker) return;
        if (!tab || tab === this.activeTab) return;
        this.activeTab = tab;
        this._applyActiveTab(html);
        if (tab === "reputation") {
          this._initializeReputationTab(html);
        }
        if (tab === "awareness") {
          this._initializeAwarenessTab(html);
        }
        if (tab === "chase") {
          this._initializeChaseTab(html);
        }
        if (tab === "influence") {
          this._initializeInfluenceTab(html);
        }
      });
  }

  _applyActiveTab(html) {
    const tab = this.activeTab;
    html.attr("data-active-tab", tab);
    html
      .find("[data-tab]")
      .each((_, element) => {
        element.classList.toggle("is-active", element.dataset.tab === tab);
      });
    html
      .find("[data-tab-panel]")
      .each((_, element) => {
        element.classList.toggle("is-active", element.dataset.tabPanel === tab);
      });
  }

  _generateId() {
    if (typeof foundry !== "undefined" && foundry?.utils?.randomID) {
      return foundry.utils.randomID();
    }
    if (typeof crypto !== "undefined" && crypto?.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2, 10);
  }

  _initializeReputationTab(html) {
    if (this._initializedTabs.has("reputation")) return;
    this._initializedTabs.add("reputation");
    html.find("[data-tab-panel='reputation']").attr("data-initialized", "true");
  }

  _initializeAwarenessTab(html) {
    if (this._initializedTabs.has("awareness")) return;
    this._initializedTabs.add("awareness");
    html.find("[data-tab-panel='awareness']").attr("data-initialized", "true");
  }

  _initializeChaseTab(html) {
    if (this._initializedTabs.has("chase")) return;
    this._initializedTabs.add("chase");
    html.find("[data-tab-panel='chase']").attr("data-initialized", "true");
  }

  _initializeInfluenceTab(html) {
    if (this._initializedTabs.has("influence")) return;
    this._initializedTabs.add("influence");
    html.find("[data-tab-panel='influence']").attr("data-initialized", "true");
  }

  _activateReputationListeners(html) {
    html
      .find("[data-action='create-faction']")
      .off("click")
      .on("click", (event) => this._onCreateFaction(event));
    html
      .find("[data-action='edit-faction']")
      .off("click")
      .on("click", (event) => this._onEditFaction(event));
    html
      .find("[data-action='delete-faction']")
      .off("click")
      .on("click", (event) => this._onDeleteFaction(event));
    html
      .find("[data-action='adjust-reputation']")
      .off("click")
      .on("click", (event) => this._onAdjustFaction(event));
  }

  _activateAwarenessListeners(html) {
    const panel = html.find("[data-tab-panel='awareness']");
    if (!panel.length) return;

    panel
      .find("[data-action='create-awareness-entry']")
      .off("click")
      .on("click", (event) => this._onCreateAwarenessEntry(event));
    panel
      .find("[data-action='adjust']")
      .off("click")
      .on("click", (event) => this._onAdjustAwarenessEntry(event));
    panel
      .find("[data-action='edit']")
      .off("click")
      .on("click", (event) => this._onEditAwarenessEntry(event));
    panel
      .find("[data-action='delete']")
      .off("click")
      .on("click", (event) => this._onDeleteAwarenessEntry(event));
  }

  _activateChaseListeners(html) {
    const panel = html.find("[data-tab-panel='chase']");
    if (!panel.length) return;

    panel
      .find("[data-action='create-chase-event']")
      .off("click")
      .on("click", (event) => this._onCreateChaseEvent(event));
    panel
      .find("[data-action='edit-chase-event']")
      .off("click")
      .on("click", (event) => this._onEditChaseEvent(event));
    panel
      .find("[data-action='delete-chase-event']")
      .off("click")
      .on("click", (event) => this._onDeleteChaseEvent(event));
    panel
      .find("[data-action='create-chase-obstacle']")
      .off("click")
      .on("click", (event) => this._onCreateChaseObstacle(event));
    panel
      .find("[data-action='edit-chase-obstacle']")
      .off("click")
      .on("click", (event) => this._onEditChaseObstacle(event));
    panel
      .find("[data-action='delete-chase-obstacle']")
      .off("click")
      .on("click", (event) => this._onDeleteChaseObstacle(event));
    panel
      .find("[data-action='nudge-chase-obstacle']")
      .off("click")
      .on("click", (event) => this._onNudgeChaseObstacle(event));
    panel
      .find("[data-action='set-chase-obstacle-progress']")
      .off("click")
      .on("click", (event) => this._onSetChaseObstacleProgress(event));
    panel
      .find("[data-action='create-chase-opportunity']")
      .off("click")
      .on("click", (event) => this._onCreateChaseOpportunity(event));
    panel
      .find("[data-action='edit-chase-opportunity']")
      .off("click")
      .on("click", (event) => this._onEditChaseOpportunity(event));
    panel
      .find("[data-action='delete-chase-opportunity']")
      .off("click")
      .on("click", (event) => this._onDeleteChaseOpportunity(event));
  }

  async _onCreateChaseEvent(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const data = await this._promptChaseEventDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.CreateEvent"),
      label: game.i18n.localize("PF2E.PointsTracker.Chase.Create"),
    });
    if (!data) return;
    await this.chaseTracker.createEvent(data);
    this.render();
  }

  async _onEditChaseEvent(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    if (!chaseEventId) return;
    const eventData = this.chaseTracker.getEvent(chaseEventId);
    if (!eventData) return;
    const data = await this._promptChaseEventDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.EditEvent"),
      label: game.i18n.localize("PF2E.PointsTracker.Chase.Save"),
      initial: eventData,
    });
    if (!data) return;
    await this.chaseTracker.updateEvent(chaseEventId, data);
    this.render();
  }

  async _onDeleteChaseEvent(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    if (!chaseEventId) return;
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.DeleteEvent"),
      content: `<p>${game.i18n.localize("PF2E.PointsTracker.Chase.DeleteEventConfirm")}</p>`,
    });
    if (!confirmed) return;
    await this.chaseTracker.deleteEvent(chaseEventId);
    this.render();
  }

  async _onCreateChaseObstacle(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    if (!chaseEventId) return;
    const data = await this._promptChaseObstacleDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.CreateObstacle"),
      label: game.i18n.localize("PF2E.PointsTracker.Chase.Create"),
    });
    if (!data) return;
    await this.chaseTracker.createObstacle(chaseEventId, data);
    this.render();
  }

  async _onEditChaseObstacle(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    const obstacleId = button?.closest("[data-obstacle-id]")?.dataset.obstacleId;
    if (!chaseEventId || !obstacleId) return;
    const eventData = this.chaseTracker.getEvent(chaseEventId);
    const obstacle = eventData?.obstacles?.find((entry) => entry.id === obstacleId);
    if (!obstacle) return;
    const data = await this._promptChaseObstacleDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.EditObstacle"),
      label: game.i18n.localize("PF2E.PointsTracker.Chase.Save"),
      initial: obstacle,
    });
    if (!data) return;
    await this.chaseTracker.updateObstacle(chaseEventId, obstacleId, data);
    this.render();
  }

  async _onDeleteChaseObstacle(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    const obstacleId = button?.closest("[data-obstacle-id]")?.dataset.obstacleId;
    if (!chaseEventId || !obstacleId) return;
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.DeleteObstacle"),
      content: `<p>${game.i18n.localize("PF2E.PointsTracker.Chase.DeleteObstacleConfirm")}</p>`,
    });
    if (!confirmed) return;
    await this.chaseTracker.deleteObstacle(chaseEventId, obstacleId);
    this.render();
  }

  async _onNudgeChaseObstacle(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    const obstacleId = button?.closest("[data-obstacle-id]")?.dataset.obstacleId;
    const delta = Number(button?.dataset.delta ?? 0);
    if (!chaseEventId || !obstacleId || !Number.isFinite(delta) || delta === 0) return;
    await this.chaseTracker.adjustObstacleProgress(chaseEventId, obstacleId, delta);
    this.render();
  }

  async _onSetChaseObstacleProgress(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    const obstacleId = button?.closest("[data-obstacle-id]")?.dataset.obstacleId;
    if (!chaseEventId || !obstacleId) return;
    const eventData = this.chaseTracker.getEvent(chaseEventId);
    const obstacle = eventData?.obstacles?.find((entry) => entry.id === obstacleId);
    if (!obstacle) return;
    const data = await this._promptSetChaseObstacleProgress({ initial: obstacle });
    if (data === null) return;
    await this.chaseTracker.setObstacleProgress(chaseEventId, obstacleId, data);
    this.render();
  }

  async _onCreateChaseOpportunity(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    if (!chaseEventId) return;
    const data = await this._promptChaseOpportunityDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.CreateOpportunity"),
      label: game.i18n.localize("PF2E.PointsTracker.Chase.Create"),
    });
    if (!data) return;
    await this.chaseTracker.createOpportunity(chaseEventId, data);
    this.render();
  }

  async _onEditChaseOpportunity(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    const opportunityId = button?.closest("[data-opportunity-id]")?.dataset.opportunityId;
    if (!chaseEventId || !opportunityId) return;
    const eventData = this.chaseTracker.getEvent(chaseEventId);
    const opportunity = eventData?.opportunities?.find((entry) => entry.id === opportunityId);
    if (!opportunity) return;
    const data = await this._promptChaseOpportunityDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.EditOpportunity"),
      label: game.i18n.localize("PF2E.PointsTracker.Chase.Save"),
      initial: opportunity,
    });
    if (!data) return;
    await this.chaseTracker.updateOpportunity(chaseEventId, opportunityId, data);
    this.render();
  }

  async _onDeleteChaseOpportunity(event) {
    event.preventDefault();
    if (!this.chaseTracker) return;
    const button = event.currentTarget;
    const chaseEventId = button?.closest("[data-chase-event-id]")?.dataset.chaseEventId;
    const opportunityId = button?.closest("[data-opportunity-id]")?.dataset.opportunityId;
    if (!chaseEventId || !opportunityId) return;
    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.DeleteOpportunity"),
      content: `<p>${game.i18n.localize("PF2E.PointsTracker.Chase.DeleteOpportunityConfirm")}</p>`,
    });
    if (!confirmed) return;
    await this.chaseTracker.deleteOpportunity(chaseEventId, opportunityId);
    this.render();
  }

  async _promptChaseEventDialog({ title, label, initial = {} }) {
    const name = typeof initial?.name === "string" ? initial.name : "";
    const description = typeof initial?.description === "string" ? initial.description : "";
    const template = `
      <form>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Chase.EventName")}</label>
          <input type="text" name="name" value="${escapeAttribute(name)}" required />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Chase.EventDescription")}</label>
          <textarea name="description" rows="4">${escapeHtml(description)}</textarea>
        </div>
      </form>
    `;
    const result = await Dialog.prompt({
      title,
      content: template,
      label,
      callback: (html) => {
        const form = html[0].querySelector("form");
        const formData = new FormData(form);
        const nameValue = formData.get("name")?.toString().trim();
        const descriptionValue = formData.get("description")?.toString().trim();
        return {
          name: nameValue ?? "",
          description: descriptionValue ?? "",
        };
      },
      rejectClose: false,
    });
    if (!result) return null;
    return result;
  }

  async _promptChaseObstacleDialog({ title, label, initial = {} }) {
    const name = typeof initial?.name === "string" ? initial.name : "";
    const description = typeof initial?.description === "string" ? initial.description : "";
    const requiredPoints = Number.isFinite(initial?.requiredPoints) ? initial.requiredPoints : 0;
    const template = `
      <form>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Chase.ObstacleName")}</label>
          <input type="text" name="name" value="${escapeAttribute(name)}" required />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Chase.ObstacleRequiredPoints")}</label>
          <input type="number" name="requiredPoints" min="0" step="1" value="${Number(requiredPoints) || 0}" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Chase.ObstacleDescription")}</label>
          <textarea name="description" rows="4">${escapeHtml(description)}</textarea>
        </div>
      </form>
    `;
    const result = await Dialog.prompt({
      title,
      content: template,
      label,
      callback: (html) => {
        const form = html[0].querySelector("form");
        const formData = new FormData(form);
        const nameValue = formData.get("name")?.toString().trim();
        const descriptionValue = formData.get("description")?.toString().trim();
        const requiredPointsValue = Number(formData.get("requiredPoints"));
        return {
          name: nameValue ?? "",
          description: descriptionValue ?? "",
          requiredPoints: Number.isFinite(requiredPointsValue) ? requiredPointsValue : 0,
        };
      },
      rejectClose: false,
    });
    if (!result) return null;
    return result;
  }

  async _promptSetChaseObstacleProgress({ initial = {} }) {
    const progress = Number.isFinite(initial?.progress) ? initial.progress : 0;
    const requiredPoints = Number.isFinite(initial?.requiredPoints)
      ? initial.requiredPoints
      : 0;
    const template = `
      <form>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Chase.ObstacleProgress")}</label>
          <input type="number" name="progress" min="0" step="1" value="${Number(progress) || 0}" ${
            requiredPoints > 0 ? `max="${requiredPoints}"` : ""
          } />
        </div>
      </form>
    `;
    const result = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Chase.SetObstacleProgress"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Chase.Save"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const formData = new FormData(form);
        const value = Number(formData.get("progress"));
        if (!Number.isFinite(value) || value < 0) return 0;
        if (requiredPoints > 0) {
          return Math.min(value, requiredPoints);
        }
        return value;
      },
      rejectClose: false,
    });
    if (result === undefined) return null;
    return result;
  }

  async _promptChaseOpportunityDialog({ title, label, initial = {} }) {
    const name = typeof initial?.name === "string" ? initial.name : "";
    const description = typeof initial?.description === "string" ? initial.description : "";
    const template = `
      <form>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Chase.OpportunityName")}</label>
          <input type="text" name="name" value="${escapeAttribute(name)}" required />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Chase.OpportunityDescription")}</label>
          <textarea name="description" rows="4">${escapeHtml(description)}</textarea>
        </div>
      </form>
    `;
    const result = await Dialog.prompt({
      title,
      content: template,
      label,
      callback: (html) => {
        const form = html[0].querySelector("form");
        const formData = new FormData(form);
        const nameValue = formData.get("name")?.toString().trim();
        const descriptionValue = formData.get("description")?.toString().trim();
        return {
          name: nameValue ?? "",
          description: descriptionValue ?? "",
        };
      },
      rejectClose: false,
    });
    if (!result) return null;
    return result;
  }

  _prepareReputationData({ isGM }) {
    if (!this.reputationTracker) {
      return {
        isGM,
        factions: [],
        hasTracker: false,
      };
    }

    const factions = this.reputationTracker.getFactions().map((faction) => {
      const minValue = Number.isFinite(faction.minValue) ? Number(faction.minValue) : 0;
      const maxValue = Number.isFinite(faction.maxValue) ? Number(faction.maxValue) : 0;
      const value = Number.isFinite(faction.value) ? Number(faction.value) : 0;
      const span = maxValue > minValue ? maxValue - minValue : maxValue;
      const percent = span > 0 ? ((value - minValue) / span) * 100 : maxValue > 0 ? (value / maxValue) * 100 : 0;
      const progressPercent = Math.max(0, Math.min(100, Number(faction.progressPercent ?? percent)));
      const updatedAtFormatted = Number.isFinite(faction.updatedAt)
        ? new Date(faction.updatedAt).toLocaleString()
        : null;

      return {
        ...faction,
        minValue,
        maxValue,
        value,
        progressPercent,
        updatedAtFormatted,
        canIncrease: maxValue === 0 || value < maxValue,
        canDecrease: value > minValue,
      };
    });

    return {
      isGM,
      factions,
      hasTracker: true,
    };
  }

  _prepareAwarenessData({ isGM }) {
    const hasTracker = Boolean(this.awarenessTracker);
    const hasAccess = Boolean(hasTracker && isGM);

    if (!hasAccess) {
      return {
        isGM,
        hasTracker,
        hasAccess,
        entries: [],
      };
    }

    const entries = this.awarenessTracker.getEntries().map((entry) => {
      const current = Number.isFinite(entry.current) ? Number(entry.current) : 0;
      const target = Number.isFinite(entry.target) ? Math.max(Number(entry.target), 0) : 0;
      const normalizedTarget = target > 0 ? target : Math.max(current, 1);
      const ratio = normalizedTarget > 0 ? Math.min(Math.max(current / normalizedTarget, 0), 1) : 0;
      const progressPercent = Math.max(0, Math.min(100, Number(entry.progressPercent ?? ratio * 100)));
      const intensity = Math.min(1, Math.max(0.2, 0.2 + ratio * 0.8));
      const updatedAtFormatted = Number.isFinite(entry.updatedAt)
        ? new Date(entry.updatedAt).toLocaleString()
        : null;

      const categoryKey =
        entry.category === "person"
          ? "PF2E.PointsTracker.Awareness.Category.person"
          : "PF2E.PointsTracker.Awareness.Category.location";

      return {
        ...entry,
        current,
        target: normalizedTarget,
        progressPercent,
        intensity: Number(intensity.toFixed(2)),
        updatedAtFormatted,
        categoryLabel: game.i18n.localize(categoryKey),
        canIncrease: current < normalizedTarget,
        canDecrease: current > 0,
      };
    });

    return {
      isGM,
      hasTracker,
      hasAccess,
      entries,
    };
  }

  _prepareChaseData({ isGM }) {
    if (!this.chaseTracker) {
      return {
        isGM,
        hasTracker: false,
        events: [],
        participants: [],
      };
    }

    const events = this.chaseTracker.getEvents();
    const chaseActors = this._getChaseActors();
    const actorLookup = new Map();
    for (const entry of chaseActors) {
      if (!entry?.uuid) continue;
      actorLookup.set(entry.uuid, entry);
      if (entry.actor?.id && !actorLookup.has(entry.actor.id)) {
        actorLookup.set(entry.actor.id, entry);
      }
      if (entry.actor?._id && !actorLookup.has(entry.actor._id)) {
        actorLookup.set(entry.actor._id, entry);
      }
    }

    const enrichedEvents = events.map((event) => {
      const obstacles = Array.isArray(event.obstacles) ? event.obstacles : [];
      const opportunities = Array.isArray(event.opportunities) ? event.opportunities : [];

      const normalizedObstacles = obstacles.map((obstacle) => {
        const required = Number.isFinite(obstacle.requiredPoints)
          ? Math.max(0, Number(obstacle.requiredPoints))
          : 0;
        const progress = Number.isFinite(obstacle.progress)
          ? Math.max(0, Number(obstacle.progress))
          : 0;
        const percent = required > 0 ? Math.min((progress / required) * 100, 100) : 0;
        return {
          ...obstacle,
          requiredPoints: required,
          progress,
          progressPercent: percent,
          isComplete: required > 0 && progress >= required,
          assignedActors: this._mapAssignedActors(obstacle.assignedActors, actorLookup),
        };
      });

      const normalizedOpportunities = opportunities.map((opportunity) => ({
        ...opportunity,
        assignedActors: this._mapAssignedActors(opportunity.assignedActors, actorLookup),
      }));

      return {
        ...event,
        obstacles: normalizedObstacles,
        opportunities: normalizedOpportunities,
        hasObstacles: normalizedObstacles.length > 0,
        hasOpportunities: normalizedOpportunities.length > 0,
      };
    });

    const participants = chaseActors.map((entry) => ({
      uuid: entry.uuid,
      actorUuid: entry.uuid,
      tokenUuid: entry.tokenUuid ?? "",
      name: entry.name,
      img: entry.img,
    }));

    return {
      isGM,
      hasTracker: true,
      events: enrichedEvents,
      participants,
    };
  }

  async _prepareInfluenceData({ isGM }) {
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
    const npcLookup = new Map();
    const slugifySkill = (value) => {
      if (!value) return "";
      if (foundry?.utils?.slugify) {
        try {
          return foundry.utils.slugify(value, { strict: true });
        } catch (error) {
          console.error(error);
        }
      }
      return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    };

    const npcs = [];
    for (const npc of npcsRaw) {
      npcLookup.set(npc.id, npc);
      const maxInfluence = Number.isFinite(npc.maxInfluence) ? Number(npc.maxInfluence) : 0;
      const currentInfluence = Number.isFinite(npc.currentInfluence)
        ? Math.max(0, Number(npc.currentInfluence))
        : 0;
      const percent = maxInfluence > 0 ? Math.min((currentInfluence / maxInfluence) * 100, 100) : 0;
      const progressPercent = Math.max(0, Math.min(100, Number(percent.toFixed(2))));
      const baseDc = Number.isFinite(npc.baseDc) ? Number(npc.baseDc) : null;
      const baseDcLabel = baseDc !== null
        ? game.i18n.format("PF2E.PointsTracker.Influence.BaseDCLabel", { dc: baseDc })
        : game.i18n.localize("PF2E.PointsTracker.Influence.BaseDCMissing");
      const traits = Array.isArray(npc.traits)
        ? npc.traits
            .map((trait) => (typeof trait === "string" ? trait.trim() : ""))
            .filter((trait) => trait)
        : [];
      const traitsLabel = traits.join(", ");
      const skillDcsRaw = Array.isArray(npc.skillDcs) ? npc.skillDcs : [];
      const skillDcs = await Promise.all(
        skillDcsRaw.map(async (entry) => {
          const skill = typeof entry.skill === "string" ? entry.skill.trim() : "";
          const dc = Number.isFinite(entry.dc) ? Number(entry.dc) : null;
          const label = (() => {
            const parts = [];
            if (skill) parts.push(skill);
            if (dc !== null) {
              parts.push(
                game.i18n.format("PF2E.PointsTracker.Influence.SkillDCValue", {
                  dc,
                })
              );
            }
            return parts.join(" • ") || skill;
          })();
          const slug = slugifySkill(skill);
          const inlineParts = [];
          if (slug) {
            inlineParts.push(`type:${slug}`);
            if (dc !== null) inlineParts.push(`dc:${dc}`);
          }
          const displayText = label || skill;
          const inlineText = inlineParts.length && displayText ? `@Check[${inlineParts.join("|")}]${displayText}` : "";
          const inlineHtml = inlineText ? await this._enrichText(inlineText) : "";
          return {
            id: entry.id,
            skill,
            dc,
            label,
            inlineHtml: inlineHtml || null,
          };
        })
      );
      const thresholds = Array.isArray(npc.thresholds)
        ? npc.thresholds.map((threshold) => {
            const points = Number.isFinite(threshold.points) ? Number(threshold.points) : 0;
            const isUnlocked = currentInfluence >= points;
            const revealedAt = Number.isFinite(threshold.revealedAt)
              ? Number(threshold.revealedAt)
              : null;
            return {
              id: threshold.id,
              points,
              gmText: threshold.gmText ?? "",
              playerText: threshold.playerText ?? "",
              reward: threshold.reward ?? "",
              isUnlocked,
              isRevealed: revealedAt !== null,
              revealedAt,
              revealedAtFormatted: revealedAt ? new Date(revealedAt).toLocaleString() : null,
              pointsLabel: game.i18n.format("PF2E.PointsTracker.Influence.ThresholdPoints", {
                points,
              }),
            };
          })
        : [];

      const discoveryChecks =
        typeof npc.discoveryChecks === "string" ? npc.discoveryChecks.trim() : "";
      const discoveryChecksHtml = escapeHtml(discoveryChecks).replace(/\n/g, "<br />");
      const influenceChecks =
        typeof npc.influenceChecks === "string" ? npc.influenceChecks.trim() : "";
      const influenceChecksHtml = escapeHtml(influenceChecks).replace(/\n/g, "<br />");
      const penalty = npc.penalty ?? "";
      const penaltyHtml = escapeHtml(penalty).replace(/\n/g, "<br />");
      const notes = npc.notes ?? "";
      const notesHtml = escapeHtml(notes).replace(/\n/g, "<br />");
      const updatedAt = Number.isFinite(npc.updatedAt) ? Number(npc.updatedAt) : null;
      const updatedAtFormatted = updatedAt ? new Date(updatedAt).toLocaleString() : null;

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

      const npcData = {
        id: npc.id,
        name: npc.name,
        currentInfluence,
        maxInfluence,
        maxInfluenceLabel:
          maxInfluence > 0
            ? game.i18n.format("PF2E.PointsTracker.Influence.MaxInfluence", { value: maxInfluence })
            : game.i18n.localize("PF2E.PointsTracker.Influence.MaxInfluenceUnlimited"),
        progressPercent,
        baseDc,
        baseDcLabel,
        traits,
        traitsLabel,
        hasTraits: traits.length > 0,
        skillDcs,
        hasSkillDcs: skillDcs.length > 0,
        thresholds,
        hasThresholds: thresholds.length > 0,
        discoveryChecks,
        discoveryChecksHtml,
        hasDiscoveryChecks: Boolean(discoveryChecks),
        influenceChecks,
        influenceChecksHtml,
        hasInfluenceChecks: Boolean(influenceChecks),
        penalty,
        penaltyHtml,
        notes,
        notesHtml,
        updatedAt,
        updatedAtFormatted,
        logEntries: npcLog,
        hasLogEntries: npcLog.length > 0,
        canIncrease: maxInfluence === 0 || currentInfluence < maxInfluence,
        canDecrease: currentInfluence > 0,
      };
      npcs.push(npcData);
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

    return {
      isGM,
      hasTracker: true,
      npcs,
      log: logEntries,
      hasNpcs: npcs.length > 0,
      canCreate: isGM,
      hasLog: logEntries.length > 0,
    };
  }

  _activateInfluenceListeners(html) {
    const panel = html.find("[data-tab-panel='influence']");
    if (!panel.length) return;

    panel
      .find("[data-action='create-influence-npc']")
      .off("click")
      .on("click", (event) => this._onCreateInfluenceNpc(event));

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
      .find("[data-action='manage-influence-thresholds']")
      .off("click")
      .on("click", (event) => this._onManageInfluenceThresholds(event));

    panel
      .find("[data-action='toggle-influence-threshold']")
      .off("click")
      .on("click", (event) => this._onToggleInfluenceThreshold(event));

    panel
      .find("[data-action='add-influence-log-entry']")
      .off("click")
      .on("click", (event) => this._onAddInfluenceLogEntry(event));

    panel
      .find("[data-action='edit-influence-log-entry']")
      .off("click")
      .on("click", (event) => this._onEditInfluenceLogEntry(event));

    panel
      .find("[data-action='delete-influence-log-entry']")
      .off("click")
      .on("click", (event) => this._onDeleteInfluenceLogEntry(event));
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

  async _onToggleInfluenceThreshold(event) {
    event.preventDefault();
    if (!this.influenceTracker) return;

    const button = event.currentTarget;
    const npcId = button.closest("[data-npc-id]")?.dataset.npcId;
    const thresholdId = button.closest("[data-threshold-id]")?.dataset.thresholdId;
    if (!npcId || !thresholdId) return;
    const npc = this.influenceTracker.getNpc(npcId);
    if (!npc) return;

    const thresholds = Array.isArray(npc.thresholds) ? npc.thresholds : [];
    const updated = thresholds.map((threshold) => {
      if (threshold.id !== thresholdId) return threshold;
      const isRevealed = Number.isFinite(threshold.revealedAt) && threshold.revealedAt !== null;
      return {
        ...threshold,
        revealedAt: isRevealed ? null : Date.now(),
      };
    });

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
    const baseDcDefault = Number.isFinite(initial.baseDc) ? Number(initial.baseDc) : "";
    const traitsDefault = Array.isArray(initial.traits)
      ? initial.traits.join(", ")
      : typeof initial.traits === "string"
      ? initial.traits
      : "";
    const traitsPlaceholder = game.i18n.localize("PF2E.PointsTracker.Influence.TraitsPlaceholder");
    const discoveryChecksDefault =
      typeof initial.discoveryChecks === "string" ? initial.discoveryChecks : "";
    const influenceChecksDefault =
      typeof initial.influenceChecks === "string" ? initial.influenceChecks : "";
    const discoveryChecksPlaceholder = game.i18n.localize(
      "PF2E.PointsTracker.Influence.DiscoveryChecksPlaceholder"
    );
    const influenceChecksPlaceholder = game.i18n.localize(
      "PF2E.PointsTracker.Influence.InfluenceChecksPlaceholder"
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
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.BaseDC")}</label>
          <input type="number" name="baseDc" min="0" step="1" value="${escapeAttribute(baseDcDefault)}">
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.TraitsLabel")}</label>
          <input type="text" name="traits" value="${escapeAttribute(traitsDefault)}" placeholder="${escapeAttribute(traitsPlaceholder)}">
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.DiscoveryChecksLabel")}</label>
          <textarea name="discoveryChecks" rows="3" placeholder="${escapeAttribute(discoveryChecksPlaceholder)}">${escapeHtml(discoveryChecksDefault)}</textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Influence.InfluenceChecksLabel")}</label>
          <textarea name="influenceChecks" rows="3" placeholder="${escapeAttribute(influenceChecksPlaceholder)}">${escapeHtml(influenceChecksDefault)}</textarea>
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
              const baseDcValue = Number(formData.get("baseDc"));
              const traitsRaw = String(formData.get("traits") ?? "").trim();
              const discoveryChecks = String(formData.get("discoveryChecks") ?? "").trim();
              const influenceChecks = String(formData.get("influenceChecks") ?? "").trim();
              const penalty = String(formData.get("penalty") ?? "").trim();
              const notes = String(formData.get("notes") ?? "").trim();

              const payload = {
                name,
                currentInfluence: Number.isFinite(currentInfluenceValue)
                  ? Math.max(0, currentInfluenceValue)
                  : 0,
                maxInfluence: Number.isFinite(maxInfluenceValue)
                  ? Math.max(0, maxInfluenceValue)
                  : 0,
                baseDc: Number.isFinite(baseDcValue) ? Math.max(0, baseDcValue) : null,
                traits: traitsRaw,
                discoveryChecks,
                influenceChecks,
                penalty,
                notes,
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
        default: "confirm",
        close: () => resolve(null),
      });
      dialog.render(true);
    });
  }

  async _promptInfluenceSkillsDialog({ npc }) {
    const existing = Array.isArray(npc?.skillDcs) ? npc.skillDcs : [];
    const rows = existing.concat(new Array(3).fill(null));

    const fields = rows
      .map((entry) => {
        const id = entry?.id ?? "";
        const skill = entry?.skill ?? "";
        const dc = Number.isFinite(entry?.dc) ? Number(entry.dc) : "";
        return `
          <div class="influence-skill-row" data-skill-row>
            <input type="hidden" name="skillId[]" value="${escapeAttribute(id)}">
            <div class="form-group">
              <label>${game.i18n.localize("PF2E.PointsTracker.Influence.SkillName")}</label>
              <input type="text" name="skillName[]" value="${escapeAttribute(skill)}">
            </div>
            <div class="form-group">
              <label>${game.i18n.localize("PF2E.PointsTracker.Influence.SkillDC")}</label>
              <input type="number" name="skillDc[]" min="0" step="1" value="${escapeAttribute(dc)}">
            </div>
          </div>
        `;
      })
      .join("");

    const template = `
      <form class="flexcol points-tracker-dialog">
        <p class="notes">${game.i18n.localize("PF2E.PointsTracker.Influence.SkillHint")}</p>
        ${fields}
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
        for (let index = 0; index < skills.length; index += 1) {
          const skill = String(skills[index] ?? "").trim();
          const dcRaw = Number(dcs[index]);
          const hasSkill = Boolean(skill);
          const hasDc = Number.isFinite(dcRaw);
          if (!hasSkill && !hasDc) continue;

          let id = String(ids[index] ?? "").trim();
          if (!id) id = this._generateId();
          entries.push({ id, skill, dc: hasDc ? Number(dcRaw) : null });
        }

        return entries;
      },
      rejectClose: false,
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

  async _onCreateFaction(event) {
    event.preventDefault();
    if (!this.reputationTracker) return;

    const result = await this._promptFactionDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Reputation.CreateFaction"),
      label: game.i18n.localize("PF2E.PointsTracker.Reputation.Create"),
    });
    if (!result) return;

    await this.reputationTracker.createFaction(result);
    this.render();
  }

  async _onEditFaction(event) {
    event.preventDefault();
    if (!this.reputationTracker) return;

    const factionId = event.currentTarget.closest("[data-faction-id]")?.dataset.factionId;
    if (!factionId) return;

    const faction = this.reputationTracker.getFaction(factionId);
    if (!faction) return;

    const result = await this._promptFactionDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Reputation.EditFaction"),
      label: game.i18n.localize("PF2E.PointsTracker.Reputation.Save"),
      initial: faction,
    });
    if (!result) return;

    await this.reputationTracker.updateFaction(factionId, result);
    this.render();
  }

  async _onDeleteFaction(event) {
    event.preventDefault();
    if (!this.reputationTracker) return;

    const factionId = event.currentTarget.closest("[data-faction-id]")?.dataset.factionId;
    if (!factionId) return;

    const faction = this.reputationTracker.getFaction(factionId);
    if (!faction) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Reputation.DeleteFaction"),
      content: `<p>${game.i18n.format("PF2E.PointsTracker.Reputation.DeleteFactionConfirm", {
        name: escapeHtml(faction.name),
      })}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false,
    });
    if (!confirmed) return;

    await this.reputationTracker.deleteFaction(factionId);
    this.render();
  }

  async _onAdjustFaction(event) {
    event.preventDefault();
    if (!this.reputationTracker) return;

    const button = event.currentTarget;
    const factionId = button.closest("[data-faction-id]")?.dataset.factionId;
    if (!factionId) return;
    const delta = Number(button.dataset.delta ?? 0);
    if (!Number.isFinite(delta) || delta === 0) return;

    await this.reputationTracker.adjustReputation(factionId, delta, { notify: false });
    this.render();
  }

  async _promptFactionDialog({ title, label, initial = {} }) {
    const defaultMax = Number.isFinite(initial.maxValue) ? Number(initial.maxValue) : 100;
    const defaultMin = Number.isFinite(initial.minValue) ? Number(initial.minValue) : 0;
    const defaultValue = Number.isFinite(initial.value) ? Number(initial.value) : defaultMin;
    const template = `
      <form class="flexcol points-tracker-dialog">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Reputation.FactionName")}</label>
          <input type="text" name="name" value="${escapeAttribute(initial.name ?? "")}" required>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Reputation.Description")}</label>
          <textarea name="description" rows="3">${escapeHtml(initial.description ?? "")}</textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Reputation.Notes")}</label>
          <textarea name="notes" rows="3">${escapeHtml(initial.notes ?? "")}</textarea>
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Reputation.MinValue")}</label>
          <input type="number" name="minValue" value="${escapeAttribute(defaultMin)}">
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Reputation.MaxValue")}</label>
          <input type="number" name="maxValue" value="${escapeAttribute(defaultMax)}">
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Reputation.CurrentValue")}</label>
          <input type="number" name="value" value="${escapeAttribute(defaultValue)}">
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
                  game.i18n.localize("PF2E.PointsTracker.Reputation.NameRequired")
                );
                resolve(null);
                return;
              }

              const description = String(formData.get("description") ?? "").trim();
              const notes = String(formData.get("notes") ?? "").trim();
              const minValueRaw = Number(formData.get("minValue"));
              const maxValueRaw = Number(formData.get("maxValue"));
              const valueRaw = Number(formData.get("value"));

              const minValue = Number.isFinite(minValueRaw) ? minValueRaw : 0;
              let maxValue = Number.isFinite(maxValueRaw) ? maxValueRaw : defaultMax;
              if (maxValue !== 0 && maxValue < minValue) {
                maxValue = minValue;
              }

              let value = Number.isFinite(valueRaw) ? valueRaw : defaultValue;
              if (value < minValue) value = minValue;
              if (maxValue !== 0 && value > maxValue) value = maxValue;

              resolve({
                name,
                description,
                notes,
                minValue,
                maxValue,
                value,
              });
            },
          },
          cancel: {
            icon: "fas fa-times",
            label: game.i18n.localize("PF2E.PointsTracker.Cancel"),
            callback: () => resolve(null),
          },
        },
        default: "confirm",
        close: () => resolve(null),
      });
      dialog.render(true);
    });
  }

  async _onCreateAwarenessEntry(event) {
    event.preventDefault();
    if (!this.awarenessTracker) return;

    const result = await this._promptAwarenessDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Awareness.CreateEntry"),
      label: game.i18n.localize("PF2E.PointsTracker.Awareness.Create"),
    });
    if (!result) return;

    await this.awarenessTracker.createEntry(result);
    this.render();
  }

  async _onEditAwarenessEntry(event) {
    event.preventDefault();
    if (!this.awarenessTracker) return;

    const entryId = event.currentTarget.closest("[data-entry-id]")?.dataset.entryId;
    if (!entryId) return;

    const entry = this.awarenessTracker.getEntry(entryId);
    if (!entry) return;

    const result = await this._promptAwarenessDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Awareness.EditEntry"),
      label: game.i18n.localize("PF2E.PointsTracker.Awareness.Save"),
      initial: entry,
    });
    if (!result) return;

    await this.awarenessTracker.updateEntry(entryId, result);
    this.render();
  }

  async _onDeleteAwarenessEntry(event) {
    event.preventDefault();
    if (!this.awarenessTracker) return;

    const entryId = event.currentTarget.closest("[data-entry-id]")?.dataset.entryId;
    if (!entryId) return;

    const entry = this.awarenessTracker.getEntry(entryId);
    if (!entry) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Awareness.DeleteEntry"),
      content: `<p>${game.i18n.format("PF2E.PointsTracker.Awareness.DeleteConfirm", {
        name: escapeHtml(entry.name),
      })}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false,
    });
    if (!confirmed) return;

    await this.awarenessTracker.deleteEntry(entryId);
    this.render();
  }

  async _onAdjustAwarenessEntry(event) {
    event.preventDefault();
    if (!this.awarenessTracker) return;

    const button = event.currentTarget;
    const entryId = button.closest("[data-entry-id]")?.dataset.entryId;
    if (!entryId) return;
    const delta = Number(button.dataset.delta ?? 0);
    if (!Number.isFinite(delta) || delta === 0) return;

    await this.awarenessTracker.adjustAwareness(entryId, delta, { notify: false });
    this.render();
  }

  async _promptAwarenessDialog({ title, label, initial = {} }) {
    const defaultTarget = Number.isFinite(initial.target) ? Math.max(Number(initial.target), 1) : 10;
    const defaultCurrent = Number.isFinite(initial.current)
      ? Math.max(0, Math.min(Number(initial.current), defaultTarget))
      : 0;
    const selectedCategory = initial.category === "person" ? "person" : "location";

    const template = `
      <form class="flexcol points-tracker-dialog">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Awareness.EntryName")}</label>
          <input type="text" name="name" value="${escapeAttribute(initial.name ?? "")}" required>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Awareness.Category")}</label>
          <select name="category">
            <option value="location" ${selectedCategory === "location" ? "selected" : ""}>
              ${game.i18n.localize("PF2E.PointsTracker.Awareness.Category.location")}
            </option>
            <option value="person" ${selectedCategory === "person" ? "selected" : ""}>
              ${game.i18n.localize("PF2E.PointsTracker.Awareness.Category.person")}
            </option>
          </select>
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Awareness.CurrentValue")}</label>
          <input type="number" name="current" min="0" step="1" value="${escapeAttribute(defaultCurrent)}">
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Awareness.TargetValue")}</label>
          <input type="number" name="target" min="1" step="1" value="${escapeAttribute(defaultTarget)}">
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Awareness.Notes")}</label>
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
                  game.i18n.localize("PF2E.PointsTracker.Awareness.NameRequired")
                );
                resolve(null);
                return;
              }

              const categoryRaw = String(formData.get("category") ?? "location").trim().toLowerCase();
              const category = categoryRaw === "person" ? "person" : "location";
              const targetRaw = Number(formData.get("target"));
              const currentRaw = Number(formData.get("current"));
              const target = Number.isFinite(targetRaw) && targetRaw > 0 ? Math.floor(targetRaw) : defaultTarget;
              let current = Number.isFinite(currentRaw) ? Math.floor(currentRaw) : defaultCurrent;
              if (current < 0) current = 0;
              if (current > target) current = target;
              const notes = String(formData.get("notes") ?? "").trim();

              resolve({
                name,
                category,
                current,
                target,
                notes,
              });
            },
          },
          cancel: {
            icon: "fas fa-times",
            label: game.i18n.localize("PF2E.PointsTracker.Cancel"),
            callback: () => resolve(null),
          },
        },
        default: "confirm",
        close: () => resolve(null),
      });
      dialog.render(true);
    });
  }
}

export class ResearchTrackerApp extends PointsTrackerApp {
  constructor(tracker, options = {}) {
    super({ researchTracker: tracker }, options);
    this.tracker = this.researchTracker;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "research-tracker-app",
    });
  }

  static open(tracker) {
    return super.open({ researchTracker: tracker });
  }
}
