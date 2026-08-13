import { AwarenessController } from "./awareness-controller.js";
import { ChaseController } from "./chase-controller.js";
import { InfluenceController } from "./influence-controller.js";
import { ReputationController } from "./reputation-controller.js";
import { VictoryController } from "./victory-controller.js";
import { ResearchTrackerApp } from "./research-controller.js";
const MODULE_ID = "pf2e-points-tracker";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const POINTS_TRACKER_PARTIALS = [
  `modules/${MODULE_ID}/module/templates/partials/research-tab.hbs`,
  `modules/${MODULE_ID}/module/templates/partials/reputation-tab.hbs`,
  `modules/${MODULE_ID}/module/templates/partials/victory-tab.hbs`,
  `modules/${MODULE_ID}/module/templates/partials/awareness-tab.hbs`,
  `modules/${MODULE_ID}/module/templates/partials/chase-tab.hbs`,
  `modules/${MODULE_ID}/module/templates/partials/influence-tab.hbs`,
];

export class PointsTrackerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {import("../research/tracker.js").ResearchTracker} [options.researchTracker]
   * @param {import("../reputation/reputation-tracker.js").ReputationTracker} [options.reputationTracker]
   * @param {import("../awareness/awareness-tracker.js").AwarenessTracker} [options.awarenessTracker]
   * @param {import("../victory/victory-tracker.js").VictoryTracker} [options.victoryTracker]
   * @param {import("../chase/tracker.js").ChaseTracker} [options.chaseTracker]
   * @param {object} [renderOptions]
   */
  constructor(
    {
      researchTracker = null,
      reputationTracker = null,
      awarenessTracker = null,
      victoryTracker = null,
      chaseTracker = null,
      influenceTracker = null,
    } = {},
    renderOptions = {}
  ) {
    super(renderOptions);
    this.tracker = researchTracker;
    this._dragDropHandlers = [];
    this._expandedTopics = new Set();
    this.researchTracker = researchTracker ?? null;
    this.reputationTracker = reputationTracker ?? null;
    this.awarenessTracker = awarenessTracker ?? null;
    this.victoryTracker = victoryTracker ?? null;
    this.chaseTracker = chaseTracker ?? null;
    this.influenceTracker = influenceTracker ?? null;
    this.tracker = this.researchTracker ?? this.tracker ?? null;
    this._activeTab = renderOptions?.activeTab ?? "research";
    this.options.activeTab = this._activeTab;
    this._initializedTabs = new Set();
    this._collapsedInfluenceLogs = {
      session: false,
      npcs: new Map(),
    };
    this._localInfluenceNpcState = new Map();
    this.controllers = {
      influence: new InfluenceController(this),
      chase: new ChaseController(this),
      reputation: new ReputationController(this),
      victory: new VictoryController(this),
      awareness: new AwarenessController(this),
    };
  }

  static DEFAULT_OPTIONS = {
    id: "points-tracker-app",
    classes: ["pf2e-points-tracker"],
    position: { width: 720, height: "auto" },
    window: { resizable: true },
    actions: {
      "switch-tab": PointsTrackerApp._onSwitchTab,
      "create-faction": PointsTrackerApp._onReputationAction,
      "edit-faction": PointsTrackerApp._onReputationAction,
      "delete-faction": PointsTrackerApp._onReputationAction,
      "adjust-reputation": PointsTrackerApp._onReputationAction,
      "create-awareness-entry": PointsTrackerApp._onAwarenessAction,
      "edit": PointsTrackerApp._onAwarenessAction,
      "delete": PointsTrackerApp._onAwarenessAction,
      "adjust": PointsTrackerApp._onAwarenessAction,
      "create-victory-entry": PointsTrackerApp._onVictoryAction,
      "edit-victory": PointsTrackerApp._onVictoryAction,
      "delete-victory": PointsTrackerApp._onVictoryAction,
      "adjust-victory": PointsTrackerApp._onVictoryAction,
    },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/module/templates/points-tracker.hbs` },
  };

  get title() {
    return game.i18n.localize("PF2E.PointsTracker.PointsTrackerTitle");
  }

  static async preloadTemplates() {
    if (typeof loadTemplates !== "function") return;
    if (!this._preloadPromise) {
      this._preloadPromise = loadTemplates(POINTS_TRACKER_PARTIALS);
    }
    await this._preloadPromise;
  }

  static open({
    researchTracker = null,
    reputationTracker = null,
    awarenessTracker = null,
    victoryTracker = null,
    chaseTracker = null,
    influenceTracker = null,
    activeTab = null,
  } = {}) {
    if (!this._instance) {
      this._instance = new this(
        {
          researchTracker,
          reputationTracker,
          awarenessTracker,
          victoryTracker,
          chaseTracker,
          influenceTracker,
        },
        { activeTab: activeTab ?? "research" }
      );
    } else {
      if (researchTracker) {
        this._instance.researchTracker = researchTracker;
        this._instance.tracker = researchTracker;
      }
      if (reputationTracker) {
        this._instance.reputationTracker = reputationTracker;
      }
      if (awarenessTracker) {
        this._instance.awarenessTracker = awarenessTracker;
      }
      if (victoryTracker) {
        this._instance.victoryTracker = victoryTracker;
      }
      if (chaseTracker) {
        this._instance.chaseTracker = chaseTracker;
      }
      if (influenceTracker) {
        this._instance.influenceTracker = influenceTracker;
      }
      if (activeTab) {
        this._instance.activeTab = activeTab;
      }
    }
    this._instance.render({ force: true });
    return this._instance;
  }

  get activeTab() {
    const candidate = this._activeTab ?? "research";
    if (candidate === "awareness" && !this._canAccessAwareness()) {
      return "research";
    }
    if (candidate === "victory" && !this._canAccessVictory()) {
      return "research";
    }
    if (candidate === "influence" && !this.influenceTracker) {
      return "research";
    }
    return candidate;
  }

  set activeTab(value) {
    const allowedTabs = new Set(["research", "reputation", "chase"]);
    if (this._canAccessAwareness()) {
      allowedTabs.add("awareness");
    }
    if (this._canAccessVictory()) {
      allowedTabs.add("victory");
    }
    if (this.influenceTracker) {
      allowedTabs.add("influence");
    }
    const normalized = allowedTabs.has(value) ? value : "research";
    this._activeTab = normalized;
    this.options.activeTab = this._activeTab;
  }

  _canAccessAwareness() {
    const isGM = game.user?.isGM ?? false;
    return Boolean(isGM && this.awarenessTracker);
  }

  _canAccessVictory() {
    return Boolean(this.victoryTracker);
  }

  async _prepareContext(options) {
    const isGM = game.user?.isGM ?? false;

    let researchData = {
      isGM,
      topics: [],
      log: [],
      hasTracker: Boolean(this.researchTracker),
    };
    if (this.researchTracker) {
      researchData = await ResearchTrackerApp.prototype._prepareContext.call(this, options);
      researchData.hasTracker = true;
    }

    const reputationData = this.controllers.reputation._prepareReputationData({ isGM });
    const awarenessData = this.controllers.awareness._prepareAwarenessData({ isGM });
    const victoryData = this.controllers.victory._prepareVictoryData({ isGM });
    const chaseData = this.controllers.chase._prepareChaseData({ isGM });
    const influenceData = await this.controllers.influence._prepareInfluenceData({ isGM });

    const activeTab = this.activeTab;
    return {
      activeTab,
      isResearchActive: activeTab === "research",
      isReputationActive: activeTab === "reputation",
      isVictoryActive: activeTab === "victory",
      isAwarenessActive: activeTab === "awareness",
      isChaseActive: activeTab === "chase",
      isInfluenceActive: activeTab === "influence",
      isGM,
      research: researchData,
      reputation: reputationData,
      victory: victoryData,
      awareness: awarenessData,
      chase: chaseData,
      influence: influenceData,
    };
  }

  _onRender(context, options) {
    if (this.researchTracker) ResearchTrackerApp.prototype._onRender.call(this, context, options);
    else super._onRender(context, options);
    const html = globalThis.jQuery(this.element);

    this._applyActiveTab();

    if (this.activeTab === "reputation") {
      this.controllers.reputation._initializeReputationTab();
    }
    if (this.activeTab === "awareness") {
      this.controllers.awareness._initializeAwarenessTab();
    }
    if (this.activeTab === "victory") {
      this.controllers.victory._initializeVictoryTab();
    }
    if (this.activeTab === "chase") {
      this.controllers.chase._initializeChaseTab();
    }
    if (this.activeTab === "influence") {
      this.controllers.influence._initializeInfluenceTab();
    }

    if (this.chaseTracker) {
      this.controllers.chase._activateChaseListeners(html);
    }
    if (this.influenceTracker) {
      this.controllers.influence._activateInfluenceListeners(html);
    }
  }

  static _dispatchControllerAction(event, target, controllerName, handlers) {
    const handler = handlers[target?.dataset.action];
    if (!handler) return;
    const actionEvent = new Proxy(event, {
      get(source, property) {
        if (property === "currentTarget") return target;
        const value = source[property];
        return typeof value === "function" ? value.bind(source) : value;
      },
    });
    return this.controllers[controllerName][handler](actionEvent);
  }

  static _onReputationAction(event, target) {
    return this._dispatchControllerAction(event, target, "reputation", {
      "create-faction": "_onCreateFaction",
      "edit-faction": "_onEditFaction",
      "delete-faction": "_onDeleteFaction",
      "adjust-reputation": "_onAdjustFaction",
    });
  }

  static _onAwarenessAction(event, target) {
    return this._dispatchControllerAction(event, target, "awareness", {
      "create-awareness-entry": "_onCreateAwarenessEntry",
      edit: "_onEditAwarenessEntry",
      delete: "_onDeleteAwarenessEntry",
      adjust: "_onAdjustAwarenessEntry",
    });
  }

  static _onVictoryAction(event, target) {
    return this._dispatchControllerAction(event, target, "victory", {
      "create-victory-entry": "_onCreateVictoryEntry",
      "edit-victory": "_onEditVictoryEntry",
      "delete-victory": "_onDeleteVictoryEntry",
      "adjust-victory": "_onAdjustVictoryEntry",
    });
  }

  static _onSwitchTab(event, target) {
    event.preventDefault();
    const tab = target?.dataset.tab;
    if (tab === "awareness" && !this._canAccessAwareness()) return;
    if (tab === "victory" && !this._canAccessVictory()) return;
    if (tab === "influence" && !this.influenceTracker) return;
    if (!tab || tab === this.activeTab) return;
    this.activeTab = tab;
    this._applyActiveTab();
    const initializer = {
      reputation: ["reputation", "_initializeReputationTab"],
      awareness: ["awareness", "_initializeAwarenessTab"],
      victory: ["victory", "_initializeVictoryTab"],
      chase: ["chase", "_initializeChaseTab"],
      influence: ["influence", "_initializeInfluenceTab"],
    }[tab];
    if (initializer) this.controllers[initializer[0]][initializer[1]]();
  }

  _applyActiveTab() {
    const tab = this.activeTab;
    this.element.dataset.activeTab = tab;
    for (const element of this.element.querySelectorAll("[data-tab]")) {
      element.classList.toggle("is-active", element.dataset.tab === tab);
    }
    for (const element of this.element.querySelectorAll("[data-tab-panel]")) {
      element.classList.toggle("is-active", element.dataset.tabPanel === tab);
    }
  }

  _generateId() {
    if (typeof foundry !== "undefined" && foundry?.utils?.randomID) {
      return foundry.utils.randomID();
    }
    if (typeof crypto !== "undefined" && crypto?.randomUUID) {
      return crypto.randomUUID();
    }
    return Math.random().toString(36).slice(2, 10);
  }

  /** @private */

  /** @private */

  /** @private */

  /** @private */

}

// Research UI behavior is implemented in its subsystem controller and composed into the main app.
for (const name of Object.getOwnPropertyNames(ResearchTrackerApp.prototype)) {
  if (["constructor", "_prepareContext", "_onRender"].includes(name)) continue;
  if (Object.prototype.hasOwnProperty.call(PointsTrackerApp.prototype, name)) continue;
  Object.defineProperty(
    PointsTrackerApp.prototype,
    name,
    Object.getOwnPropertyDescriptor(ResearchTrackerApp.prototype, name)
  );
}

export { ResearchTrackerApp };
