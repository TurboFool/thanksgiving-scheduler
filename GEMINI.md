# GEMINI.md — Project Rules & Standards for HarvestLine

This file defines mandatory rules, coding standards, and repository workflows for any AI coding agent working on **HarvestLine** (`thanksgiving-scheduler`).

For full project context, intent, and architecture, read [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) first.

---

## 1. Mandatory Repo Check-In Protocol

**Before reading, planning, or editing any code** at the start of a conversation—or whenever significant time has elapsed since the last action—you MUST check in with the Git repository:

1. Run `git status` to inspect any uncommitted local changes.
2. Run `git fetch origin` and compare local `main` against `origin/main` (`git log -n 5 --oneline --decorate` and `git rev-list --left-right --count HEAD...origin/main`).
3. If `origin/main` is ahead and the working tree is clean, pull updates (`git pull --ff-only`) before making changes.
4. If there are uncommitted changes or diverged branches, inspect them and confirm with the user before overwriting or resetting anything.
5. Never force-push (`git push --force`) or discard uncommitted user work without explicit approval.

---

## 2. Tech Stack & Dependencies

- **Framework**: React 19 + TypeScript (`strict` mode) + Vite
- **Styling**: Vanilla CSS with CSS custom properties in `src/index.css` (do **not** introduce TailwindCSS or CSS-in-JS libraries unless explicitly requested).
- **Icons**: `lucide-react`
- **Audio & Speech**: Browser-native Web Audio API (`AudioContext`) and Web Speech API (`speechSynthesis`) — zero external audio asset dependencies so the app works offline.
- **Persistence**: Browser `localStorage` (`harvestline_state_v1`) + JSON import/export.

---

## 3. File Structure

```text
thanksgiving-scheduler/
├── GEMINI.md                  # Agent rules, git check-in protocol & coding standards
├── PROJECT_OVERVIEW.md        # Full project intent, architecture & scheduler math
├── README.md                  # Quick start & local run instructions
├── index.html                 # Entry HTML + Google Fonts (Fraunces, Inter, JetBrains Mono)
└── src/
    ├── main.tsx               # React root mount
    ├── index.css              # Design tokens, split-view layout, Gantt & modal styles
    ├── App.tsx                # Top-level state, 1s timer/alarm loop, undo stack, split view
    ├── types.ts               # Core TypeScript interfaces (Appliance, MealStep, ScheduledStep, etc.)
    ├── scheduler.ts           # Deterministic backward/forward resource-constrained scheduler
    ├── defaultData.ts         # Default kitchen appliances & sample Thanksgiving menu
    ├── audio.ts               # Web Audio API alarm synthesizer & SpeechSynthesis helper
    ├── gemini.ts              # Gemini prompt builder, JSON importer & optional API client
    └── components/
        ├── GanttTimeline.tsx  # Appliance-lane Gantt chart, SVG dependency arrows, NOW playhead
        ├── StepModal.tsx      # Add/edit/duplicate/delete cooking step modal
        ├── ApplianceModal.tsx # Configure appliances, slot capacities & temp tolerances
        └── GeminiModal.tsx    # Prompt copy/paste JSON import, Gemini API tools & JSON export
```

### Placement Rules
- Keep **pure scheduling/domain logic** in `src/scheduler.ts` (no React or DOM dependencies) so it remains deterministic, fast, and testable.
- Keep **UI components** in `src/components/` as focused functional components typed with explicit `interface *Props`.
- Keep **all styling** in `src/index.css` using existing CSS variables (`--bg-*`, `--ink-*`, `--accent-*`, `--status-*`).

---

## 4. Coding Standards

- **TypeScript**:
  - Maintain strict typing; avoid `any`. Use `import type` for type-only imports (`verbatimModuleSyntax` / `tsconfig.app.json`).
  - Remove unused imports and variables (`noUnusedLocals` is enforced by `tsc -b`).
- **React**:
  - Functional components and hooks only.
  - Derive computed schedule state via `useMemo` from `(steps, appliances, targetDinnerMin, nowMin)` rather than duplicating derived timing fields in state.
  - Push a snapshot via `pushUndo(label)` before any user-initiated mutation (starting/extending/completing/editing/deleting steps, changing dinner time, updating appliances, or importing).
- **UI & CSS**:
  - Use `tabular-nums` (`.mono`) on all timers, durations, and timestamps to prevent layout jitter.
  - Any modal containing a `<form>` must keep `.modal-header` and `.modal-footer` pinned (`flex-shrink: 0`) while `.modal-body` scrolls (`flex: 1; min-height: 0; overflow-y: auto;`).
- **Comments & Docs**:
  - Preserve existing docstrings and comments unrelated to your changes.
  - Update `PROJECT_OVERVIEW.md` if you change core data models, scheduling behavior, or add new modules.

---

## 5. Verification Before Finishing

Before reporting work complete or pushing to `origin`:
1. Run `npm run build` (`tsc -b && vite build`) and ensure it exits with code `0`.
2. If you modified UI or scheduling logic, verify in the running dev server (`npm run dev`) that:
   - Modals scroll properly on smaller viewports.
   - Extending a running timer (`+5m` / `+10m`) or letting it hit `00:00` cascades downstream steps and updates the projected dinner delta.
   - Test Bell produces audio without console errors.
