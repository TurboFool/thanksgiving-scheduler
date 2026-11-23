# HarvestLine — Project Overview & Architecture

## 1. Project Intent & Goals

**HarvestLine** is a browser-based, offline-capable Thanksgiving meal command center designed to run locally on Windows (or any browser/tablet in the kitchen).

Cooking a large holiday meal involves tightly coupled constraints:
- **Duration & Dependencies**: Some steps must wait for prior steps to finish (*Depends On*, e.g., gravy and resting depend on the turkey finishing), while others must be ready before a later item can begin (*Ready Before*).
- **Target Serve Time**: Everything is anchored backward from a target dinner time so dishes finish hot together.
- **Appliance Capacity & Temperature Sharing**: Appliances have limited physical space (e.g., 2 oven racks, 4 stovetop burners, 1 air fryer basket) and shared chamber temperatures (e.g., two 350°F casseroles can share a 2-rack oven if their temperatures are within the appliance's tolerance, such as ±25°F, whereas a 325°F turkey occupying 2 racks blocks everything else).
- **Real-Time Schedule Slip & Cascading Timers**: Kitchen schedules inevitably slip. Each step has a live countdown timer with audible alarms; if a step runs long (`+5m`, `+10m`, or overtime past `00:00`), the rest of the schedule must cascade automatically in real time—absorbing slack where possible and shifting conflicting downstream or appliance-bound steps while updating the projected dinner time.
- **Gemini Assistance**: Users can generate/plan menus in Gemini chat and paste JSON directly into HarvestLine, or optionally supply a Gemini API key for 1-click menu-to-schedule generation and slip-recovery suggestions.

---

## 2. Core Data Model (`src/types.ts`)

- **`Appliance`**:
  - `id`, `name`, `capacity` (slots/racks/burners), `slotLabel` (`"rack"`, `"burner"`, `"basket"`, etc.)
  - `hasTemperature` (boolean) and `tempTolerance` (max °F spread allowed among overlapping tasks)
  - `color` (hex accent for timeline swimlane)
- **`MealStep`**:
  - `id`, `title`, `dish`, `durationMin`
  - `applianceId`, `slotsRequired`, `temperature?`
  - `dependencies: string[]` (step IDs that must finish before this starts)
  - `readyBeforeIds: string[]` (step IDs that rely on this step finishing first)
  - `mustFinishByDinner: boolean`
  - Live execution state: `status` (`'pending' | 'running' | 'paused' | 'done'`), `remainingSec`, `addedMin`, `actualStartMin?`, `actualEndMin?`
- **`ScheduledStep`** (computed output of `computeSchedule`):
  - `startMin`, `endMin` (minutes from midnight), `laneRow` (0-indexed visual sub-lane inside the appliance row)
  - `slackMin`, `isCritical`, `isDelayed`, `delayMin`
  - `effectivePrereqs`, `effectiveDependents`

---

## 3. Deterministic Scheduling Engine (`src/scheduler.ts`)

All scheduling and cascading math runs **100% locally and deterministically** in [`computeSchedule`](file:///home/antigravity/thanksgiving-scheduler/src/scheduler.ts#L78-L353):

1. **Unified DAG & Cycle Detection**:
   - Merges `dependencies` (`A -> this`) and `readyBeforeIds` (`this -> B`) into a directed acyclic graph and runs Kahn's topological sort.
   - If a cycle is detected, `cycleError` is returned so the UI displays a warning banner with a 1-click Undo button.
2. **Pass 1 — Backward Resource-Constrained Pass (Ideal Plan)**:
   - Iterates in reverse topological order from `targetDinnerMin`.
   - Places each step as late as possible (`ALAP`) while ensuring:
     - All dependents start after this step ends.
     - Overlapping intervals on the same `applianceId` do not exceed `appliance.capacity`.
     - If `appliance.hasTemperature`, overlapping tasks with temperatures satisfy `maxTemp - minTemp <= appliance.tempTolerance`.
3. **Pass 2 — Forward Live-Cascade Pass**:
   - Pins `done` steps to `actualStartMin .. actualEndMin`.
   - Pins `running` / `paused` steps to `actualStartMin .. max(start + 1, nowMin + ceil(remainingSec / 60))` so overtime (`remainingSec <= 0`) or `+5m`/`+10m` extensions immediately push dependent and appliance-conflicting tasks forward.
   - Schedules `pending` steps in topological order at the earliest conflict-free slot `>= max(idealStart, nowMin, maxPrereqEnd)`.
4. **Metrics**:
   - Computes `projectedDinnerMin`, `dinnerDeltaMin` (late/early vs. target), `earliestStartMin`, `slackMin`, and `delayMin`.

---

## 4. Application Architecture & UI

- **Top Command Bar (`src/App.tsx`)**:
  - Target Dinner time picker + Projected Dinner status badge (`On Time`, `+Xm late`, or `Xm early`).
  - **Sim Clock vs. Live Clock** toggle (`-15m` / `+15m` step buttons in Sim mode) so users can rehearse and test cascading before Thanksgiving Day.
  - Sound & Voice toggles, **Test Bell** (unlocks browser `AudioContext`), **Undo** stack (up to 15 snapshots), **Appliances**, **Gemini / Import**, and **Add Step**.
- **Split-View Workspace**:
  - **Left — Kitchen Mode (`src/App.tsx`)**: Active & ringing timer cards (`Done`, `+5m`, `+10m`, `Pause/Resume`, `Silence`), **Up Next** queue with `DUE` indicators, and **Completed** list with `Reopen`.
  - **Right — Appliance-Lane Gantt (`src/components/GanttTimeline.tsx`)**: Zoomable timeline with sticky appliance labels, multi-rack sub-lane stacking, SVG Bezier dependency arrows, Target Dinner dashed line, and live `NOW` playhead.
- **Audio & Alarms (`src/audio.ts`)**:
  - Synthesizes a 2-tone 5-minute warning chime and a repeating 3-note alarm triad via Web Audio API (`SoundManager`), plus optional `window.speechSynthesis` spoken alerts.
- **Gemini Integration (`src/gemini.ts`, `src/components/GeminiModal.tsx`)**:
  - **No-API-Key Workflow**: Copies a schema-aware prompt for Gemini chat and parses pasted JSON (stripping Markdown fences if present).
  - **Optional API Workflow**: Calls `gemini-3.8-flash` with `responseMimeType: "application/json"` to convert a menu description into steps, or requests concise slip-recovery advice when behind schedule.

---

## 5. Local Development & Persistence

- State (`appliances`, `steps`, `settings`) is automatically persisted to `localStorage` under `harvestline_state_v1`.
- **Commands**:
  - `npm install` — install dependencies
  - `npm run dev` — start local Vite dev server
  - `npm run build` — run `tsc -b && vite build` to verify types and production bundle
