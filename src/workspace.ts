import type {
  AppSettings,
  DishCourse,
  FinishConstraint,
  MealEvent,
  MealItem,
  MealStep,
  ThymeLineWorkspace,
} from './types';
import { DEFAULT_APPLIANCES, DEFAULT_STEPS } from './defaultData';

export const WORKSPACE_STORAGE_KEY = 'thymeline_workspace_v1';
export const SETTINGS_STORAGE_KEY = 'thymeline_settings_v1';
export const LEGACY_STORAGE_KEY = 'harvestline_state_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  targetDinnerMin: 17 * 60, // 5:00 PM
  soundEnabled: true,
  voiceEnabled: false,
  warningAt5Min: true,
  useSimulatedClock: true,
  simulatedNowMin: 12 * 60 + 30,
  geminiApiKey: '',
  syncPasscode: '',
};

export const DEFAULT_FINISH_CONSTRAINT: FinishConstraint = {
  mode: 'at_target',
};

function inferCourseFromDish(dish: string): DishCourse {
  const lower = dish.toLowerCase();
  if (lower.includes('turkey') || lower.includes('roast') || lower.includes('ham') || lower.includes('main')) {
    return 'Main';
  }
  if (lower.includes('gravy') || lower.includes('sauce') || lower.includes('cranberry')) {
    return 'Sauce / Gravy';
  }
  if (lower.includes('roll') || lower.includes('bread') || lower.includes('biscuit')) {
    return 'Bread';
  }
  if (lower.includes('pie') || lower.includes('cake') || lower.includes('dessert')) {
    return 'Dessert';
  }
  if (lower.includes('appetizer') || lower.includes('dip') || lower.includes('charcuterie')) {
    return 'Appetizer';
  }
  return 'Side';
}

export function stepsToMealItems(steps: MealStep[]): MealItem[] {
  const grouped = new Map<string, MealStep[]>();
  for (const s of steps) {
    const key = (s.dish || 'General').trim() || 'General';
    const arr = grouped.get(key) ?? [];
    arr.push(s);
    grouped.set(key, arr);
  }

  const now = Date.now();
  return Array.from(grouped.entries()).map(([name, itemSteps], idx) => {
    const anyAfter = itemSteps.every((s) => !s.mustFinishByDinner);
    const notesSummary = itemSteps
      .map((s) => (s.notes ? `${s.title}: ${s.notes}` : `${s.title} (${s.durationMin}m)`))
      .join('\n');

    return {
      id: `item-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${idx + 1}`,
      name,
      course: inferCourseFromDish(name),
      rawNotes: notesSummary,
      convertedNotes: notesSummary,
      finishConstraint: anyAfter ? { mode: 'after_target' } : { mode: 'at_target' },
      steps: itemSteps.map((s) => ({ ...s, dish: name })),
      manualChangeLog: [],
      updatedAt: now,
    };
  });
}

export function flattenEventSteps(event: MealEvent): MealStep[] {
  const result: MealStep[] = [];
  for (const item of event.mealItems) {
    const itemStepIds = new Set(item.steps.map((s) => s.id));
    for (const step of item.steps) {
      const hasIntraDependent = item.steps.some(
        (other) =>
          other.id !== step.id &&
          (other.dependencies.includes(step.id) || step.readyBeforeIds.includes(other.id))
      );
      const isTerminal = !hasIntraDependent || !itemStepIds.has(step.id);
      const mustFinish = item.finishConstraint.mode !== 'after_target' && step.mustFinishByDinner;

      result.push({
        ...step,
        dish: item.name,
        mustFinishByDinner: mustFinish,
        finishConstraint:
          item.finishConstraint.mode === 'after_target' || isTerminal
            ? item.finishConstraint
            : { mode: 'at_target' },
      });
    }
  }
  return result;
}

export function cloneItemForEvent(item: MealItem): MealItem {
  const now = Date.now();
  const idMap = new Map<string, string>();
  const newItemId = `item-${now}-${Math.random().toString(36).slice(2, 6)}`;

  for (const s of item.steps) {
    idMap.set(s.id, `step-${now}-${Math.random().toString(36).slice(2, 7)}`);
  }

  const clonedSteps: MealStep[] = item.steps.map((s) => ({
    ...s,
    id: idMap.get(s.id)!,
    dish: item.name,
    dependencies: s.dependencies.map((d) => idMap.get(d) ?? d),
    readyBeforeIds: s.readyBeforeIds.map((d) => idMap.get(d) ?? d),
    status: 'pending',
    remainingSec: s.durationMin * 60,
    addedMin: 0,
    actualStartMin: undefined,
    actualEndMin: undefined,
  }));

  return {
    ...item,
    id: newItemId,
    libraryItemId: item.libraryItemId ?? item.id,
    steps: clonedSteps,
    manualChangeLog: [],
    updatedAt: now,
  };
}

export function createDefaultWorkspace(): ThymeLineWorkspace {
  const now = Date.now();
  const defaultItems = stepsToMealItems(DEFAULT_STEPS);
  const defaultEvent: MealEvent = {
    id: 'event-default-1',
    name: 'Family Holiday Dinner',
    targetDinnerMin: 17 * 60,
    simulatedNowMin: 12 * 60 + 30,
    mealItems: defaultItems,
    appliancesOverride: null,
    updatedAt: now,
  };

  return {
    schemaVersion: 1,
    syncVersion: 0,
    updatedAt: now,
    activeEventId: defaultEvent.id,
    events: [defaultEvent],
    mealLibrary: defaultItems.map((it) => ({
      ...it,
      id: `lib-${it.id}`,
      steps: it.steps.map((s) => ({ ...s, applianceId: '' })),
    })),
    defaultAppliances: DEFAULT_APPLIANCES,
  };
}

export function loadInitialWorkspace(): {
  workspace: ThymeLineWorkspace;
  settings: AppSettings;
} {
  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  try {
    const rawSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (rawSettings) {
      const parsed = JSON.parse(rawSettings);
      if (parsed && typeof parsed === 'object') {
        settings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    }
  } catch {
    // ignore settings parse errors
  }

  try {
    const rawWs = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (rawWs) {
      const parsed = JSON.parse(rawWs) as ThymeLineWorkspace;
      if (parsed && Array.isArray(parsed.events) && parsed.events.length > 0) {
        return {
          workspace: {
            schemaVersion: parsed.schemaVersion ?? 1,
            syncVersion: parsed.syncVersion ?? 0,
            updatedAt: parsed.updatedAt ?? Date.now(),
            activeEventId: parsed.activeEventId || parsed.events[0].id,
            events: parsed.events,
            mealLibrary: Array.isArray(parsed.mealLibrary) ? parsed.mealLibrary : [],
            defaultAppliances: Array.isArray(parsed.defaultAppliances)
              ? parsed.defaultAppliances
              : DEFAULT_APPLIANCES,
          },
          settings,
        };
      }
    }
  } catch {
    // ignore workspace parse errors
  }

  // Migrate legacy harvestline_state_v1 if present
  try {
    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (rawLegacy) {
      const legacy = JSON.parse(rawLegacy);
      if (Array.isArray(legacy.steps) && Array.isArray(legacy.appliances)) {
        const mergedSettings: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...(legacy.settings && typeof legacy.settings === 'object' ? legacy.settings : {}),
        };
        const items = stepsToMealItems(legacy.steps as MealStep[]);
        const now = Date.now();
        const migratedEvent: MealEvent = {
          id: 'event-migrated-1',
          name: 'Family Holiday Dinner',
          targetDinnerMin: mergedSettings.targetDinnerMin,
          simulatedNowMin: mergedSettings.simulatedNowMin,
          mealItems: items,
          appliancesOverride: null,
          updatedAt: now,
        };
        return {
          workspace: {
            schemaVersion: 1,
            syncVersion: 0,
            updatedAt: now,
            activeEventId: migratedEvent.id,
            events: [migratedEvent],
            mealLibrary: items.map((it) => ({
              ...it,
              id: `lib-${it.id}`,
              steps: it.steps.map((s) => ({ ...s, applianceId: '' })),
            })),
            defaultAppliances: legacy.appliances,
          },
          settings: mergedSettings,
        };
      }
    }
  } catch {
    // ignore legacy migration errors
  }

  return {
    workspace: createDefaultWorkspace(),
    settings,
  };
}
