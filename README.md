# PF2e Points Tracker

## Overview
PF2e Points Tracker is a Foundry Virtual Tabletop module designed to help Gamemasters and players manage Pathfinder Second Edition research points. It centralizes point totals, tracks progress across topics, and keeps all participants informed about the state of collaborative research scenes.

## Installation
### Install via Manifest URL
1. In Foundry VTT, open the **Add-on Modules** tab from the Configuration and Setup screen.
2. Click **Install Module** and paste the manifest URL:
   ```
   https://lutece239.github.io/PF2e-Points-Tracker/module.json
   ```
3. Click **Install** to download the latest release directly into Foundry.

### Manual Installation from GitHub Releases
1. Visit the [PF2e Points Tracker releases page](https://github.com/Lutece239/PF2e-Points-Tracker/releases) and download the latest `zip` archive.
2. Extract the archive into your Foundry user data directory under `Data/modules/pf2e-points-tracker` (create the folder if it does not exist).
3. Restart Foundry VTT. The module should now appear in the **Add-on Modules** list.

## Configuration
1. Launch your PF2e world and open **Game Settings → Manage Modules**.
2. Enable **PF2e Points Tracker** for the world.
3. Optionally adjust any PF2e system settings related to research scenes so that the module integrates with your preferred workflow.

## Key Features and Usage
- **Research Point Dashboard** – View current point totals for active research topics directly within Foundry VTT.
- **Automated Tracking** – Update totals as players earn or spend research points during gameplay, keeping everyone synchronized.
- **Session Transparency** – Present up-to-date information to the table without relying on external spreadsheets.

To use the tracker in play:
1. Open the module's interface from the PF2e system controls sidebar.
2. Select or create the relevant research topics for your scene.
3. Add or subtract points as the party progresses; the display updates in real time for all connected clients.

## Maintenance and Support
Issues and feature requests are welcome through the [GitHub issue tracker](https://github.com/Lutece239/PF2e-Points-Tracker/issues). If you would like to contribute improvements, please submit a pull request with a clear description of your changes. For questions about module usage, contact the maintainer via GitHub.

## Import Chase Events

As GM, open the Chase tab and choose **Import events** (**Events importieren**).
Select a JSON file containing a single event, an array of events, or an object
with an `events` array. For example:

```json
{
  "events": [
    {
      "name": "Rooftop pursuit",
      "description": "Catch the courier before the city gates.",
      "obstacles": [
        {
          "name": "Jump the alley",
          "description": "Athletics or Acrobatics DC 20",
          "requiredPoints": 4,
          "resolutionMode": "individual"
        }
      ],
      "opportunities": [
        { "name": "Market shortcut", "description": "A merchant knows a faster route." }
      ]
    }
  ]
}
```

Every event, obstacle and opportunity requires a nonempty `name`. Descriptions
are optional strings. `requiredPoints` defaults to 0 (open-ended progress) and
must be a nonnegative finite number; `resolutionMode` defaults to `group` and
also accepts `individual`. Obstacles and opportunities may be omitted.
The entire file is validated before saving. Existing events and logs are kept.
Imported entries receive new IDs, start hidden, and have no progress or actor
assignments; importing the same file again creates additional events.

Run import tests with `node tests/chase-import.test.mjs` (Node.js 24).
