import { createResearchTracker } from "./research/tracker.js";
import { createReputationTracker } from "./reputation/reputation-tracker.js";
import { PointsTrackerApp } from "./apps/points-tracker-app.js";
import { ResearchImportExport } from "./research/importer.js";
import { registerResearchAutoUpdates } from "./research/auto-update.js";

const MODULE_ID = "pf2e-points-tracker";
const RESEARCH_SETTING_KEY = "research-tracker-state";
const REPUTATION_SETTING_KEY = "reputation-tracker-state";

const researchTracker = createResearchTracker({
  moduleId: MODULE_ID,
  settingKey: RESEARCH_SETTING_KEY,
});
const reputationTracker = createReputationTracker({
  moduleId: MODULE_ID,
  settingKey: REPUTATION_SETTING_KEY,
});

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing PF2e Points Tracker module.`);
  researchTracker.registerSettings();
  reputationTracker.registerSettings();

  PointsTrackerApp.preloadTemplates?.();

  const moduleData = game.modules.get(MODULE_ID);
  if (moduleData) {
    moduleData.api = moduleData.api ?? {};
    Object.assign(moduleData.api, {
      tracker: researchTracker,
      researchTracker,
      reputationTracker,
      openResearchTracker: () => PointsTrackerApp.open({ researchTracker, reputationTracker }),
      openPointsTracker: () => PointsTrackerApp.open({ researchTracker, reputationTracker }),
      importResearchTopics: () => ResearchImportExport.promptImport(researchTracker),
      exportResearchTopics: () => ResearchImportExport.exportTopics(researchTracker),
    });
  }
});

Hooks.once("ready", async () => {
  console.log(`${MODULE_ID} | Starting PF2e Points Tracker initialization.`);

  try {
    await researchTracker.initialize();
    await reputationTracker.initialize();
  } catch (error) {
    console.error(`${MODULE_ID} | Failed to initialize PF2e Points Tracker.`, error);
    return;
  }

  console.log(`${MODULE_ID} | PF2e Points Tracker initialized successfully.`);

  registerResearchAutoUpdates(researchTracker);

  game.pf2ePointsTracker = {
    tracker: researchTracker,
    researchTracker,
    reputationTracker,
    open: () => PointsTrackerApp.open({ researchTracker, reputationTracker }),
    import: () => ResearchImportExport.promptImport(researchTracker),
    export: () => ResearchImportExport.exportTopics(researchTracker),
  };

  console.log(`${MODULE_ID} | PF2e Points Tracker global API registered.`);
});


Hooks.on("renderTokenHUD", (_app, html) => {
  html.find(".research-tracker-hud").remove();
  const button = $(
    `<div class="control-icon research-tracker-hud" data-action="research-tracker" title="${game.i18n.localize(
      "PF2E.PointsTracker.Research.Title"
    )}"><i class="fas fa-flask"></i></div>`
  );
  button.on("click", () => PointsTrackerApp.open({ researchTracker, reputationTracker }));
  html.find(".col.right").append(button);
});

Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  const isPF2eSheet = sheet?.actor?.system !== undefined && sheet.actor?.type !== undefined;
  if (!isPF2eSheet) return;
  buttons.unshift({
    class: "research-tracker-open",
    label: game.i18n.localize("PF2E.PointsTracker.Research.Title"),
    icon: "fas fa-flask",
    onclick: () => PointsTrackerApp.open({ researchTracker, reputationTracker }),
  });
});

export function openResearchTracker() {
  return PointsTrackerApp.open({ researchTracker, reputationTracker });
}
