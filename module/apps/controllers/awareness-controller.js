import { TrackerTabController, escapeAttribute, escapeHtml } from "./tracker-tab-controller.js";

/** Owns the awareness tab context, dialogs, and event handling. */
export class AwarenessController extends TrackerTabController {
  _initializeAwarenessTab() {
    if (this._initializedTabs.has("awareness")) return;
    this._initializedTabs.add("awareness");
    this.element.querySelector("[data-tab-panel='awareness']")?.setAttribute("data-initialized", "true");
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
