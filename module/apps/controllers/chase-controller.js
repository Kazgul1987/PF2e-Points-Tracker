import { TrackerTabController, escapeAttribute, escapeHtml } from "./tracker-tab-controller.js";

/** Owns the chase tab context, dialogs, and event handling. */
export class ChaseController extends TrackerTabController {
  _initializeChaseTab() {
    if (this._initializedTabs.has("chase")) return;
    this._initializedTabs.add("chase");
    this.element.querySelector("[data-tab-panel='chase']")?.setAttribute("data-initialized", "true");
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
}
