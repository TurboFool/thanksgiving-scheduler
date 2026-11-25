# ThymeLine — Project Overview & Architecture

## 1. Project Intent & Goals

**ThymeLine** is a browser-based, offline-capable family & holiday meal command center designed to run locally or via Cloudflare Pages with optional multi-user R2/KV cloud sync.

Cooking a large family or holiday meal involves tightly coupled constraints:
- **Dish-First Meal Items & Reusable Library**: Dishes (`MealItem`) are the primary record (`rawNotes`, `sourceUrl`, `convertedNotes`, `prepAheadNotes`, `finishConstraint`, `steps[]`, `manualChangeLog[]`). Items can be saved to a cross-event **Meal Library** and imported into any event.
- **Multi-Event Support**: Manage multiple events (e.g., Holiday Dinner, Christmas Eve, Summer BBQ) from a top-bar selector with automatic migration from legacy single-event storage.
- **Per-Item Finish Windows**: Dishes can target the main serve time, finish `X` minutes before (cooling/appetizers), use a flexible window (e.g., 30m–4h early for room-temp/reheatable items to free oven space), or run post-dinner.
- **Appliance Capacity & Temperature Sharing**: Appliances have limited physical space (e.g., 2 oven racks, 4 stovetop burners) and shared chamber temperatures.
- **Real-Time Schedule Slip & Cascading Timers**: Live countdown timers with audible & spoken voice alerts (**Test Bell** and **Test Voice**) cascade downstream and appliance-bound steps automatically.
- **Gemini AI Reconciliation**: Per-item and cross-event Gemini (`gemini-4-hydrogen` → `gemini-3.8-flash` → `gemini-3.5-flash-lite` with 1.5s transient retry) respects logged manual edits (`manualChangeLog`), infers missing operating modes from notes, and explains mode/appliance trade-offs.

---

## 2. Core Data Model (`src/types.ts`)

- **`Appliance`**: `id`, `name`, `category?`, `supportedModes?`, `capacity`, `slotLabel`, `hasTemperature`, `tempTolerance`, `preheatBufferMin?`, `cooldownBufferMin?`, `color`
- **`MealStep`**: `id`, `title`, `dish`, `stepKind?`, `durationMin`, `applianceId` (specific ID, `category:<Name>`, or `''` unassigned), `applianceMode?`, `modePreference?`, `slotsRequired`, `temperature?`, `dependencies[]`, `readyBeforeIds[]`, `relativeDeps?`, `mustFinishByDinner`, `requiresTimer?`, `finishConstraint?`, `pinnedStartMin?`, `canPrepEarly?`, `earlyPrepMinBefore?`, `earlyPrepMaxBefore?`, `preservationNotes?`, plus live timer fields.
- **`MealItem`**: `id`, `name`, `course`, `servings?`, `portionMultiplier?`, `dietaryTags?`, `rawNotes`, `sourceUrl?`, `ingredients?`, `recipeInstructions?`, `convertedNotes`, `prepAheadNotes?`, `scalingReview?`, `finishConstraint`, `steps[]`, `aiProcessedAt?`, `manualChangeLog[]`, `libraryItemId?`
- **`MealEvent`**: `id`, `name`, `targetDinnerMin`, `simulatedNowMin`, `mealItems[]`, `appliancesOverride?`
- **`ThymeLineWorkspace`**: `schemaVersion`, `syncVersion`, `activeEventId`, `events[]`, `mealLibrary[]`, `defaultAppliances[]`

---

## 3. Deterministic Scheduling & Scaling (`src/scheduler.ts`, `src/recipeScaler.ts`)

All scheduling and cascading math runs **100% locally and deterministically** in `computeSchedule`:
1. **Unified DAG & Cycle Detection**: Merges `dependencies` and `readyBeforeIds` with Kahn's topological sort.
2. **Pass 1 — Backward Resource-Constrained Pass**: Anchors each step to its `finishConstraint` (`at_target`, `before_target`, `window`, `after_target`) or manual `pinnedStartMin`, resolves `category:<Name>` targets across matching appliances, populates `resolvedApplianceId`, and places tasks ALAP without exceeding `appliance.capacity`, `tempTolerance`, mode exclusivity, or sequential preheat/cooldown buffers (`5m` per `50°F` up, `5m` per `25°F` down, or per-appliance overrides).
3. **Pass 2 — Forward Live-Cascade Pass**: Pins `done`, `running`, and `paused` steps, honors `pinnedStartMin` overrides, and schedules `pending` steps at the earliest conflict-free slot, steering `preferred`-mode steps toward mode-supporting appliances and attaching `transitionBefore`, `effectiveMode`, and `modeDecisionNote` metadata for UI rendering (including Gantt pinch-to-zoom, collapsible Kitchen Mode dish filters, and a resizable Kitchen Mode / Timeline split divider).
4. **Recipe Scaling (`src/recipeScaler.ts`)**: Deterministically scales `1X` ingredient quantities (integers, decimals, fractions, unicode fractions, and ranges) and servings labels.

---

## 4. Cloud Sync, Settings, Gemini Skill & Deployment (`functions/api/sync.ts`, `src/sync.ts`, `SettingsModal.tsx`, `src/gemini.ts`)

- **Production Domain**: `https://thymeline.sariandjarrett.com` (hosted on Cloudflare Pages).
- **Cloudflare Pages Function** (`GET`/`PUT /api/sync`): Backed by R2 bucket `app-thymeline` bound as `THYMELINE_BUCKET` (or optional KV namespace `THYMELINE_KV`), protected by the `SYNC_PASSCODE` secret under **Settings → Variables and Secrets** with optimistic `syncVersion` conflict detection.
- **Unified Settings (`SettingsModal.tsx`)**: Centralizes Gemini API key, sync passcode, audio/voice toggles, **Test Bell**, **Test Voice**, simulated clock, and SemVer version display (`__APP_VERSION__`).
- **Gemini Skill Versioning (`src/gemini.ts`, `GeminiModal.tsx`)**: `GEMINI_SKILL_VERSION` versions the copyable Gemini Gem/Skill prompt (`buildGeminiSkillInstructions`) and is displayed in `GeminiModal.tsx`. Any schema/scheduling changes affecting the skill require updating the prompt, bumping `GEMINI_SKILL_VERSION`, and alerting the user.
- `localStorage` (`thymeline_workspace_v1`, `thymeline_settings_v1`) caches everything locally for offline kitchen reliability.

---

## 5. Local Development

- `npm install` — install dependencies
- `npm run dev` — start local Vite dev server
- `npm run build` — run `tsc -b && vite build`
- `npm run lint` — run `oxlint`

---

## 6. Roadmap (Future Enhancements — Do Not Implement Until Explicitly Requested)

- **Better Event Management & Event Interface**:
  - Improved view/browser for the list of events.
  - Event-specific notes (add/edit/track notes per event, and pass them to Gemini during schedule evaluations).
  - Ability to delete events.
  - Ability to copy/duplicate events with an immediate prompt to rename the copy, choose whether to copy notes and other relevant fields, and optionally edit those fields before saving.
