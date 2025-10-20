import { InlineRollLinks } from "systems/pf2e/module/system/inline-roll-links.js";
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
      template: `modules/${MODULE_ID}/templates/research-tracker.hbs`,
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
    html.find("[data-action='delete-topic']").on("click", (event) => this._onDeleteTopic(event));
    html.find("[data-action='add-points']").on("click", (event) => this._onAdjustPoints(event, 1));
    html.find("[data-action='spend-points']").on("click", (event) => this._onAdjustPoints(event, -1));
    html.find("[data-action='add-participant']").on("click", (event) => this._onAddParticipant(event));
    html.find("[data-action='remove-participant']").on("click", (event) => this._onRemoveParticipant(event));
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

    const template = `
      <form class="flexcol">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.TopicName")}</label>
          <input type="text" name="name" value="" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Target")}</label>
          <input type="number" name="target" value="10" min="1" step="1" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Skill")}</label>
          <input type="text" name="skill" value="society" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Difficulty")}</label>
          <input type="text" name="difficulty" value="standard" />
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
        <fieldset class="form-group research-topic__locations">
          <legend>${game.i18n.localize("PF2E.PointsTracker.Research.LocationList")}</legend>
          <p class="notes">${game.i18n.localize("PF2E.PointsTracker.Research.LocationListHint")}</p>
          <div class="research-topic__location-editor" data-locations></div>
          <button type="button" class="dialog-button" data-add-location>
            <i class="fas fa-plus"></i>
            ${game.i18n.localize("PF2E.PointsTracker.Research.AddLocation")}
          </button>
        </fieldset>
      </form>
    `;

    const data = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.CreateTopic"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Create"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const fd = new FormData(form);
        const locationEntries = Array.from(
          form.querySelectorAll("[data-location-entry]")
        )
          .map((element) => {
            const name = element.querySelector("[data-field='name']")?.value?.trim();
            const maxPointsValue = element
              .querySelector("[data-field='maxPoints']")
              ?.value;
            const collectedValue = element
              .querySelector("[data-field='collected']")
              ?.value;
            const maxPoints = Number(maxPointsValue);
            const collected = Number(collectedValue);
            return {
              name: name || undefined,
              maxPoints: Number.isFinite(maxPoints) ? maxPoints : 0,
              collected: Number.isFinite(collected) ? collected : 0,
            };
          })
          .filter((entry) => entry.name || entry.maxPoints || entry.collected);
        return {
          name: fd.get("name")?.toString().trim() || undefined,
          target: Number(fd.get("target")) || 0,
          skill: fd.get("skill")?.toString().trim() || undefined,
          difficulty: fd.get("difficulty")?.toString().trim() || undefined,
          summary: fd.get("summary")?.toString().trim() || undefined,
          gatherInformation: fd.get("gatherInformation")?.toString().trim() || undefined,
          researchChecks: fd.get("researchChecks")?.toString().trim() || undefined,
          locations: locationEntries,
        };
      },
      render: (html) => {
        const root = html[0];
        const container = root.querySelector("[data-locations]");
        const addButton = root.querySelector("[data-add-location]");
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

        const addRow = (values = {}) => {
          const row = document.createElement("div");
          row.classList.add("research-location-editor-row");
          row.dataset.locationEntry = "true";

          const fields = document.createElement("div");
          fields.classList.add("research-location-editor-row__fields");

          const nameInput = createInput("text", "name", values.name ?? "");
          nameInput.placeholder = game.i18n.localize(
            "PF2E.PointsTracker.Research.LocationName"
          );
          const maxInput = createInput(
            "number",
            "maxPoints",
            values.maxPoints ?? 0
          );
          const collectedInput = createInput(
            "number",
            "collected",
            values.collected ?? 0
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

        addRow();
      },
      rejectClose: false,
    });

    if (!data) return;
    await this.tracker.createTopic(data);
    this.render();
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
  async _onAddParticipant(event) {
    event.preventDefault();
    const topicId = event.currentTarget.closest("[data-topic-id]")?.dataset.topicId;
    if (!topicId) return;

    const actors = game.actors?.contents ?? [];
    const actorOptions = actors
      .map((actor) => `<option value="${actor.uuid}">${actor.name}</option>`)
      .join("");

    const template = `
      <form class="flexcol">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.ParticipantActor")}</label>
          <select name="actorUuid">${actorOptions}</select>
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.ParticipantName")}</label>
          <input type="text" name="name" value="" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Skill")}</label>
          <input type="text" name="skill" value="" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.Role")}</label>
          <input type="text" name="role" value="" />
        </div>
      </form>
    `;

    const participant = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.AddParticipant"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Add"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const fd = new FormData(form);
        const actorUuid = fd.get("actorUuid")?.toString() ?? "";
        const actor = actors.find((candidate) => candidate.uuid === actorUuid);
        const name = fd.get("name")?.toString().trim() || actor?.name || undefined;
        return {
          actorUuid,
          name,
          skill: fd.get("skill")?.toString().trim() || undefined,
          role: fd.get("role")?.toString().trim() || undefined,
        };
      },
      rejectClose: false,
    });

    if (!participant) return;
    await this.tracker.addParticipant(topicId, participant);
    this.render();
  }

  /** @private */
  async _onRemoveParticipant(event) {
    event.preventDefault();
    const container = event.currentTarget.closest("[data-participant-id]");
    if (!container) return;
    const topicId = container.closest("[data-topic-id]")?.dataset.topicId;
    const participantId = container.dataset.participantId;
    if (!topicId || !participantId) return;

    await this.tracker.removeParticipant(topicId, participantId);
    this.render();
  }

  /** @private */
  async _onPerformRoll(event) {
    event.preventDefault();
    const container = event.currentTarget.closest("[data-participant-id]");
    if (!container) return;
    const topicId = container.closest("[data-topic-id]")?.dataset.topicId;
    const participantId = container.dataset.participantId;
    if (!topicId || !participantId) return;

    const participant = this.tracker.getParticipant(topicId, participantId);
    const topic = this.tracker.getTopic(topicId);
    if (!participant?.actorUuid) {
      ui.notifications.warn(game.i18n.localize("PF2E.PointsTracker.Research.NoActor"));
      return;
    }

    const actor = await fromUuid(participant.actorUuid);
    if (!(actor?.skills)) {
      ui.notifications.warn(game.i18n.localize("PF2E.PointsTracker.Research.ActorMissingSkills"));
      return;
    }

    const skillKey = participant.skill || topic?.skill;
    const skill = actor.skills[skillKey];
    if (!skill?.roll) {
      ui.notifications.warn(game.i18n.localize("PF2E.PointsTracker.Research.SkillUnavailable"));
      return;
    }

    const inlineCommand = `@Check[type:${skillKey}|traits:research]`;
    const inlineResult = await this._performInlineCheck({ actor, event, inlineCommand });

    let roll = this._extractRollFromInlineResult(inlineResult);

    if (!roll) {
      if (inlineResult != null) {
        console.warn("PF2E Points Tracker | Unable to read inline roll result", inlineResult);
      }
      roll = await skill.roll({
        event,
        callback: null,
        createMessage: true,
        extraRollOptions: ["research"],
        dc: null,
      });
    }

    if (!roll) return;

    const adjustment = await this._promptForPoints(roll.total, topic);
    if (!adjustment) return;

    if (topic?.locations?.length) {
      const locationId = adjustment.locationId ?? topic.locations[0]?.id;
      if (!locationId) return;
      await this.tracker.adjustLocationPoints(topicId, locationId, adjustment.points, {
        actorUuid: participant.actorUuid,
        actorName: participant.name,
        reason: adjustment.reason,
        roll: roll.toJSON ? roll.toJSON() : roll,
      });
    } else {
      await this.tracker.adjustPoints(topicId, adjustment.points, {
        actorUuid: participant.actorUuid,
        actorName: participant.name,
        reason: adjustment.reason,
        roll: roll.toJSON ? roll.toJSON() : roll,
      });
    }
    this.render();
  }

  /**
   * Attempt to perform an inline check via InlineRollLinks.
   * @private
   */
  async _performInlineCheck({ actor, event, inlineCommand }) {
    if (!InlineRollLinks) return null;

    const context = { actor, event, inlineCommand };

    try {
      if (typeof InlineRollLinks.inlineLink === "function") {
        return await InlineRollLinks.inlineLink(inlineCommand, { actor, event });
      }

      if (typeof InlineRollLinks.rollInline === "function") {
        return await InlineRollLinks.rollInline(inlineCommand, { actor, event });
      }

      if (typeof InlineRollLinks.roll === "function") {
        return await InlineRollLinks.roll({ actor, event, inline: inlineCommand });
      }

      if (typeof InlineRollLinks.createInlineRoll === "function") {
        return await InlineRollLinks.createInlineRoll(inlineCommand, { actor, event });
      }
    } catch (error) {
      console.warn("PF2E Points Tracker | Inline roll failed", context, error);
    }

    return null;
  }

  /**
   * Extract a Roll from whatever InlineRollLinks returned.
   * @private
   */
  _extractRollFromInlineResult(result) {
    if (!result) return null;

    if (result instanceof Roll) return result;
    if (result.roll instanceof Roll) return result.roll;
    if (result.result instanceof Roll) return result.result;
    if (result.check?.roll instanceof Roll) return result.check.roll;

    const message = result instanceof ChatMessage ? result : result.message;
    const rollCandidates = [
      ...(Array.isArray(result.rolls) ? result.rolls : []),
      ...(message?.rolls ?? []),
    ].filter((rollCandidate) => rollCandidate instanceof Roll);

    return rollCandidates.at(-1) ?? null;
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
