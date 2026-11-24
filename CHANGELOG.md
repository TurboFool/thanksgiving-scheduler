# Changelog

All notable changes to **ThymeLine** (formerly HarvestLine) are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.14.3] — 2026-11-24

### Improved
- **Pinned Gemini Running Status Indicator (`GeminiModal.tsx`)**: Moved the active Gemini running status (`verifyStatus` / `Evaluating...` / `Generating...`) into the pinned `.modal-footer` to the left of the **Close** button so it remains visible when chat replies scroll the modal body.

---

## [2.14.2] — 2026-11-24

### Improved
- **Default Schedule Evaluation Prompt (`GeminiModal.tsx`)**: Updated the initial prompt sent to Gemini when clicking **Evaluate Current Schedule** to explicitly ask for optimal appliance and operating mode choices (e.g., `Convection` vs. `Bake`), preheat/cooldown temperature gaps, and explanations of how and why mode/appliance trade-offs were decided.

---

## [2.14.1] — 2026-11-24

### Fixed & Improved
- **Gemini Mode Steering & Context (`gemini.ts`, `GeminiModal.tsx`)**:
  - Updated `processMealItemWithGemini` to include appliance `supportedModes` and `applianceMode`/`modePreference` in step schemas.
  - Updated `evaluateAndAdjustScheduleWithGemini` to include step `notes`, dish notes, and scheduler `effectiveMode`/`modeDecisionNote`, instructing Gemini to infer missing modes (such as `Convection`) from notes and explicitly explain *how and why* one mode was chosen over another in `reply` and `reason`.
  - Displayed `applianceMode` on proposed timeline adjustments in `GeminiModal`.
- **Preferred Mode Steering & Fallback Explanations (`scheduler.ts`, `types.ts`, `App.tsx`, `GanttTimeline.tsx`, `planFormatter.ts`, `index.css`)**:
  - Updated `computeSchedule` to strongly steer `preferred`-mode steps to mode-supporting appliances whenever they meet the target finish time, falling back only if busy/late or to share a slot, and recording `effectiveMode` and `modeDecisionNote`.
  - Surfaced `modeDecisionNote` via `.pill.mode-fallback` (`ⓘ`) badges and tooltips on step cards, Gantt bars, and exported/printed plans.

---

## [2.14.0] — 2026-11-24

### Added & Improved
- **Unified Appliance Mode Indicators Across All Views (`App.tsx`, `GanttTimeline.tsx`, `MealItemModal.tsx`, `planFormatter.ts`, `index.css`)**:
  - Added distinct `.pill.mode` badges and unified `Appliance · Mode` labels across **Active Timers**, **Up Next**, **Dish Steps**, **Meal Item Modal** steps, **Gantt Timeline** bars/narrow callouts/tooltips, and **Print / Export** plans.
- **Preheat & Cooldown Transition Scheduling (`scheduler.ts`, `ApplianceModal.tsx`, `GanttTimeline.tsx`, `App.tsx`)**:
  - Automatically enforces preheat (`5m` per `50°F` up, 5–20m) and cooldown (`5m` per `25°F` down, 5–30m) transition buffers between sequential uses of a temperature-controlled appliance when temperature changes beyond `tempTolerance`, with optional per-appliance `Preheat (m)` / `Cooldown (m)` overrides in `ApplianceModal`.
  - Renders hatched **Preheat / Cool** transition bands on the Gantt timeline and transition pills on step cards.
- **Gemini Skill Versioning (`gemini.ts`, `GeminiModal.tsx`, `GEMINI.md`, `PROJECT_OVERVIEW.md`)**:
  - Added `GEMINI_SKILL_VERSION` (`1.1.0`) displayed in `GeminiModal` and embedded in `buildGeminiSkillInstructions()`, updated the skill with `applianceMode` / `modePreference` and preheat/cooldown rules, and documented the mandatory rule to bump the skill version and alert the user when app changes affect it.

---

## [2.13.1] — 2026-11-24

### Improved
- **Kitchen Mode Step Title Tooltips (`App.tsx`)**: Added `title={s.title}` tooltips on step titles across **Dish Steps**, **Active Timers**, **Up Next**, and **Completed** lists so hovering over any truncated step name shows the full title.

---

## [2.13.0] — 2026-11-23

### Improved & Added
- **Spacious 2-Row Kitchen Mode Cards (`index.css`, `App.tsx`)**: Restructured **Up Next** and **Dish Steps** cards into a clean 2-row stacked layout (Title + action buttons on top; full-width editable start/end times, duration, appliance, mode, temp, and delay pills below) so elements never wrap awkwardly or collide.
- **Older Cloud Backup Warning (`SyncModal.tsx`)**: Checking in from the cloud now warns before overwriting newer local changes when the cloud `syncVersion` (or `updatedAt`) is older than your local copy, offering **Load Older Cloud Backup Anyway** or **Keep Local & Update Cloud**.
- **Background Cloud Update Check on Load (`App.tsx`)**: Silently checks for a newer cloud backup on page load when a sync passcode is configured, displaying a non-intrusive **Newer cloud backup available** banner with a 1-click **Sync Down** button.

---

## [2.12.0] — 2026-11-23

### Added
- **Inline Kitchen Mode Start/End Time Editing (`App.tsx`)**: In both **Up Next** and **Dish Steps**, clicking any step's start time or end time opens an inline time picker (`HH:MM`) for exact minute-level rescheduling (undoable via Undo).
- **Explicit Edit Step Button**: Added a pencil **Edit Step** button directly on each Kitchen Mode step row to open `StepModal` for editing prep duration, appliance, mode, or dependencies.

---

## [2.11.1] — 2026-11-23

### Fixed
- **Appliance Modes Input (`ApplianceModal.tsx`)**: Buffered raw mode text in local `modesText` state and parsed comma-separated values on save so spaces and commas can be typed freely without being stripped mid-keystroke.

---

## [2.11.0] — 2026-11-23

### Added
- **Appliance Modes & Mutual Exclusivity (`types.ts`, `ApplianceModal.tsx`, `StepModal.tsx`, `scheduler.ts`)**:
  - Appliances now support an optional comma-separated **Modes** list (`supportedModes`, e.g., `Bake, Convection, Broil` on an Oven, or `Air Fryer, Toaster Oven, Toaster, Bake` on a Toaster Oven).
  - Steps can specify an optional **Appliance Mode** (`applianceMode`) with **Preferred** vs. **Required** enforcement (`modePreference`): `Preferred` prioritizes mode-matching appliances (like Convection on Bottom Oven) and falls back if needed, while `Required` strictly restricts placement.
  - **Mode Exclusivity**: `findValidPlacement` prevents conflicting modes (e.g., `Air Fryer` vs. `Toaster`, or `Convection` vs. `Bake`) from overlapping on the same appliance, while allowing matching modes at compatible temperatures to share racks.
  - Added mode badges on [`GanttTimeline.tsx`](file:///home/antigravity/TurboFool/thanksgiving-scheduler/src/components/GanttTimeline.tsx) and full `supportedModes` / `applianceMode` awareness in [`gemini.ts`](file:///home/antigravity/TurboFool/thanksgiving-scheduler/src/gemini.ts).

---

## [2.10.0] — 2026-11-23

### Added
- **Closed-Loop Schedule Verification (`evaluateAndVerifyScheduleWithGemini` in `gemini.ts`, `GeminiModal.tsx`)**: When evaluating the schedule, Gemini's proposed updates are now simulated locally using ThymeLine's deterministic `computeSchedule` engine. If the updates leave behind or introduce new delays, late finishes, or unassigned steps, ThymeLine automatically feeds the simulated schedule back to Gemini (up to a 3-pass limit) until resolved.
- **Unresolved Conflict & Trade-Off Reporting**: Displays a **Simulated Schedule Verification** banner showing the verified finish time after applying updates, plus any remaining issues or `unresolvedQuestions` that require your decision in the follow-up chat.

---

## [2.9.0] — 2026-11-23

### Added
- **Kitchen Plan Sheet (`Plan Sheet` button, `PrintPlanModal.tsx`, `planFormatter.ts`)**: Added a clean printable & copyable text view supporting **Chronological Timeline**, **Per-Dish Recipes & Steps**, and **Both Combined** modes, with toggles for **Checkboxes (`[ ]`)**, **Recipes, Ingredients & Notes** (with scaled quantities), and **Include Completed Steps**. Includes **Copy Plain Text**, **Pop-Out Window** (dedicated browser window with Copy & Print controls), and direct **Print** actions.

---

## [2.8.0] — 2026-11-23

### Added
- **Meal-Level Gemini Import (`parseImportedMeals` in `gemini.ts`, `GeminiModal.tsx`, `App.tsx`)**: The Gemini **Import / Add Items** tab now accepts full `MealItem` JSON (single dish, array of dishes, or `{ meals: [...] }`) as well as legacy `MealStep[]` arrays—preserving course, servings, ingredients, recipe instructions, raw notes, prep-ahead notes, finish constraints, `requiresTimer`, `canPrepEarly`, and `relativeDeps`.
- **Save Imported Meals to Library**: Imported meals are added as full `MealItem` entries in the active event, so editing any imported meal lets you save it directly to the **Meal Library** via **Save to Library**.
- **Copy Gemini Skill / Gem Instructions (`buildGeminiSkillInstructions`)**: Added a **Copy Gemini Skill Instructions** button in `GeminiModal`'s Import tab that copies a complete, ready-to-use Gemini Gem/Skill prompt containing your current kitchen appliances, auto-balance categories, and the ThymeLine `MealItem` JSON schema.

---

## [2.7.1] — 2026-11-23

### Fixed & Improved
- **Staggered Vertical Callout Planes for Crowded Gantt Steps (`GanttTimeline.tsx`)**: Narrow callout labels now detect collisions with both adjacent task bars and neighboring callout pills, automatically staggering onto separate vertical planes below the bars (with a vertical connector stem and dynamic lane-height expansion) so crowded sequences like *Melt Butter → Sauté Apples → Thicken and Boil Sauce* never overlap each other.

---

## [2.7.0] — 2026-11-23

### Added
- **External Callout Labels for Short-Duration Gantt Bars (`GanttTimeline.tsx`, `index.css`)**: Bars narrower than `110px` now display an adjacent clickable callout pill with the full step title and duration (positioned to the right, or left near the timeline edge) so 2m–5m steps are always readable and interactive even when zoomed out.
- **Crunch-Time Zoom Presets (`15m`, `30m`, `1h`, `Fit`) & Deeper Zoom**: Raised max zoom to `60 px/min` with dynamic `5m`/`10m`/`15m`/`30m`/`60m` axis ticks, allowing a 15-minute or 30-minute crunch-time window around `Now` to fill the visible timeline.
- **Optional Non-Disruptive `Auto` Zoom**: Added an **Auto** zoom toggle that steps down to closer windows as dinner approaches and older steps are started/completed, with a 90s cooldown and an automatic 15s pause whenever you scroll, wheel, or interact with the timeline.

---

## [2.6.4] — 2026-11-23

### Fixed
- **Library Import & Merge ID Remapping for `relativeDeps` (`workspace.ts`, `gemini.ts`, `App.tsx`)**: Fixed `cloneItemForEvent` and `mergeImportedSteps` so `relativeDeps[].stepId` is remapped alongside `dependencies` and `readyBeforeIds` when importing a dish from the Meal Library into an Event. Previously, `relativeDeps[].stepId` still pointed to the old Library step ID, causing the scheduler to ignore the relative link and `StepModal` to display the first step in the dropdown. Also cleaned up `relativeDeps` references when deleting a step.

---

## [2.6.3] — 2026-11-23

### Fixed
- **Pass 1 Prerequisite Pull for `relativeDeps` (`scheduler.ts`)**: When a time-relative step (e.g., *Add sliced apples to cider*, 60m before *Heat cider* ends) has its own finish-to-start prerequisites (e.g., *Slice apples*), Pass 1 now pulls those prerequisites earlier to match the `relativeDeps` start time instead of leaving them at the end of the dish.
- **Gemini `relativeDeps` Step ID Validation (`gemini.ts`)**: Normalized and validated `relativeDeps[].stepId` against generated step IDs and titles so a mismatched ID no longer silently defaults to the first step in the dropdown.

---

## [2.6.2] — 2026-11-23

### Fixed & Added
- **Gemini Request Timeout & Diagnostics (`gemini.ts`)**: Added a 35-second per-model `AbortController` timeout to `callGeminiWithFallback` so stalled network/API requests never hang indefinitely on `Processing...`. Also added detailed network error reporting and `finishReason` / `blockReason` diagnostics when a response is empty.
- **Always-Visible Error Banner & Elapsed Timer (`MealItemModal.tsx`)**: Added a dismissible error alert at the top of the dish modal (so errors from Auto-Fill, Pull Recipe, Scaling Review, or Step Processing are immediately visible regardless of scroll position) and live elapsed-seconds feedback (`Processing... (5s)`).

---

## [2.6.1] — 2026-11-23

### Fixed
- **Same-Appliance Concurrent Vessel Sharing (`scheduler.ts`, `GanttTimeline.tsx`)**: Steps with `relativeDeps` (e.g., *"Add apple slices 60m before end of Heat cider"* on a 1-pot Slow Cooker) now share their anchor step's appliance capacity in `findValidPlacement` instead of being blocked and pushed until after the anchor step finishes. `GanttTimeline` also expands the lane height to stack concurrent shared-vessel steps cleanly.

---

## [2.6.0] — 2026-11-23

### Added
- **Time-Relative / Concurrent Dependencies (`relativeDeps`)**: Steps can now be scheduled concurrently relative to the **start** or **end** of another ongoing step (`before_end`, `after_start`, or `after_end` with a minute offset — e.g., *"Start 60 min before end of Simmer Apple Cider"*).
- **Live Cascading & Gantt Arrows**: Extending, starting late, or moving the anchor step automatically shifts any time-relative concurrent steps in both Planning and Execution modes, and draws dependency arrows in `GanttTimeline`.
- **Step Editor & Gemini Support**: Added a **Time-Relative / Concurrent Timing** builder in `StepModal` and updated `gemini.ts` to parse and generate `relativeDeps`.

---

## [2.5.2] — 2026-11-22

### Fixed
- **Preserved Dish Editor Draft State When Editing Steps**: Clicking **Edit** on a step inside `MealItemModal` (for either a Library or Event dish) now opens `StepModal` inline while keeping `MealItemModal` mounted and hidden. Canceling, saving, or deleting a step no longer discards unsaved edits made to the dish's name, notes, ingredients, or other steps. Also enabled step editing on brand-new unsaved dishes.

---

## [2.5.1] — 2026-11-22

### Fixed & Added
- **Instructions for Gemini & Step-Splitting (`MealItemModal`, `gemini.ts`)**: Added a dedicated **Instructions for Gemini** field right in the dish AI Processing Bar so you can tell Gemini how to split, adjust, or re-time steps (e.g., splitting a combined 10-min sauté into 7-min sauté, stir-in, and 2-min boil), plus a **Regenerate Fresh** button.
- **Fixed Deleted-Steps Regeneration Bug**: When all steps are deleted (`steps.length === 0`) or **Regenerate Fresh** is clicked, `processMealItemWithGemini` now ignores stale `Current steps`, `Previous Converted Notes`, and deletion logs (`manualChangeLog`) so Gemini cleanly regenerates steps from your recipe and notes instead of getting stuck.

---

## [2.5.0] — 2026-11-22

### Added
- **Start-Time Alerts & Announcements**: Pending steps now trigger a distinct ascending chime (`playStartChime`), optional voice announcement (`"Time to start ..."`), and toast notification when their scheduled start time arrives in **Execution Mode** (or during custom Sim rehearsal).
- **Timed Cooking vs. Start-Alert Prep (`requiresTimer`)**: Added a **Needs Countdown Timer** toggle in `StepModal`. Untimed prep steps (e.g., peeling apples) alert you when to start and show **Begin** / **Done** controls without running a countdown alarm, while still cascading downstream steps if they run long or finish late.
- **Flexible Overtime & Post-Completion Extension**: Added `+2m` and `+15m` alongside `+5m` and `+10m` on active/overtime timer cards, plus a `+5m` reopen-and-extend button on completed dish steps so you can add more time even after an alarm has gone off or a step was marked Done—automatically shifting all dependent steps.

---

## [2.4.1] — 2026-11-22

### Changed
- Moved the **Sync** button in the header toolbar to the immediate left of **Settings**.

---

## [2.4.0] — 2026-11-22

### Added
- **Planning vs. Execution Mode Switch**: Replaced the ambiguous `Sim` / `Live` toggle with a clear **Planning** | **Execution** segmented switch in both the header toolbar and `SettingsModal`.
- **Auto-Default Sim Time to Suggested Start**: In **Planning** mode, the schedule is no longer constrained by the real-world clock, and **Sim Time** automatically defaults to `suggestedStartMin` (the earliest ideal start time across your chosen dishes). Manually scrubbing Sim Time (`-15m` / `+15m` or typing a time) enables custom rehearsal mode with a one-click **Auto** reset button.

---

## [2.3.1] — 2026-11-22

### Fixed
- Fixed horizontal overflow in **Kitchen Appliances & Capacity** (`ApplianceModal`) by constraining `.form-field` inputs (`min-width: 0; width: 100%; box-sizing: border-box`) and using `minmax(0, ...)` grid tracks.

---

## [2.3.0] — 2026-11-22

### Added
- **Appliance Categories & Auto-Balancing**: Added `category` to `Appliance` (e.g., `Oven`, `Stovetop`, `Counter`) and `category:<Name>` targeting in `StepModal` and `computeSchedule`, allowing multi-unit appliances like two ovens to automatically balance or share temperature-compatible racks (`resolvedApplianceId`).
- **Needs Location Gantt Lane & Quick-Assign**: Steps with an unassigned `applianceId` (`''`) now appear in a dedicated **Needs Location** swimlane at the top of the Gantt chart with an inline **Assign...** dropdown.
- **Gemini Auto-Fill in Add Dish**: Added an **Auto-Fill Dish with Gemini** bar at the top of `MealItemModal` (for both Event and Meal Library dishes) to parse a dish description, recipe notes, or URL into structured dish details and steps.
- **Conversational Gemini Schedule Evaluator**: Refocused the main **Gemini** modal on evaluating the live schedule for conflicts, bottlenecks, and unassigned steps, supporting follow-up corrections/replies and one-click application of proposed timeline & appliance adjustments (while preserving **Import / Add Items** and **Export / Backup**).
- **Proactive Dish-Add Schedule Review**: Adding a new dish (directly or from the Meal Library) now offers a prompt banner to open Gemini and optimize the updated schedule.

### Changed
- **Smart Library Location Mapping**: Saving a dish to the Meal Library now maps multi-unit/oven appliances to `category:<Category>` (e.g., `category:Oven`) while preserving single-unit prep/stovetop locations like `stovetop` and `counter`.

---

## [2.2.0] — 2026-11-22

### Changed
- **Appliance-Agnostic Meal Library**: Saving a dish to the **Meal Library** now clears specific appliance assignments (`applianceId: ''`) while preserving temperature, duration, slots, and notes.
- **Unassigned Appliance Support**: Added `(Unassigned — choose per event)` in `StepModal` (with temperature editing still available) and updated **AI Re-evaluate Event** in `gemini.ts` to recommend best-fit appliances for unassigned steps.

---

## [2.1.1] — 2026-11-22

### Fixed
- Fixed a bug where editing a step inside a **Meal Library** dish accidentally added that step to the active event's **Up Next** timeline; library step edits now stay isolated to `workspace.mealLibrary`.

### Added
- Added **+ Add Step** and **Delete Dish** (`Trash2`) buttons directly on the focused Dish Card in **Dishes** so you can add steps to a meal item or remove an entire dish and all its child steps from the event (undoable).

---

## [2.1.0] — 2026-11-22

### Added
- **Save Visual Confirmations**: Added a floating `.toast-banner` confirmation toast across all save, update, delete, import, sync, and settings actions.
- **Return-to-Parent Modal Navigation**: Saving, deleting, or canceling a Library dish opened from `MealLibraryModal` now returns you to `MealLibraryModal`, and editing a step from inside `MealItemModal` now returns you to `MealItemModal`.

---

## [2.0.1] — 2026-11-22

### Fixed
- Fixed HTML5 `step` validation mismatch on the custom portion multiplier input in `MealItemModal` (`min={0.1}` + `step="any"`) so `1X`, `0.5X`, `1.5X`, `2X`, `3X`, and custom decimals submit without validation errors.

---

## [2.0.0] — 2026-11-22

### Added
- **ThymeLine Rebrand & Palette**: Broadened from Thanksgiving-only to year-round family & holiday meal planning with a charcoal, warm cream, herb sage, and warm brass color palette.
- **Multi-Event Support**: Added top-bar Event selector to create, switch, rename, and delete events, with automatic migration from legacy `harvestline_state_v1` storage to `thymeline_workspace_v1`.
- **Dish-First `MealItem` Primary Records**: Structured dish records with `course`, `servings`, `dietaryTags`, `rawNotes`, `sourceUrl`, `convertedNotes`, `prepAheadNotes`, `steps[]`, `aiProcessedAt`, and `manualChangeLog[]`.
- **Per-Item Finish Timing & Flexible Windows**: Added `FinishConstraint` (`at_target`, `before_target`, `window`, `after_target`) honored by `computeSchedule` to spread room-temp/reheatable items earlier and free oven/prep space.
- **Recipe Extraction & Portion Scaling (`src/recipeScaler.ts`)**:
  - Added `ingredients` (`1X` base) and `recipeInstructions` on `MealItem`.
  - Added **Pull Recipe** from `sourceUrl` using Gemini's `url_context` tool.
  - Added portion multiplier (`0.5X`, `1X`, `1.5X`, `2X`, `3X`, or custom) with deterministic fraction/range scaling and live scaled preview.
  - Added **Review Scaled Proportions with Gemini** with 1-click **Apply Suggested Step Updates**.
- **Reusable Meal Library (`MealLibraryModal.tsx`)**: Save dishes to a cross-event Library, edit/create Library items directly without adding them to an event, and **Quick Pick** / **Load & Customize** from the Library inside **Add Dish**.
- **Manual Timeline Drag-to-Reschedule & Early Prep Metadata**:
  - Drag pending steps horizontally on the Gantt timeline (5-minute snap) to pin `pinnedStartMin`, with **Auto** reset in `StepModal`.
  - Added `canPrepEarly`, `earlyPrepMaxBefore`–`earlyPrepMinBefore`, and `preservationNotes` on cooking steps with `Snowflake` timeline badges.
- **Manual-Change Scan & AI Reconciliation**: Added **Scan** in Kitchen Mode to detect dishes with manual edits after AI processing and optionally run **AI Re-evaluate Event**.
- **Cloudflare Pages R2/KV Multi-User Sync (`functions/api/sync.ts`, `SyncModal.tsx`)**: Passcode-protected (`SYNC_PASSCODE`) JSON sync backed by R2 (`THYMELINE_BUCKET` / `app-thymeline`) or KV (`THYMELINE_KV`) with optimistic `syncVersion` conflict detection. Deployed at `https://thymeline.sariandjarrett.com`.
- **Unified Settings Panel (`SettingsModal.tsx`)**: Centralized Gemini API Key, Sync Passcode, Audio/Voice toggles, **Test Bell**, **Test Voice**, Simulation Clock settings, and app version display (`__APP_VERSION__`).
- **Direct Sim Time Picker**: Added `<input type="time">` directly in the top-bar Sim clock control.

### Changed
- **Gemini Model Resilience (`src/gemini.ts`)**: Upgraded to `gemini-4-hydrogen` with automatic fallback to `gemini-3.8-flash` and `gemini-3.5-flash-lite` on `503`/`429`/`404` responses.
- **Incremental Gemini Schedule Additions**: Added **Add to Schedule** vs. **Replace Entire Schedule** mode in `GeminiModal`.
- **Gantt Readability & Lane Reordering**: Increased default/max zoom, enabled 2-line title wrapping with hover expansion, and added drag-and-drop reordering for appliance lanes.
- **Modal Safety**: Disabled accidental backdrop-click dismissal across all modals to prevent losing unsaved form entries.
- **Kitchen Mode Polish**: Added undoable **Clear** button and **Dish Groups** filter pills with focused dish view.

---

## [1.0.0] — Initial Release

- Initial **HarvestLine** Thanksgiving meal scheduler & cascading kitchen timer (`computeSchedule`, Web Audio API alarms, `SpeechSynthesis`, `localStorage` persistence, Gantt timeline, and Gemini JSON import).
