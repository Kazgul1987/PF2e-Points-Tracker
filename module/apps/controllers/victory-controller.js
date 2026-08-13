import { TrackerTabController, escapeAttribute, escapeHtml } from "./tracker-tab-controller.js";

/** Owns the victory tab context, dialogs, and event handling. */
export class VictoryController extends TrackerTabController {
  _initializeVictoryTab() {
    if (this._initializedTabs.has("victory")) return;
    this._initializedTabs.add("victory");
    this.element.querySelector("[data-tab-panel='victory']")?.setAttribute("data-initialized", "true");
  }



  _prepareVictoryData({ isGM }) {
    const hasTracker = Boolean(this.victoryTracker);
    const hasAccess = Boolean(hasTracker);

    if (!hasAccess) {
      return {
        isGM,
        hasTracker,
        hasAccess,
        entries: [],
      };
    }

    const entries = this.victoryTracker.getEntries().map((entry) => {
      const minValue = Number.isFinite(entry.minValue) ? Number(entry.minValue) : 0;
      const rawMaxValue = Number(entry.maxValue);
      const maxValue = Number.isFinite(rawMaxValue) && rawMaxValue > 0 ? Math.max(rawMaxValue, minValue) : 0;
      let current = Number.isFinite(entry.current) ? Number(entry.current) : 0;
      if (current < minValue) current = minValue;
      if (maxValue && current > maxValue) current = maxValue;

      const progressPercent = maxValue > minValue
        ? Math.max(0, Math.min(100, Number(((current - minValue) / (maxValue - minValue)) * 100)))
        : Math.max(0, Math.min(100, Number(entry.progressPercent ?? 0)));
      const updatedAtFormatted = Number.isFinite(entry.updatedAt)
        ? new Date(entry.updatedAt).toLocaleString()
        : null;
      const maxLabel = maxValue || game.i18n.localize("PF2E.PointsTracker.Victory.NoMax");

      return {
        ...entry,
        minValue,
        maxValue,
        current,
        progressPercent,
        updatedAtFormatted,
        maxLabel,
        canIncrease: maxValue ? current < maxValue : true,
        canDecrease: current > minValue,
      };
    });

    return {
      isGM,
      hasTracker,
      hasAccess,
      entries,
    };
  }

  async _onCreateVictoryEntry(event) {
    event.preventDefault();
    if (!this.victoryTracker) return;

    const result = await this._promptVictoryDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Victory.CreateEntry"),
      label: game.i18n.localize("PF2E.PointsTracker.Victory.Create"),
    });
    if (!result) return;

    await this.victoryTracker.createEntry(result);
    this.render();
  }

  async _onEditVictoryEntry(event) {
    event.preventDefault();
    if (!this.victoryTracker) return;

    const entryId = event.currentTarget.closest("[data-victory-id]")?.dataset.victoryId;
    if (!entryId) return;

    const entry = this.victoryTracker.getEntry(entryId);
    if (!entry) return;

    const result = await this._promptVictoryDialog({
      title: game.i18n.localize("PF2E.PointsTracker.Victory.EditEntry"),
      label: game.i18n.localize("PF2E.PointsTracker.Victory.Save"),
      initial: entry,
    });
    if (!result) return;

    await this.victoryTracker.updateEntry(entryId, result);
    this.render();
  }

  async _onDeleteVictoryEntry(event) {
    event.preventDefault();
    if (!this.victoryTracker) return;

    const entryId = event.currentTarget.closest("[data-victory-id]")?.dataset.victoryId;
    if (!entryId) return;

    const entry = this.victoryTracker.getEntry(entryId);
    if (!entry) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("PF2E.PointsTracker.Victory.DeleteEntry"),
      content: `<p>${game.i18n.format("PF2E.PointsTracker.Victory.DeleteConfirm", {
        name: escapeHtml(entry.name),
      })}</p>`,
      yes: () => true,
      no: () => false,
      defaultYes: false,
    });
    if (!confirmed) return;

    await this.victoryTracker.deleteEntry(entryId);
    this.render();
  }

  async _onAdjustVictoryEntry(event) {
    event.preventDefault();
    if (!this.victoryTracker) return;

    const button = event.currentTarget;
    const entryId = button.closest("[data-victory-id]")?.dataset.victoryId;
    if (!entryId) return;
    const delta = Number(button.dataset.delta ?? 0);
    if (!Number.isFinite(delta) || delta === 0) return;

    await this.victoryTracker.adjustVictory(entryId, delta, { notify: false });
    this.render();
  }

  async _promptVictoryDialog({ title, label, initial = {} }) {
    const defaultMin = Number.isFinite(initial.minValue) ? Math.max(0, Math.floor(initial.minValue)) : 0;
    const defaultMaxRaw = Number(initial.maxValue);
    const defaultMax = Number.isFinite(defaultMaxRaw) && defaultMaxRaw > 0
      ? Math.max(Math.floor(defaultMaxRaw), defaultMin)
      : 0;
    const defaultCurrentRaw = Number(initial.current);
    let defaultCurrent = Number.isFinite(defaultCurrentRaw) ? Math.floor(defaultCurrentRaw) : defaultMin;
    if (defaultCurrent < defaultMin) defaultCurrent = defaultMin;
    if (defaultMax && defaultCurrent > defaultMax) defaultCurrent = defaultMax;

    const template = `
      <form class="flexcol points-tracker-dialog">
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Victory.EntryName")}</label>
          <input type="text" name="name" value="${escapeAttribute(initial.name ?? "")}" required />
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Victory.MinValue")}</label>
          <input type="number" name="minValue" min="0" step="1" value="${escapeAttribute(defaultMin)}" />
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Victory.MaxValue")}</label>
          <input type="number" name="maxValue" min="0" step="1" value="${escapeAttribute(defaultMax)}" />
        </div>
        <div class="form-group form-group--split">
          <label>${game.i18n.localize("PF2E.PointsTracker.Victory.CurrentValue")}</label>
          <input type="number" name="current" min="0" step="1" value="${escapeAttribute(defaultCurrent)}" />
        </div>
        <div class="form-group">
          <label>${game.i18n.localize("PF2E.PointsTracker.Victory.Notes")}</label>
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
                  game.i18n.localize("PF2E.PointsTracker.Victory.NameRequired")
                );
                resolve(null);
                return;
              }

              const minValueRaw = Number(formData.get("minValue"));
              let minValue = Number.isFinite(minValueRaw) ? Math.floor(minValueRaw) : defaultMin;
              if (minValue < 0) minValue = 0;

              const maxValueRaw = Number(formData.get("maxValue"));
              let maxValue = Number.isFinite(maxValueRaw) ? Math.floor(maxValueRaw) : defaultMax;
              if (maxValue < 0) maxValue = 0;
              if (maxValue && maxValue < minValue) maxValue = minValue;

              const currentRaw = Number(formData.get("current"));
              let current = Number.isFinite(currentRaw) ? Math.floor(currentRaw) : defaultCurrent;
              if (current < minValue) current = minValue;
              if (maxValue && current > maxValue) current = maxValue;

              const notes = String(formData.get("notes") ?? "").trim();

              resolve({ name, minValue, maxValue, current, notes });
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
