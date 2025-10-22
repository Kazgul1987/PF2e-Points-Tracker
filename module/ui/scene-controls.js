import { ResearchTrackerApp } from "../apps/research-tracker-app.js";

/**
 * Register the research tracker control on the notes scene controls.
 *
 * @param {import("../research/tracker.js").ResearchTracker} tracker
 */
export function registerResearchTrackerControl(tracker) {
  Hooks.on("getSceneControlButtons", (controls) => {
    const notesControl = controls.find((control) => control.name === "notes");
    if (!notesControl) return;

    notesControl.tools = notesControl.tools ?? [];

    const hasResearchTool = notesControl.tools.some((tool) => tool?.name === "research-tracker");
    if (hasResearchTool) return;

    const localizedTitle = game.i18n.localize("PF2E.PointsTracker.Research.Title");
    const openTracker = () => ResearchTrackerApp.open(tracker);

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
