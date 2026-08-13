# Foundry V14 refactor notes

## Current architecture and dependencies

The module creates six singleton domain trackers in `module/main.js`. Research and Influence
already normalize setting data, apply remote `onChange` values locally, and emit hooks. The four
smaller trackers duplicated persistence and normalization, while three did not listen for remote
world-setting changes. The UI combined all tab context, dialogs, PF2e rolls, actor lookup, and event
binding in one Application V1 file.

Foundry coupling consists primarily of settings, hooks, Application rendering, Dialog, UUID lookup,
TextEditor enrichment, and ChatMessage. PF2e coupling is limited to actor statistics (`getStatistic`
or `skills` compatibility fallback) and statistic rolls. The local PF2e reference confirms that
Actor UUID resolution through Foundry's `fromUuid` and rolling a public PF2e Statistic are the least
coupled available approaches.

## Migration decisions and risks

1. Keep all setting keys and serialized shapes unchanged.
2. Separate remote state application from persistence so `onChange` never writes a setting.
3. Require GM permission in persistent domain mutations; reading and PF2e rolls remain available to
   players. UI checks remain an additional UX boundary.
4. Move the research Application behavior to a tab controller and make the shell an
   `ApplicationV2` with a Handlebars part. Existing jQuery listener code is temporarily isolated in
   the tab controllers to reduce regression risk and can be converted action-by-action later.
5. Keep both public API surfaces and their existing property names.

The highest-risk areas for manual validation are Dialog V1 interoperability, drag/drop on synthetic
token actors, PF2e Statistic roll parameters, and concurrent settings updates. The migration order
used was shared utilities, synchronized tracker state, ApplicationV2 shell, UI extraction, manifest,
then static validation.

## Manual Foundry V14 test matrix

- Open the tracker as GM and player; verify every permitted tab, pop-out sizing, and scene changes.
- Change points with two clients open; verify the player updates once without a settings write loop.
- Exercise Research and Influence rolls, reveal/resend, deletion, and all dialogs.
- Drag world and synthetic-token actors, assign them, then rename and delete the source actor; verify a
  missing UUID degrades to stored display data without preventing rendering.
- Import valid legacy/current Research and Influence JSON, reject malformed JSON, and export again.
- Reload the world and each browser; verify old settings, logs, thresholds, hidden state, and progress.
- Exercise Chase obstacles/progress/assignment, Reputation changes/logs, Victory thresholds/progress,
  and GM-only Awareness status.
