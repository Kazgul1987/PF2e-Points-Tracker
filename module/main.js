import { createResearchTracker } from "./research/tracker.js";
import { ResearchTrackerApp } from "./apps/research-tracker-app.js";
import { ResearchImportExport } from "./research/importer.js";

const MODULE_ID = "pf2e-points-tracker";
const SETTING_KEY = "research-tracker-state";

const tracker = createResearchTracker({ moduleId: MODULE_ID, settingKey: SETTING_KEY });

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing PF2e Points Tracker module.`);
  tracker.registerSettings();

  const moduleData = game.modules.get(MODULE_ID);
  if (moduleData) {
    moduleData.api = moduleData.api ?? {};
    Object.assign(moduleData.api, {
      tracker,
      openResearchTracker: () => ResearchTrackerApp.open(tracker),
      importResearchTopics: () => ResearchImportExport.promptImport(tracker),
      exportResearchTopics: () => ResearchImportExport.exportTopics(tracker),
    });
  }
});

Hooks.once("ready", async () => {
  console.log(`${MODULE_ID} | Starting PF2e Points Tracker initialization.`);

  try {
    await tracker.initialize();
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to initialize PF2e Points Tracker.`, error);
    return;
  }

  console.log(`${MODULE_ID} | PF2e Points Tracker initialized successfully.`);

  game.pf2ePointsTracker = {
    tracker,
    open: () => ResearchTrackerApp.open(tracker),
    import: () => ResearchImportExport.promptImport(tracker),
    export: () => ResearchImportExport.exportTopics(tracker),
  };

  console.log(`${MODULE_ID} | PF2e Points Tracker global API registered.`);
});

Hooks.on("getSceneControlButtons", (controls) => {
  const tokenControls = controls.find((control) => control.name === "token");
  if (!tokenControls) return;
  if (tokenControls.tools.some((tool) => tool.name === "research-tracker")) return;

  tokenControls.tools.push({
    name: "research-tracker",
    title: game.i18n.localize("PF2E.PointsTracker.Research.Title"),
    icon: "fas fa-flask",
    onClick: () => ResearchTrackerApp.open(tracker),
    button: true,
  });
});

Hooks.on("renderTokenHUD", (_app, html) => {
  html.find(".research-tracker-hud").remove();
  const button = $(
    `<div class="control-icon research-tracker-hud" data-action="research-tracker" title="${game.i18n.localize(
      "PF2E.PointsTracker.Research.Title"
    )}"><i class="fas fa-flask"></i></div>`
  );
  button.on("click", () => ResearchTrackerApp.open(tracker));
  html.find(".col.right").append(button);
});

Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  const isPF2eSheet = sheet?.actor?.system !== undefined && sheet.actor?.type !== undefined;
  if (!isPF2eSheet) return;
  buttons.unshift({
    class: "research-tracker-open",
    label: game.i18n.localize("PF2E.PointsTracker.Research.Title"),
    icon: "fas fa-flask",
    onclick: () => ResearchTrackerApp.open(tracker),
  });
});

export function openResearchTracker() {
  return ResearchTrackerApp.open(tracker);
}
