# Changelog

All notable changes to **ThymeLine** (formerly HarvestLine) are documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
