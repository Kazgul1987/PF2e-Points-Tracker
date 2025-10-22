import { PointsTrackerApp } from "../apps/points-tracker-app.js";

/**
 * Register the research tracker control on the notes scene controls.
 *
 * @param {object} trackers
 * @param {import("../research/tracker.js").ResearchTracker} trackers.researchTracker
 * @param {import("../reputation/reputation-tracker.js").ReputationTracker} trackers.reputationTracker
 */
export function registerResearchTrackerControl({ researchTracker, reputationTracker }) {
  Hooks.on("getSceneControlButtons", (controls) => {
    const notesControl = controls.find((control) => control.name === "notes");
    if (!notesControl) return;

    notesControl.tools = notesControl.tools ?? [];

    const hasResearchTool = notesControl.tools.some((tool) => tool?.name === "research-tracker");
    if (hasResearchTool) return;

    const localizedTitle = game.i18n.localize("PF2E.PointsTracker.Research.Title");
    const openTracker = () => PointsTrackerApp.open({ researchTracker, reputationTracker });

    notesControl.tools.push({
      name: "research-tracker",
      title: localizedTitle,
      icon: "fas fa-flask",
      button: true,
      onClick: openTracker,
      onChange: openTracker,
    });
  });
}
