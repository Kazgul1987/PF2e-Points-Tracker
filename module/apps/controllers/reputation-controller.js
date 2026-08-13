import { TrackerTabController, escapeAttribute, escapeHtml } from "./tracker-tab-controller.js";

/** Owns the reputation tab context, dialogs, and event handling. */
export class ReputationController extends TrackerTabController {
  _initializeReputationTab() {
    if (this._initializedTabs.has("reputation")) return;
    this._initializedTabs.add("reputation");
    this.element.querySelector("[data-tab-panel='reputation']")?.setAttribute("data-initialized", "true");
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
}
