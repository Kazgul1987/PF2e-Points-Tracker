import { ResearchImportExport } from "../research/importer.js";

const MODULE_ID = "pf2e-points-tracker";

export class ResearchTrackerApp extends FormApplication {
  /**
   * @param {ResearchTracker} tracker
   * @param {object} [options]
   */
  constructor(tracker, options = {}) {
    super(tracker, options);
    this.tracker = tracker;
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
    for (const topic of topics) {
      const thresholds = (topic.thresholds ?? []).map((threshold) => ({
        ...threshold,
        isUnlocked: topic.progress >= threshold.points,
        isRevealed: Array.isArray(topic.revealedThresholdIds)
          ? topic.revealedThresholdIds.includes(threshold.id)
          : Boolean(threshold.revealedAt),
      }));

      const locations = (topic.locations ?? []).map((location) => {
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
        return {
          ...location,
          maxPoints,
          collected,
          percent: Math.round(percent * 100) / 100,
          displayMax,
        };
      });

      const totalCollected = locations.reduce((sum, location) => sum + location.collected, 0);
      const totalMax = locations.reduce((sum, location) => sum + location.maxPoints, 0);
      const hasUnlimitedLocation = locations.some((location) => location.maxPoints === 0);
      const totalDisplayMax = hasUnlimitedLocation
        ? game.i18n.localize("PF2E.PointsTracker.Research.LocationUnlimited")
        : totalMax;

      const skillLabel = topic.skill
        ? game.i18n.format("PF2E.PointsTracker.Research.SkillLabel", { skill: topic.skill })
        : "";
      const partyMembers = partyActors.map((actor) => ({
        id: actor.id,
        name: actor.name,
        uuid: actor.uuid,
        skillLabel,
      }));

      enrichedTopics.push({
        ...topic,
        completed: topic.target > 0 && topic.progress >= topic.target,
        thresholds,
        locations,
        locationTotals: {
          collected: totalCollected,
          max: totalMax,
          displayMax: totalDisplayMax,
          hasUnlimited: hasUnlimitedLocation,
        },
        partyMembers,
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

    html.find("[data-action='create-topic']").on("click", (event) => this._onCreateTopic(event));
    html.find("[data-action='edit-topic']").on("click", (event) => this._onEditTopic(event));
    html.find("[data-action='delete-topic']").on("click", (event) => this._onDeleteTopic(event));
    html.find("[data-action='add-points']").on("click", (event) => this._onAdjustPoints(event, 1));
    html.find("[data-action='spend-points']").on("click", (event) => this._onAdjustPoints(event, -1));
    html.find("[data-action='perform-roll']").on("click", (event) => this._onPerformRoll(event));
    html.find("[data-action='send-reveal']").on("click", (event) => this._onSendReveal(event, false));
    html.find("[data-action='resend-reveal']").on("click", (event) => this._onSendReveal(event, true));
    html.find("[data-action='import-topics']").on("click", (event) => this._onImportTopics(event));
    html.find("[data-action='export-topics']").on("click", (event) => this._onExportTopics(event));
    html.find("[data-action='create-location']").on("click", (event) => this._onCreateLocation(event));
    html.find("[data-action='edit-location']").on("click", (event) => this._onEditLocation(event));
    html.find("[data-action='delete-location']").on("click", (event) => this._onDeleteLocation(event));
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
        skill: "society",
        difficulty: "standard",
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
        skill: topic.skill,
        difficulty: topic.difficulty,
        summary: topic.summary,
        gatherInformation: topic.gatherInformation,
        researchChecks: topic.researchChecks,
      },
      disableTarget: Array.isArray(topic.locations) && topic.locations.length > 0,
    });

    if (!updates) return;

    await this.tracker.updateTopic(topicId, updates);
    this.render();
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
    const values = {
      name: initial.name ?? "",
      target: Number.isFinite(initial.target)
        ? Number(initial.target)
        : includeLocations
        ? 10
        : 0,
      skill:
        initial.skill ??
        (includeLocations ? "society" : ""),
      difficulty:
        initial.difficulty ??
        (includeLocations ? "standard" : ""),
      summary: initial.summary ?? "",
      gatherInformation: initial.gatherInformation ?? "",
      researchChecks: initial.researchChecks ?? "",
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
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Skill")}</label>
          <input type="text" name="skill" value="" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Difficulty")}</label>
          <input type="text" name="difficulty" value="" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Summary")}</label>
          <textarea name="summary" rows="3"></textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.GatherInformation")}</label>
          <textarea name="gatherInformation" rows="3"></textarea>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.ResearchChecks")}</label>
          <textarea name="researchChecks" rows="3"></textarea>
        </div>
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

        const skillValue = trimmed("skill");
        if (skillValue !== undefined) {
          payload.skill = skillValue || undefined;
        }

        const difficultyValue = trimmed("difficulty");
        if (difficultyValue !== undefined) {
          payload.difficulty = difficultyValue || undefined;
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

        if (includeLocations) {
          const locationEntries = Array.from(
            form.querySelectorAll("[data-location-entry]")
          )
            .map((element) => {
              const name = element.querySelector("[data-field='name']")?.value?.trim();
              const maxPointsValue = element.querySelector("[data-field='maxPoints']")?.value;
              const collectedValue = element.querySelector("[data-field='collected']")?.value;
              const maxPoints = Number(maxPointsValue);
              const collected = Number(collectedValue);
              return {
                name: name || undefined,
                maxPoints: Number.isFinite(maxPoints) ? maxPoints : 0,
                collected: Number.isFinite(collected) ? collected : 0,
              };
            })
            .filter((entry) => entry.name || entry.maxPoints || entry.collected);
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
        setValue("skill", values.skill ?? "");
        setValue("difficulty", values.difficulty ?? "");

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
            const maxInput = createInput("number", "maxPoints", rowValues.maxPoints ?? 0);
            const collectedInput = createInput(
              "number",
              "collected",
              rowValues.collected ?? 0
            );

            fields.appendChild(nameInput);
            fields.appendChild(maxInput);
            fields.appendChild(collectedInput);

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
            const selected = locationId === location.id ? "selected" : "";
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
            return `<option value="${location.id}" ${selected}>${totalLabel}</option>`;
          })
          .join("")
      : "";

    const template = `
      <form class="flexcol">
        ${
          hasLocations
            ? `
                <div class="form-group">
                  <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationSelect")}</label>
                  <select name="locationId">
                    ${locationOptions}
                  </select>
                </div>
              `
            : ""
        }
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
          locationId: fd.get("locationId")?.toString() || locationId || undefined,
        };
      },
      rejectClose: false,
    });

    if (!response) return;

    if (hasLocations) {
      const selectedLocation = response.locationId ?? locationId ?? topic.locations[0]?.id;
      if (!selectedLocation) return;
      await this.tracker.adjustLocationPoints(topicId, selectedLocation, response.points, {
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
  async _onCreateLocation(event) {
    event.preventDefault();
    const topicId = event.currentTarget.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

    const template = `
      <form class="flexcol">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationName")}</label>
          <input type="text" name="name" value="" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationMaxPoints")}</label>
          <input type="number" name="maxPoints" value="10" min="0" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationCollected")}</label>
          <input type="number" name="collected" value="0" min="0" step="1" />
        </div>
      </form>
    `;

    const response = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.CreateLocation"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Create"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const fd = new FormData(form);
        return {
          name: fd.get("name")?.toString().trim() || undefined,
          maxPoints: Number(fd.get("maxPoints")) || 0,
          collected: Number(fd.get("collected")) || 0,
        };
      },
      rejectClose: false,
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

    const template = `
      <form class="flexcol">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationName")}</label>
          <input type="text" name="name" value="${location.name}" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationMaxPoints")}</label>
          <input type="number" name="maxPoints" value="${location.maxPoints}" min="0" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.LocationCollected")}</label>
          <input type="number" name="collected" value="${location.collected}" min="0" step="1" />
        </div>
      </form>
    `;

    const response = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.EditLocation"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Save"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const fd = new FormData(form);
        return {
          name: fd.get("name")?.toString().trim() || undefined,
          maxPoints: Number(fd.get("maxPoints")) || 0,
          collected: Number(fd.get("collected")) || 0,
        };
      },
      rejectClose: false,
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
  async _onPerformRoll(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const topicId = button.closest("[data-topic-id]")?.dataset.topicId;
    const actorUuid =
      button.dataset.actorUuid ?? button.closest("[data-actor-uuid]")?.dataset.actorUuid;
    if (!topicId || !actorUuid) return;

    const topic = this.tracker.getTopic(topicId);
    if (!topic) return;

    if (!topic.skill) {
      ui.notifications.warn(game.i18n.localize("PF2E.PointsTracker.Research.NoSkillConfigured"));
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

    const skill = actor.skills[topic.skill];
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
