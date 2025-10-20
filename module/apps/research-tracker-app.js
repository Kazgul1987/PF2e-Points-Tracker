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
  getData() {
    const topics = this.tracker.getTopics();
    const log = this.tracker.getLog()
      .slice()
      .reverse()
      .map((entry) => ({
        ...entry,
        timestampFormatted: new Date(entry.timestamp).toLocaleString(),
        rollSummary: this._formatRoll(entry.roll),
      }));
    const isGM = game.user?.isGM ?? false;

    return {
      isGM,
      topics: topics.map((topic) => ({
        ...topic,
        completed: topic.target > 0 && topic.progress >= topic.target,
        thresholds: (topic.thresholds ?? []).map((threshold) => ({
          ...threshold,
          isUnlocked: topic.progress >= threshold.points,
          isRevealed:
            Array.isArray(topic.revealedThresholdIds)
              ? topic.revealedThresholdIds.includes(threshold.id)
              : Boolean(threshold.revealedAt),
        })),
      })),
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
      </form>
    `;

    const data = await Dialog.prompt({
      title: game.i18n.localize("PF2E.PointsTracker.Research.CreateTopic"),
      content: template,
      label: game.i18n.localize("PF2E.PointsTracker.Research.Create"),
      callback: (html) => {
        const form = html[0].querySelector("form");
        const fd = new FormData(form);
        return {
          name: fd.get("name")?.toString().trim() || undefined,
          target: Number(fd.get("target")) || 0,
          skill: fd.get("skill")?.toString().trim() || undefined,
          difficulty: fd.get("difficulty")?.toString().trim() || undefined,
          summary: fd.get("summary")?.toString().trim() || undefined,
        };
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

    const template = `
      <form class="flexcol">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Research.PointChange")}</label>
          <input type="number" name="points" value="${direction > 0 ? 1 : -1}" step="1" />
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
        };
      },
      rejectClose: false,
    });

    if (!response) return;

    await this.tracker.adjustPoints(topicId, response.points, {
      reason: response.reason,
    });
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
    if (!participant?.actorUuid) {
      ui.notifications.warn(game.i18n.localize("PF2E.PointsTracker.Research.NoActor"));
      return;
    }

    const actor = await fromUuid(participant.actorUuid);
    if (!(actor?.skills)) {
      ui.notifications.warn(game.i18n.localize("PF2E.PointsTracker.Research.ActorMissingSkills"));
      return;
    }

    const skillKey = participant.skill || this.tracker.getTopic(topicId)?.skill;
    const skill = actor.skills[skillKey];
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

    const adjustment = await this._promptForPoints(roll.total);
    if (!adjustment) return;

    await this.tracker.adjustPoints(topicId, adjustment.points, {
      actorUuid: participant.actorUuid,
      actorName: participant.name,
      reason: adjustment.reason,
      roll: roll.toJSON ? roll.toJSON() : roll,
    });
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
   * Ask the user how many points were gained or lost from a roll.
   * @param {number} rollTotal
   */
  async _promptForPoints(rollTotal) {
    const template = `
      <form class="flexcol">
        <p>${game.i18n.format("PF2E.PointsTracker.Research.RollResult", { total: rollTotal ?? "--" })}</p>
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
        };
      },
      rejectClose: false,
    });
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
