# ThymeLine — Project Overview & Architecture

## 1. Project Intent & Goals

**ThymeLine** is a browser-based, offline-capable family & holiday meal command center designed to run locally or via Cloudflare Pages with optional multi-user R2/KV cloud sync.

Cooking a large family or holiday meal involves tightly coupled constraints:
- **Dish-First Meal Items & Reusable Library**: Dishes (`MealItem`) are the primary record (`rawNotes`, `sourceUrl`, `convertedNotes`, `prepAheadNotes`, `finishConstraint`, `steps[]`, `manualChangeLog[]`). Items can be saved to a cross-event **Meal Library** and imported into any event.
- **Multi-Event Support**: Manage multiple events (e.g., Holiday Dinner, Christmas Eve, Summer BBQ) from a top-bar selector with automatic migration from legacy single-event storage.
- **Per-Item Finish Windows**: Dishes can target the main serve time, finish `X` minutes before (cooling/appetizers), use a flexible window (e.g., 30m–4h early for room-temp/reheatable items to free oven space), or run post-dinner.
- **Appliance Capacity & Temperature Sharing**: Appliances have limited physical space (e.g., 2 oven racks, 4 stovetop burners) and shared chamber temperatures.
- **Real-Time Schedule Slip & Cascading Timers**: Live countdown timers with audible & spoken voice alerts (**Test Bell** and **Test Voice**) cascade downstream and appliance-bound steps automatically.
- **Gemini AI Reconciliation**: Per-item and cross-event Gemini (`gemini-4-hydrogen` with automatic fallback) respects logged manual edits (`manualChangeLog`) when reprocessing.

---

## 2. Core Data Model (`src/types.ts`)

- **`Appliance`**: `id`, `name`, `capacity`, `slotLabel`, `hasTemperature`, `tempTolerance`, `color`
- **`MealItem`**: `id`, `name`, `course`, `servings?`, `dietaryTags?`, `rawNotes`, `sourceUrl?`, `convertedNotes`, `prepAheadNotes?`, `finishConstraint`, `steps[]`, `aiProcessedAt?`, `manualChangeLog[]`, `libraryItemId?`
- **`MealEvent`**: `id`, `name`, `targetDinnerMin`, `simulatedNowMin`, `mealItems[]`, `appliancesOverride?`
- **`ThymeLineWorkspace`**: `schemaVersion`, `syncVersion`, `activeEventId`, `events[]`, `mealLibrary[]`, `defaultAppliances[]`

---

## 3. Deterministic Scheduling Engine (`src/scheduler.ts`)

All scheduling and cascading math runs **100% locally and deterministically** in `computeSchedule`:
1. **Unified DAG & Cycle Detection**: Merges `dependencies` and `readyBeforeIds` with Kahn's topological sort.
2. **Pass 1 — Backward Resource-Constrained Pass**: Anchors each step to its `finishConstraint` (`at_target`, `before_target`, `window`, `after_target`) and places tasks ALAP without exceeding `appliance.capacity` or `tempTolerance`.
3. **Pass 2 — Forward Live-Cascade Pass**: Pins `done`, `running`, and `paused` steps and schedules `pending` steps at the earliest conflict-free slot.

---

## 4. Cloud Sync (`functions/api/sync.ts`, `src/sync.ts`)

- Optional Cloudflare Pages Function (`GET`/`PUT /api/sync`) backed by `THYMELINE_BUCKET` (R2) or `THYMELINE_KV` (KV), protected by `SYNC_PASSCODE` with optimistic `syncVersion` conflict detection.
- `localStorage` (`thymeline_workspace_v1`, `thymeline_settings_v1`) caches everything locally for offline kitchen reliability.

---

## 5. Local Development

- `npm install` — install dependencies
- `npm run dev` — start local Vite dev server
- `npm run build` — run `tsc -b && vite build`
- `npm run lint` — run `oxlint`
