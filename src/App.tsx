import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BookOpen,
  Calendar,
  Check,
  Clock,
  Cloud,
  Edit3,
  Flame,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Utensils,
  Volume2,
  VolumeX,
  AlertCircle,
} from 'lucide-react';
import type {
  Appliance,
  AppSettings,
  MealEvent,
  MealItem,
  MealStep,
  ScheduledStep,
  ScheduleSnapshot,
  ThymeLineWorkspace,
} from './types';
import { DEFAULT_APPLIANCES, DEFAULT_STEPS } from './defaultData';
import { computeSchedule, formatCountdownSec, formatDuration, formatTimeMin } from './scheduler';
import { soundManager } from './audio';
import {
  mergeImportedSteps,
  reEvaluateEventWithGemini,
  type ScheduleAdjustmentProposal,
} from './gemini';
import {
  cloneItemForEvent,
  flattenEventSteps,
  loadInitialWorkspace,
  SETTINGS_STORAGE_KEY,
  stepsToMealItems,
  WORKSPACE_STORAGE_KEY,
} from './workspace';
import { GanttTimeline } from './components/GanttTimeline';
import { StepModal } from './components/StepModal';
import { MealItemModal } from './components/MealItemModal';
import { MealLibraryModal } from './components/MealLibraryModal';
import { ApplianceModal } from './components/ApplianceModal';
import { GeminiModal } from './components/GeminiModal';
import { SyncModal } from './components/SyncModal';
import { SettingsModal } from './components/SettingsModal';

function getRealNowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function minToTimeInput(min: number): string {
  const norm = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function timeInputToMin(val: string): number {
  const [h, m] = val.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 17 * 60;
  return h * 60 + m;
}

function formatFinishLabel(item: MealItem): string {
  const fc = item.finishConstraint;
  switch (fc.mode) {
    case 'before_target':
      return `${fc.offsetMin ?? 30}m before serve`;
    case 'window':
      return `Window: ${fc.windowMaxBeforeMin ?? 180}–${fc.windowMinBeforeMin ?? 30}m early`;
    case 'after_target':
      return 'Post-meal / flexible';
    default:
      return 'At serve time';
  }
}

export function App() {
  const initialData = useMemo(() => loadInitialWorkspace(), []);

  const [workspace, setWorkspace] = useState<ThymeLineWorkspace>(initialData.workspace);
  const [settings, setSettings] = useState<AppSettings>(initialData.settings);

  const [realNowMin, setRealNowMin] = useState<number>(getRealNowMin);
  const [undoStack, setUndoStack] = useState<ScheduleSnapshot[]>([]);
  const [editingStep, setEditingStep] = useState<{
    step: MealStep | null;
    parentItemId?: string;
    defaultDish?: string;
    returnToItem?: { id: string; target: 'event' | 'library'; returnTo?: 'library' };
  } | null>(null);
  const [editingMealItem, setEditingMealItem] = useState<{
    item: MealItem | null;
    target: 'event' | 'library';
    returnTo?: 'library';
  } | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedDish, setSelectedDish] = useState<string | null>(null);
  const [showApplianceModal, setShowApplianceModal] = useState(false);
  const [showGeminiModal, setShowGeminiModal] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [mutedAlarms, setMutedAlarms] = useState<Set<string>>(new Set());
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanAiAdvice, setScanAiAdvice] = useState<string | null>(null);
  const [scanAiLoading, setScanAiLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const warned5MinRef = useRef<Set<string>>(new Set());
  const dueAlertedRef = useRef<Set<string>>(new Set());
  const alarmTickRef = useRef<number>(0);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3200);
  };

  const activeEvent = useMemo(
    () => workspace.events.find((e) => e.id === workspace.activeEventId) ?? workspace.events[0],
    [workspace]
  );

  const appliances = useMemo(
    () => activeEvent.appliancesOverride ?? workspace.defaultAppliances,
    [activeEvent.appliancesOverride, workspace.defaultAppliances]
  );

  const steps = useMemo(() => flattenEventSteps(activeEvent), [activeEvent]);

  const targetDinnerMin = activeEvent.targetDinnerMin;
  const isAutoSim = settings.useSimulatedClock && !activeEvent.simTimeOverridden;
  const rawNowMin = settings.useSimulatedClock ? activeEvent.simulatedNowMin : realNowMin;

  // Persist workspace & settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore storage quota errors
    }
  }, [workspace, settings]);

  // Helper to update the active event cleanly
  const updateActiveEvent = (updater: (ev: MealEvent) => MealEvent) => {
    setWorkspace((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      events: prev.events.map((ev) =>
        ev.id === activeEvent.id ? { ...updater(ev), updatedAt: Date.now() } : ev
      ),
    }));
  };

  // Helper to mutate steps across activeEvent.mealItems (optionally logging manual edits)
  const mutateEventSteps = (
    stepUpdater: (step: MealStep, item: MealItem) => MealStep,
    logSummary?: (item: MealItem) => string | null
  ) => {
    updateActiveEvent((ev) => ({
      ...ev,
      mealItems: ev.mealItems.map((item) => {
        let itemChanged = false;
        const nextSteps = item.steps.map((s) => {
          const updated = stepUpdater(s, item);
          if (updated !== s) itemChanged = true;
          return updated;
        });
        if (!itemChanged) return item;
        const summary = logSummary ? logSummary(item) : null;
        const nextLog =
          summary && item.aiProcessedAt
            ? [
                ...item.manualChangeLog,
                {
                  id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                  timestamp: Date.now(),
                  field: 'step',
                  summary,
                },
              ]
            : item.manualChangeLog;
        return {
          ...item,
          steps: nextSteps,
          manualChangeLog: nextLog,
          updatedAt: Date.now(),
        };
      }),
    }));
  };

  // 1-second timer & alarm loop
  useEffect(() => {
    const interval = setInterval(() => {
      setRealNowMin(getRealNowMin());
      alarmTickRef.current += 1;

      setWorkspace((prev) => {
        const ev = prev.events.find((e) => e.id === prev.activeEventId) ?? prev.events[0];
        if (!ev) return prev;

        let changed = false;
        const newlyFinishedOrWarned: MealStep[] = [];

        const nextItems = ev.mealItems.map((item) => {
          let itemChanged = false;
          const nextSteps = item.steps.map((s) => {
            if (s.status !== 'running' || s.requiresTimer === false) return s;
            changed = true;
            itemChanged = true;
            const nextSec = s.remainingSec - 1;

            if (
              settings.warningAt5Min &&
              nextSec === 300 &&
              !warned5MinRef.current.has(s.id)
            ) {
              warned5MinRef.current.add(s.id);
              if (settings.soundEnabled) soundManager.playWarningChime();
              if (settings.voiceEnabled) soundManager.speak(`5 minutes left for ${s.title}`);
            }

            if (nextSec === 0) {
              if (settings.soundEnabled) soundManager.playAlarmBell();
              if (settings.voiceEnabled) soundManager.speak(`${s.title} timer is complete!`);
            }

            const updated = { ...s, remainingSec: nextSec };
            newlyFinishedOrWarned.push(updated);
            return updated;
          });

          return itemChanged ? { ...item, steps: nextSteps } : item;
        });

        if (alarmTickRef.current % 4 === 0 && settings.soundEnabled) {
          const hasRinging = newlyFinishedOrWarned.some(
            (s) =>
              s.status === 'running' &&
              s.requiresTimer !== false &&
              s.remainingSec <= 0 &&
              !mutedAlarms.has(s.id)
          );
          if (hasRinging) {
            soundManager.playAlarmBell();
          }
        }

        if (!changed) return prev;
        return {
          ...prev,
          events: prev.events.map((e) => (e.id === ev.id ? { ...e, mealItems: nextItems } : e)),
        };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [settings.soundEnabled, settings.voiceEnabled, settings.warningAt5Min, mutedAlarms]);

  const pushUndo = (label: string) => {
    setUndoStack((prev) => [
      ...prev.slice(-14),
      {
        label,
        timestamp: Date.now(),
        steps: steps.map((s) => ({ ...s })),
        mealItems: activeEvent.mealItems.map((it) => ({
          ...it,
          steps: it.steps.map((s) => ({ ...s })),
          manualChangeLog: [...it.manualChangeLog],
        })),
        appliances: appliances.map((a) => ({ ...a })),
        targetDinnerMin,
      },
    ]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    updateActiveEvent((ev) => ({
      ...ev,
      mealItems: last.mealItems,
      targetDinnerMin: last.targetDinnerMin,
      appliancesOverride: ev.appliancesOverride ? last.appliances : null,
    }));
    if (!activeEvent.appliancesOverride) {
      setWorkspace((prev) => ({ ...prev, defaultAppliances: last.appliances }));
    }
  };

  // Compute deterministic schedule
  const schedule = useMemo(
    () => computeSchedule(steps, appliances, targetDinnerMin, isAutoSim ? undefined : rawNowMin),
    [steps, appliances, targetDinnerMin, isAutoSim, rawNowMin]
  );
  const nowMin = isAutoSim ? schedule.suggestedStartMin : rawNowMin;

  // Alert / announce when a pending step reaches its scheduled start time (in Execution Mode or custom Sim rehearsal)
  useEffect(() => {
    if (isAutoSim) return;
    const dueNow = schedule.steps.filter(
      (s) => s.status === 'pending' && nowMin >= s.startMin && !dueAlertedRef.current.has(s.id)
    );
    if (dueNow.length === 0) return;

    dueNow.forEach((s) => dueAlertedRef.current.add(s.id));
    const first = dueNow[0];
    if (settings.soundEnabled) soundManager.playStartChime();
    if (settings.voiceEnabled) {
      const msg =
        dueNow.length === 1
          ? `Time to start ${first.title}${first.dish ? ` for ${first.dish}` : ''}`
          : `Time to start ${first.title} and ${dueNow.length - 1} more step${dueNow.length > 2 ? 's' : ''}`;
      soundManager.speak(msg);
    }
    showToast(
      dueNow.length === 1
        ? `Time to start: ${first.title}`
        : `Time to start: ${first.title} (+${dueNow.length - 1} more)`
    );
  }, [
    schedule.steps,
    nowMin,
    isAutoSim,
    settings.soundEnabled,
    settings.voiceEnabled,
  ]);

  const applianceMap = useMemo(() => new Map(appliances.map((a) => [a.id, a])), [appliances]);

  // Event Management
  const handleCreateEvent = () => {
    const name = window.prompt('New event name (e.g., Christmas Eve Dinner, Summer BBQ):');
    if (!name || !name.trim()) return;
    const now = Date.now();
    const newEv: MealEvent = {
      id: `event-${now}`,
      name: name.trim(),
      targetDinnerMin: 17 * 60,
      simulatedNowMin: 12 * 60 + 30,
      mealItems: [],
      appliancesOverride: null,
      updatedAt: now,
    };
    setWorkspace((prev) => ({
      ...prev,
      updatedAt: now,
      activeEventId: newEv.id,
      events: [...prev.events, newEv],
    }));
    setSelectedStepId(null);
    setSelectedDish(null);
    setScanNotice(null);
    setScanAiAdvice(null);
  };

  const handleRenameEvent = () => {
    const nextName = window.prompt('Rename current event:', activeEvent.name);
    if (!nextName || !nextName.trim()) return;
    updateActiveEvent((ev) => ({ ...ev, name: nextName.trim() }));
  };

  const handleDeleteEvent = () => {
    if (workspace.events.length <= 1) return;
    if (!window.confirm(`Delete event "${activeEvent.name}"?`)) return;
    const remaining = workspace.events.filter((e) => e.id !== activeEvent.id);
    setWorkspace((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      activeEventId: remaining[0].id,
      events: remaining,
    }));
    setSelectedStepId(null);
    setSelectedDish(null);
  };

  // Step actions
  const startStep = (id: string) => {
    soundManager.unlock();
    pushUndo('Start timer');
    setMutedAlarms((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    mutateEventSteps((s) =>
      s.id === id
        ? {
            ...s,
            status: 'running',
            actualStartMin: s.actualStartMin ?? nowMin,
            remainingSec: s.remainingSec > 0 ? s.remainingSec : s.durationMin * 60,
          }
        : s
    );
  };

  const pauseStep = (id: string) => {
    mutateEventSteps((s) => (s.id === id ? { ...s, status: 'paused' } : s));
  };

  const extendStep = (id: string, extraMin: number) => {
    soundManager.unlock();
    pushUndo(`Extend +${extraMin}m`);
    setMutedAlarms((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    mutateEventSteps((s) => {
      if (s.id !== id) return s;
      const baseSec = Math.max(0, s.remainingSec);
      return {
        ...s,
        addedMin: (s.addedMin || 0) + extraMin,
        remainingSec: baseSec + extraMin * 60,
      };
    });
  };

  const completeStep = (id: string) => {
    pushUndo('Complete step');
    mutateEventSteps((s) =>
      s.id === id
        ? {
            ...s,
            status: 'done',
            actualStartMin: s.actualStartMin ?? Math.max(0, nowMin - s.durationMin),
            actualEndMin: nowMin,
            remainingSec: 0,
          }
        : s
    );
  };

  const reopenStep = (id: string) => {
    pushUndo('Reopen step');
    mutateEventSteps((s) =>
      s.id === id
        ? {
            ...s,
            status: 'pending',
            actualStartMin: undefined,
            actualEndMin: undefined,
            remainingSec: s.durationMin * 60,
            addedMin: 0,
          }
        : s
    );
  };

  const reopenAndExtendStep = (id: string, extraMin: number) => {
    soundManager.unlock();
    pushUndo(`Needs +${extraMin}m more`);
    setMutedAlarms((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    mutateEventSteps((s) =>
      s.id === id
        ? {
            ...s,
            status: 'running',
            actualStartMin: s.actualStartMin ?? Math.max(0, nowMin - s.durationMin),
            actualEndMin: undefined,
            remainingSec: extraMin * 60,
            addedMin: (s.addedMin || 0) + extraMin,
          }
        : s
    );
    showToast(`Added +${extraMin}m timer`);
  };

  const handleSaveStep = (saved: MealStep) => {
    pushUndo(editingStep?.step ? 'Edit step' : 'Add step');
    updateActiveEvent((ev) => {
      // Check if step already exists in any MealItem
      const ownerItem = ev.mealItems.find((it) => it.steps.some((s) => s.id === saved.id));
      if (ownerItem) {
        return {
          ...ev,
          mealItems: ev.mealItems.map((it) => {
            if (it.id !== ownerItem.id) return it;
            const nextSteps = it.steps.map((s) => (s.id === saved.id ? saved : s));
            const nextLog = it.aiProcessedAt
              ? [
                  ...it.manualChangeLog,
                  {
                    id: `chg-${Date.now()}`,
                    timestamp: Date.now(),
                    field: 'step:edited',
                    summary: `Edited "${saved.title}" (${saved.durationMin}m${
                      saved.temperature ? ` @ ${saved.temperature}°F` : ''
                    })`,
                  },
                ]
              : it.manualChangeLog;
            return { ...it, steps: nextSteps, manualChangeLog: nextLog, updatedAt: Date.now() };
          }),
        };
      }

      // Otherwise attach to matching dish name or parentItemId, or create a new MealItem
      const targetItem =
        ev.mealItems.find((it) => it.id === editingStep?.parentItemId) ??
        ev.mealItems.find((it) => it.name.toLowerCase() === saved.dish.toLowerCase());

      if (targetItem) {
        return {
          ...ev,
          mealItems: ev.mealItems.map((it) => {
            if (it.id !== targetItem.id) return it;
            const nextLog = it.aiProcessedAt
              ? [
                  ...it.manualChangeLog,
                  {
                    id: `chg-${Date.now()}`,
                    timestamp: Date.now(),
                    field: 'step:added',
                    summary: `Added step "${saved.title}" (${saved.durationMin}m)`,
                  },
                ]
              : it.manualChangeLog;
            return {
              ...it,
              steps: [...it.steps, { ...saved, dish: it.name }],
              manualChangeLog: nextLog,
              updatedAt: Date.now(),
            };
          }),
        };
      }

      const newItems = stepsToMealItems([saved]);
      return {
        ...ev,
        mealItems: [...ev.mealItems, ...newItems],
      };
    });
    setEditingStep(null);
  };

  const handleDeleteStep = (id: string) => {
    pushUndo('Delete step');
    updateActiveEvent((ev) => ({
      ...ev,
      mealItems: ev.mealItems
        .map((it) => {
          const hadStep = it.steps.some((s) => s.id === id);
          const removedStep = it.steps.find((s) => s.id === id);
          const nextSteps = it.steps
            .filter((s) => s.id !== id)
            .map((s) => ({
              ...s,
              dependencies: s.dependencies.filter((d) => d !== id),
              readyBeforeIds: s.readyBeforeIds.filter((d) => d !== id),
              relativeDeps: s.relativeDeps?.filter((r) => r.stepId !== id),
            }));
          const nextLog =
            hadStep && it.aiProcessedAt && removedStep
              ? [
                  ...it.manualChangeLog,
                  {
                    id: `chg-${Date.now()}`,
                    timestamp: Date.now(),
                    field: 'step:deleted',
                    summary: `Deleted step "${removedStep.title}"`,
                  },
                ]
              : it.manualChangeLog;
          return { ...it, steps: nextSteps, manualChangeLog: nextLog };
        })
        .filter((it) => it.steps.length > 0 || it.rawNotes || it.convertedNotes),
    }));
    setEditingStep(null);
    if (selectedStepId === id) setSelectedStepId(null);
  };

  const handleDuplicateStep = (orig: MealStep) => {
    pushUndo('Duplicate step');
    const copy: MealStep = {
      ...orig,
      id: `step-${Date.now()}`,
      title: `${orig.title} (Copy)`,
      status: 'pending',
      remainingSec: orig.durationMin * 60,
      addedMin: 0,
      actualStartMin: undefined,
      actualEndMin: undefined,
    };
    updateActiveEvent((ev) => ({
      ...ev,
      mealItems: ev.mealItems.map((it) =>
        it.steps.some((s) => s.id === orig.id)
          ? {
              ...it,
              steps: [...it.steps, copy],
              manualChangeLog: it.aiProcessedAt
                ? [
                    ...it.manualChangeLog,
                    {
                      id: `chg-${Date.now()}`,
                      timestamp: Date.now(),
                      field: 'step:duplicated',
                      summary: `Duplicated step "${orig.title}"`,
                    },
                  ]
                : it.manualChangeLog,
            }
          : it
      ),
    }));
    setEditingStep(null);
  };

  const toLibraryStepApplianceId = (applianceId: string): string => {
    if (!applianceId || applianceId.startsWith('category:')) return applianceId;
    const app = appliances.find((a) => a.id === applianceId);
    if (!app?.category) return applianceId;
    const categoryCount = appliances.filter((a) => a.category === app.category).length;
    if (app.category === 'Oven' || categoryCount > 1) {
      return `category:${app.category}`;
    }
    return applianceId;
  };

  const promptScheduleReviewForDish = (dishName: string, addedSteps: MealStep[]) => {
    const unassignedCount = addedSteps.filter((s) => !s.applianceId).length;
    if (unassignedCount > 0) {
      setScanNotice(
        `Added "${dishName}" (${unassignedCount} step${unassignedCount === 1 ? '' : 's'} need a cooking location). Want Gemini to assign appliances and optimize the timeline?`
      );
      setScanAiAdvice(null);
    } else if (activeEvent.mealItems.length > 0) {
      setScanNotice(
        `Added "${dishName}" to ${activeEvent.name}. Want Gemini to check for oven/prep conflicts or timing improvements?`
      );
      setScanAiAdvice(null);
    }
  };

  const handleAssignAppliance = (stepId: string, applianceId: string) => {
    const appLabel = applianceId.startsWith('category:')
      ? `Any ${applianceId.slice(9)}`
      : applianceMap.get(applianceId)?.name ?? 'Needs Location';
    pushUndo(`Assign step to ${appLabel}`);
    updateActiveEvent((ev) => ({
      ...ev,
      mealItems: ev.mealItems.map((it) => ({
        ...it,
        steps: it.steps.map((s) => (s.id === stepId ? { ...s, applianceId } : s)),
      })),
    }));
    showToast(`Assigned to ${appLabel}`);
  };

  const handleApplyScheduleUpdates = (updates: ScheduleAdjustmentProposal[]) => {
    if (updates.length === 0) return;
    const updateMap = new Map(updates.map((u) => [u.stepId, u]));
    pushUndo(`Apply ${updates.length} Gemini schedule adjustment${updates.length === 1 ? '' : 's'}`);
    updateActiveEvent((ev) => ({
      ...ev,
      mealItems: ev.mealItems.map((it) => ({
        ...it,
        steps: it.steps.map((s) => {
          const u = updateMap.get(s.id);
          if (!u) return s;
          return {
            ...s,
            ...(u.applianceId !== undefined ? { applianceId: u.applianceId } : {}),
            ...(u.pinnedStartMin !== undefined
              ? { pinnedStartMin: u.pinnedStartMin === null ? undefined : u.pinnedStartMin }
              : {}),
            ...(u.durationMin !== undefined ? { durationMin: Math.max(1, Math.round(u.durationMin)) } : {}),
            ...(u.temperature !== undefined
              ? { temperature: u.temperature === null ? undefined : u.temperature }
              : {}),
          };
        }),
      })),
    }));
    setScanNotice(null);
    setScanAiAdvice(null);
    showToast(`Applied ${updates.length} Gemini schedule update${updates.length === 1 ? '' : 's'}`);
  };

  // Meal Item (Dish) Actions
  const handleSaveMealItem = (saved: MealItem) => {
    const shouldReturnToLibrary = editingMealItem?.returnTo === 'library';

    if (editingMealItem?.target === 'library') {
      const libId = editingMealItem.item?.id ?? `lib-${Date.now()}`;
      const isUpdate = Boolean(editingMealItem.item);
      const libCopy: MealItem = {
        ...saved,
        id: libId,
        libraryItemId: libId,
        steps: saved.steps.map((s) => ({
          ...s,
          applianceId: toLibraryStepApplianceId(s.applianceId),
        })),
        manualChangeLog: [],
        updatedAt: Date.now(),
      };
      setWorkspace((prev) => {
        const exists = prev.mealLibrary.some((l) => l.id === libId);
        return {
          ...prev,
          updatedAt: Date.now(),
          mealLibrary: exists
            ? prev.mealLibrary.map((l) => (l.id === libId ? libCopy : l))
            : [...prev.mealLibrary, libCopy],
        };
      });
      setEditingMealItem(null);
      if (shouldReturnToLibrary) setShowLibraryModal(true);
      showToast(
        isUpdate
          ? `Updated "${saved.name}" in Meal Library`
          : `Saved "${saved.name}" to Meal Library`
      );
      return;
    }

    const isUpdate = Boolean(editingMealItem?.item);
    pushUndo(isUpdate ? 'Update dish' : 'Add dish');
    updateActiveEvent((ev) => {
      const exists = ev.mealItems.some((it) => it.id === saved.id);
      return {
        ...ev,
        mealItems: exists
          ? ev.mealItems.map((it) => (it.id === saved.id ? saved : it))
          : [...ev.mealItems, saved],
      };
    });
    setEditingMealItem(null);
    if (!isUpdate) {
      promptScheduleReviewForDish(saved.name, saved.steps);
    }
    showToast(isUpdate ? `Saved "${saved.name}"` : `Added "${saved.name}" to ${activeEvent.name}`);
  };

  const handleDeleteMealItem = (itemId: string) => {
    const shouldReturnToLibrary = editingMealItem?.returnTo === 'library';
    const deletedName = editingMealItem?.item?.name ?? 'dish';

    if (editingMealItem?.target === 'library') {
      setWorkspace((prev) => ({
        ...prev,
        updatedAt: Date.now(),
        mealLibrary: prev.mealLibrary.filter((l) => l.id !== itemId),
      }));
      setEditingMealItem(null);
      if (shouldReturnToLibrary) setShowLibraryModal(true);
      showToast(`Removed "${deletedName}" from Meal Library`);
      return;
    }

    pushUndo('Delete dish');
    updateActiveEvent((ev) => ({
      ...ev,
      mealItems: ev.mealItems.filter((it) => it.id !== itemId),
    }));
    setEditingMealItem(null);
    setSelectedDish(null);
    showToast(`Removed "${deletedName}"`);
  };

  const handleSaveToLibrary = (item: MealItem) => {
    const libId = item.libraryItemId ?? `lib-${Date.now()}`;
    const libCopy: MealItem = {
      ...item,
      id: libId,
      libraryItemId: libId,
      steps: item.steps.map((s) => ({
        ...s,
        applianceId: toLibraryStepApplianceId(s.applianceId),
      })),
      manualChangeLog: [],
      updatedAt: Date.now(),
    };
    setWorkspace((prev) => {
      const exists = prev.mealLibrary.some((l) => l.id === libId);
      return {
        ...prev,
        updatedAt: Date.now(),
        mealLibrary: exists
          ? prev.mealLibrary.map((l) => (l.id === libId ? libCopy : l))
          : [...prev.mealLibrary, libCopy],
      };
    });
    showToast(`Saved "${item.name}" to Meal Library`);
  };

  const handleImportFromLibrary = (libItem: MealItem) => {
    pushUndo(`Import "${libItem.name}" from Library`);
    const cloned = cloneItemForEvent(libItem);
    updateActiveEvent((ev) => ({
      ...ev,
      mealItems: [...ev.mealItems, cloned],
    }));
    promptScheduleReviewForDish(libItem.name, cloned.steps);
    showToast(`Added "${libItem.name}" to ${activeEvent.name}`);
  };

  const handleResetDemo = () => {
    pushUndo('Reset sample menu');
    const demoItems = stepsToMealItems(DEFAULT_STEPS);
    updateActiveEvent((ev) => ({
      ...ev,
      targetDinnerMin: 17 * 60,
      simulatedNowMin: 12 * 60 + 30,
      mealItems: demoItems,
      appliancesOverride: null,
    }));
    setWorkspace((prev) => ({ ...prev, defaultAppliances: DEFAULT_APPLIANCES }));
  };

  const handleClearAllSteps = () => {
    if (activeEvent.mealItems.length === 0) return;
    pushUndo('Clear all dishes');
    updateActiveEvent((ev) => ({ ...ev, mealItems: [] }));
    setSelectedStepId(null);
    setSelectedDish(null);
    setMutedAlarms(new Set());
  };

  const handleReorderAppliances = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    pushUndo('Reorder appliances');
    const reordered = [...appliances];
    const [moved] = reordered.splice(fromIdx, 1);
    if (!moved) return;
    reordered.splice(toIdx, 0, moved);

    if (activeEvent.appliancesOverride) {
      updateActiveEvent((ev) => ({ ...ev, appliancesOverride: reordered }));
    } else {
      setWorkspace((prev) => ({ ...prev, updatedAt: Date.now(), defaultAppliances: reordered }));
    }
  };

  const handleMoveStep = (stepId: string, newStartMin: number) => {
    pushUndo('Move step on timeline');
    mutateEventSteps(
      (s) => (s.id === stepId ? { ...s, pinnedStartMin: newStartMin } : s),
      (item) => {
        const target = item.steps.find((s) => s.id === stepId);
        return target
          ? `Moved "${target.title}" to ${formatTimeMin(newStartMin)}`
          : null;
      }
    );
  };

  const handleScanManualChanges = () => {
    const modifiedItems = activeEvent.mealItems.filter((it) => it.manualChangeLog.length > 0);
    setScanAiAdvice(null);
    if (modifiedItems.length === 0) {
      setScanNotice('All dishes & timeline steps are synced. No pending manual edits.');
    } else {
      setScanNotice(
        `Timeline synced! ${modifiedItems.length} dish(es) have manual edits since AI processing: ${modifiedItems
          .map((m) => m.name)
          .join(', ')}.`
      );
    }
  };

  const handleAiReEvaluate = async () => {
    if (!settings.geminiApiKey.trim()) {
      setShowGeminiModal(true);
      return;
    }
    setScanAiLoading(true);
    try {
      const advice = await reEvaluateEventWithGemini(
        settings.geminiApiKey,
        activeEvent.mealItems,
        appliances,
        targetDinnerMin
      );
      setScanAiAdvice(advice);
    } catch (err) {
      setScanNotice(err instanceof Error ? err.message : 'Failed to run AI re-evaluation.');
    } finally {
      setScanAiLoading(false);
    }
  };

  // Dish Groups derived from activeEvent.mealItems
  const dishGroups = useMemo(() => {
    const startByDish = new Map<string, number>();
    for (const s of schedule.steps) {
      const cur = startByDish.get(s.dish);
      if (cur === undefined || s.startMin < cur) startByDish.set(s.dish, s.startMin);
    }
    return [...activeEvent.mealItems]
      .map((item) => ({
        item,
        count: item.steps.length,
        earliestStartMin: startByDish.get(item.name) ?? targetDinnerMin,
      }))
      .sort((a, b) => a.earliestStartMin - b.earliestStartMin || a.item.name.localeCompare(b.item.name));
  }, [activeEvent.mealItems, schedule.steps, targetDinnerMin]);

  const activeDishGroup = useMemo(
    () => (selectedDish ? dishGroups.find((g) => g.item.name === selectedDish) ?? null : null),
    [selectedDish, dishGroups]
  );

  const dishSteps = useMemo(() => {
    if (!activeDishGroup) return [];
    return schedule.steps
      .filter((s) => s.dish === activeDishGroup.item.name)
      .sort((a, b) => a.startMin - b.startMin);
  }, [schedule.steps, activeDishGroup]);

  // Partition steps for Kitchen Mode panel
  const activeSteps = useMemo(
    () =>
      schedule.steps
        .filter((s) => s.status === 'running' || s.status === 'paused')
        .sort((a, b) => a.remainingSec - b.remainingSec),
    [schedule.steps]
  );

  const upNextSteps = useMemo(
    () =>
      schedule.steps
        .filter((s) => s.status === 'pending')
        .sort((a, b) => a.startMin - b.startMin),
    [schedule.steps]
  );

  const doneSteps = useMemo(
    () =>
      schedule.steps
        .filter((s) => s.status === 'done')
        .sort((a, b) => (b.actualEndMin ?? b.endMin) - (a.actualEndMin ?? a.endMin)),
    [schedule.steps]
  );

  const delta = schedule.dinnerDeltaMin;
  const totalManualEdits = activeEvent.mealItems.reduce(
    (sum, it) => sum + it.manualChangeLog.length,
    0
  );

  return (
    <div className="app-shell">
      {/* Top Command Bar */}
      <header className="top-bar">
        <div className="brand-group">
          <div className="brand-mark">
            <Utensils size={18} />
          </div>
          <div>
            <h1 className="brand-title">ThymeLine</h1>
            <div className="brand-subtitle">
              Family Meal Scheduler · Start by{' '}
              <strong className="mono">{formatTimeMin(schedule.earliestStartMin)}</strong>
            </div>
          </div>
        </div>

        {/* Multi-Event Selector */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'var(--bg-canvas)',
            border: '1px solid var(--border-light)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px 6px',
          }}
        >
          <Calendar size={14} color="var(--accent-sage)" />
          <select
            aria-label="Select Event"
            value={activeEvent.id}
            onChange={(e) => {
              setWorkspace((prev) => ({ ...prev, activeEventId: e.target.value }));
              setSelectedStepId(null);
              setSelectedDish(null);
              setScanNotice(null);
              setScanAiAdvice(null);
            }}
            style={{
              border: 'none',
              background: 'transparent',
              fontWeight: 600,
              fontSize: '0.8rem',
              color: 'var(--ink-primary)',
              outline: 'none',
            }}
          >
            {workspace.events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-icon"
            style={{ padding: 3 }}
            title="New Event"
            onClick={handleCreateEvent}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="btn-icon"
            style={{ padding: 3 }}
            title="Rename Current Event"
            onClick={handleRenameEvent}
          >
            <Edit3 size={13} />
          </button>
          {workspace.events.length > 1 && (
            <button
              type="button"
              className="btn-icon"
              style={{ padding: 3, color: 'var(--status-crimson)' }}
              title="Delete Current Event"
              onClick={handleDeleteEvent}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>

        {/* Serve Target & Projected Status */}
        <div className="dinner-cluster">
          <label className="dinner-field">
            <span>Target Serve</span>
            <input
              type="time"
              value={minToTimeInput(targetDinnerMin)}
              onChange={(e) => {
                pushUndo('Change serve time');
                const nextMin = timeInputToMin(e.target.value);
                updateActiveEvent((ev) => ({ ...ev, targetDinnerMin: nextMin }));
              }}
            />
          </label>
          <span
            className={`status-badge ${delta > 0 ? 'behind' : delta < 0 ? 'ahead' : 'on-time'}`}
          >
            {delta > 0
              ? `Projected ${formatTimeMin(schedule.projectedDinnerMin)} (+${delta}m late)`
              : delta < 0
              ? `Projected ${formatTimeMin(schedule.projectedDinnerMin)} (${Math.abs(delta)}m early)`
              : `On Time (${formatTimeMin(schedule.projectedDinnerMin)})`}
          </span>
        </div>

        {/* Clock & Actions */}
        <div className="toolbar-actions">
          <div className="clock-sim-bar">
            <div
              role="group"
              aria-label="Schedule mode"
              style={{
                display: 'inline-flex',
                borderRadius: 8,
                border: '1px solid var(--border-strong)',
                overflow: 'hidden',
                background: 'var(--bg-canvas)',
              }}
            >
              <button
                type="button"
                className={`btn ${settings.useSimulatedClock ? 'btn-primary' : 'btn-ghost'}`}
                style={{
                  padding: '4px 9px',
                  fontSize: '0.74rem',
                  borderRadius: 0,
                  border: 'none',
                }}
                onClick={() => setSettings((s) => ({ ...s, useSimulatedClock: true }))}
                title="Planning Mode: plan ahead without being limited by the current time of day"
              >
                Planning
              </button>
              <button
                type="button"
                className={`btn ${!settings.useSimulatedClock ? 'btn-primary' : 'btn-ghost'}`}
                style={{
                  padding: '4px 9px',
                  fontSize: '0.74rem',
                  borderRadius: 0,
                  border: 'none',
                }}
                onClick={() => setSettings((s) => ({ ...s, useSimulatedClock: false }))}
                title="Execution Mode (Day-Of): track live real-world time, timers, and alarms"
              >
                <Clock size={12} />
                {!settings.useSimulatedClock ? `Execution · ${formatTimeMin(nowMin)}` : 'Execution'}
              </button>
            </div>
            {settings.useSimulatedClock && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span
                  style={{ fontSize: '0.7rem', color: 'var(--ink-muted)', fontWeight: 600 }}
                  title={
                    isAutoSim
                      ? 'Automatically matches suggested start time for your chosen dishes'
                      : 'Custom simulated start time'
                  }
                >
                  Sim:
                </span>
                <input
                  type="time"
                  aria-label="Simulated current time"
                  value={minToTimeInput(nowMin)}
                  onChange={(e) => {
                    const nextMin = timeInputToMin(e.target.value);
                    updateActiveEvent((ev) => ({
                      ...ev,
                      simulatedNowMin: nextMin,
                      simTimeOverridden: true,
                    }));
                  }}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    padding: '3px 6px',
                    borderRadius: 6,
                    border: '1px solid var(--border-strong)',
                    background: 'var(--bg-surface)',
                    color: 'var(--ink-primary)',
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 7px', fontSize: '0.72rem' }}
                  onClick={() =>
                    updateActiveEvent((ev) => ({
                      ...ev,
                      simulatedNowMin: nowMin - 15,
                      simTimeOverridden: true,
                    }))
                  }
                >
                  -15m
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 7px', fontSize: '0.72rem' }}
                  onClick={() =>
                    updateActiveEvent((ev) => ({
                      ...ev,
                      simulatedNowMin: nowMin + 15,
                      simTimeOverridden: true,
                    }))
                  }
                >
                  +15m
                </button>
                {activeEvent.simTimeOverridden && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: '4px 6px', fontSize: '0.7rem' }}
                    title={`Reset Sim time to suggested start (${formatTimeMin(schedule.suggestedStartMin)})`}
                    onClick={() =>
                      updateActiveEvent((ev) => ({
                        ...ev,
                        simTimeOverridden: false,
                        simulatedNowMin: schedule.suggestedStartMin,
                      }))
                    }
                  >
                    Auto
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className={`btn-icon ${settings.soundEnabled ? 'active' : ''}`}
            onClick={() => {
              soundManager.unlock();
              setSettings((s) => ({ ...s, soundEnabled: !s.soundEnabled }));
            }}
            title={settings.soundEnabled ? 'Alarms On (click to mute)' : 'Alarms Muted (click to unmute)'}
          >
            {settings.soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          {undoStack.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleUndo}
              title={`Undo: ${undoStack[undoStack.length - 1].label}`}
            >
              <Undo2 size={14} /> Undo
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowLibraryModal(true)}
            title="Browse & import saved dishes"
          >
            <BookOpen size={14} /> Library
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowApplianceModal(true)}
          >
            <SlidersHorizontal size={14} /> Appliances
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowGeminiModal(true)}
          >
            <Sparkles size={14} color="var(--accent-sage)" /> Gemini
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowSyncModal(true)}
            title="Cloudflare R2/KV Sync"
          >
            <Cloud size={14} /> Sync
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowSettingsModal(true)}
            title="API Key, Sync Passcode, Audio/Voice Tests & Clock Settings"
          >
            <Settings size={14} /> Settings
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditingMealItem({ item: null, target: 'event' })}
          >
            <Plus size={15} /> Add Dish
          </button>
        </div>
      </header>

      {/* Cycle / Dependency Warning Banner */}
      {schedule.cycleError && (
        <div className="alert-banner">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} /> {schedule.cycleError}
          </span>
          <button type="button" className="btn btn-secondary" onClick={handleUndo}>
            Undo Last Change
          </button>
        </div>
      )}

      {/* Main Split Workspace */}
      <main className="workspace-split">
        {/* Left: Kitchen Mode (Dishes, Active Timers & Up Next) */}
        <aside className="kitchen-panel">
          <div className="panel-header">
            <span className="panel-title">
              <Bell size={15} /> Kitchen Mode
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{
                  fontSize: '0.73rem',
                  padding: '3px 7px',
                  color: totalManualEdits > 0 ? 'var(--accent-brass)' : undefined,
                }}
                onClick={handleScanManualChanges}
                title="Scan for manual dish edits and sync timeline"
              >
                <RefreshCw size={12} /> Scan{totalManualEdits > 0 ? ` (${totalManualEdits})` : ''}
              </button>
              {activeEvent.mealItems.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: '0.73rem', padding: '3px 7px', color: 'var(--status-crimson)' }}
                  onClick={handleClearAllSteps}
                  title="Remove all dishes to start fresh (can be undone)"
                >
                  <Trash2 size={12} /> Clear
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: '0.73rem', padding: '3px 7px' }}
                onClick={handleResetDemo}
                title="Reset to sample holiday menu"
              >
                <RotateCcw size={12} /> Sample
              </button>
            </div>
          </div>

          <div className="kitchen-scroll">
            {/* Scan Notification Banner */}
            {scanNotice && (
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: totalManualEdits > 0 ? 'var(--status-amber-soft)' : 'var(--status-sage-soft)',
                  border: '1px solid var(--border-strong)',
                  fontSize: '0.76rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>{scanNotice}</span>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: '0.72rem', padding: '0 4px' }}
                    onClick={() => {
                      setScanNotice(null);
                      setScanAiAdvice(null);
                    }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-start', padding: '3px 8px', fontSize: '0.72rem' }}
                    onClick={() => setShowGeminiModal(true)}
                  >
                    <Sparkles size={12} />
                    Ask Gemini to Optimize
                  </button>
                  {totalManualEdits > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ alignSelf: 'flex-start', padding: '3px 8px', fontSize: '0.72rem' }}
                      onClick={handleAiReEvaluate}
                      disabled={scanAiLoading}
                    >
                      <Sparkles size={12} />
                      {scanAiLoading ? 'Evaluating...' : 'Quick AI Summary'}
                    </button>
                  )}
                </div>
                {scanAiAdvice && (
                  <div className="advice-box" style={{ fontSize: '0.75rem', padding: 8 }}>
                    {scanAiAdvice}
                  </div>
                )}
              </div>
            )}

            {/* Dish Groups Filter */}
            {dishGroups.length > 0 && (
              <div>
                <div className="section-label">
                  <span>Dishes ({dishGroups.length})</span>
                  {activeDishGroup && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: '0.7rem', padding: '1px 6px' }}
                      onClick={() => setSelectedDish(null)}
                    >
                      Show All
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 4 }}>
                  <button
                    type="button"
                    className={`btn ${activeDishGroup === null ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '3px 9px', fontSize: '0.73rem' }}
                    onClick={() => setSelectedDish(null)}
                  >
                    All ({schedule.steps.length})
                  </button>
                  {dishGroups.map((g) => (
                    <button
                      key={g.item.id}
                      type="button"
                      className={`btn ${
                        activeDishGroup?.item.id === g.item.id ? 'btn-primary' : 'btn-secondary'
                      }`}
                      style={{ padding: '3px 9px', fontSize: '0.73rem' }}
                      onClick={() =>
                        setSelectedDish((cur) => (cur === g.item.name ? null : g.item.name))
                      }
                    >
                      {g.item.name} ({g.count})
                      {g.item.manualChangeLog.length > 0 ? ' •' : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Focused Dish Group Record & Steps */}
            {activeDishGroup ? (
              <div>
                <div
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-canvas)',
                    border: '1px solid var(--border-strong)',
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                        {activeDishGroup.item.name}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--ink-secondary)', marginTop: 2 }}>
                        {activeDishGroup.item.course} · {formatFinishLabel(activeDishGroup.item)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 8px', fontSize: '0.73rem' }}
                        onClick={() =>
                          setEditingStep({
                            step: null,
                            parentItemId: activeDishGroup.item.id,
                            defaultDish: activeDishGroup.item.name,
                          })
                        }
                        title="Add a new step to this dish"
                      >
                        <Plus size={12} /> Add Step
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ padding: '4px 9px', fontSize: '0.73rem' }}
                        onClick={() =>
                          setEditingMealItem({ item: activeDishGroup.item, target: 'event' })
                        }
                      >
                        <Edit3 size={12} /> Edit Dish
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{
                          padding: '4px 7px',
                          fontSize: '0.73rem',
                          color: 'var(--status-crimson)',
                        }}
                        title="Delete entire dish and all its steps from this event"
                        onClick={() => {
                          const targetId = activeDishGroup.item.id;
                          const targetName = activeDishGroup.item.name;
                          pushUndo(`Delete dish "${targetName}"`);
                          updateActiveEvent((ev) => ({
                            ...ev,
                            mealItems: ev.mealItems.filter((it) => it.id !== targetId),
                          }));
                          setSelectedDish(null);
                          showToast(`Deleted "${targetName}" and its steps`);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {(activeDishGroup.item.convertedNotes || activeDishGroup.item.rawNotes) && (
                    <div
                      style={{
                        fontSize: '0.76rem',
                        color: 'var(--ink-secondary)',
                        marginTop: 6,
                        whiteSpace: 'pre-line',
                      }}
                    >
                      {activeDishGroup.item.convertedNotes || activeDishGroup.item.rawNotes}
                    </div>
                  )}
                </div>

                <div className="section-label">
                  <span>
                    {activeDishGroup.item.name} Steps ({dishSteps.length})
                  </span>
                </div>
                {dishSteps.map((s) => {
                  const app = applianceMap.get(s.resolvedApplianceId || s.applianceId);
                  return (
                    <div
                      key={s.id}
                      className="upnext-item"
                      onClick={() => {
                        setSelectedStepId(s.id);
                        setEditingStep({ step: s, parentItemId: activeDishGroup.item.id });
                      }}
                      style={{
                        cursor: 'pointer',
                        background: s.status === 'done' ? 'var(--status-sage-soft)' : undefined,
                        opacity: s.status === 'done' ? 0.78 : 1,
                      }}
                    >
                      <div className="upnext-info">
                        <div
                          className="upnext-title"
                          style={{
                            textDecoration: s.status === 'done' ? 'line-through' : undefined,
                          }}
                        >
                          {s.title}
                        </div>
                        <div className="upnext-sub">
                          <span className="mono" style={{ fontWeight: 600 }}>
                            {formatTimeMin(s.startMin)}–{formatTimeMin(s.endMin)}
                          </span>
                          <span>· {formatDuration(s.durationMin + (s.addedMin || 0))}</span>
                          <span>· {app?.name}</span>
                          {s.temperature !== undefined && (
                            <span className="pill temp">{s.temperature}°F</span>
                          )}
                          {s.isDelayed && <span className="pill delayed">+{s.delayMin}m</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        {s.status === 'pending' && s.requiresTimer === false && (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                startStep(s.id);
                              }}
                              title="Mark prep in progress (no countdown alarm)"
                            >
                              Begin
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                completeStep(s.id);
                              }}
                            >
                              <Check size={11} /> Done
                            </button>
                          </>
                        )}
                        {s.status === 'pending' && s.requiresTimer !== false && (
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              startStep(s.id);
                            }}
                          >
                            <Play size={11} /> Start
                          </button>
                        )}
                        {(s.status === 'running' || s.status === 'paused') && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              completeStep(s.id);
                            }}
                          >
                            <Check size={11} /> Done
                          </button>
                        )}
                        {s.status === 'done' && (
                          <>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 7px', fontSize: '0.72rem' }}
                              title="Needs more time — reopen with +5m timer"
                              onClick={(e) => {
                                e.stopPropagation();
                                reopenAndExtendStep(s.id, 5);
                              }}
                            >
                              +5m
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.72rem' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                reopenStep(s.id);
                              }}
                            >
                              Reopen
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                {/* Active Timers */}
                <div>
                  <div className="section-label">
                    <span>Active Timers ({activeSteps.length})</span>
                  </div>
                  {activeSteps.length === 0 ? (
                    <div
                      style={{
                        padding: '14px 12px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px dashed var(--border-strong)',
                        fontSize: '0.8rem',
                        color: 'var(--ink-muted)',
                        textAlign: 'center',
                      }}
                    >
                      No timers running. Click <strong>Start</strong> on any step below or on the
                      timeline.
                    </div>
                  ) : (
                    activeSteps.map((s) => {
                      const app = applianceMap.get(s.resolvedApplianceId || s.applianceId);
                      const isUntimed = s.requiresTimer === false;
                      const isRinging = !isUntimed && s.status === 'running' && s.remainingSec <= 0;
                      const totalPlannedSec = Math.max(60, (s.durationMin + s.addedMin) * 60);
                      const pct = Math.max(
                        0,
                        Math.min(100, ((totalPlannedSec - s.remainingSec) / totalPlannedSec) * 100)
                      );

                      return (
                        <div key={s.id} className={`timer-card ${isRinging ? 'ringing' : ''}`}>
                          <div className="timer-card-top">
                            <div>
                              <div className="timer-title">{s.title}</div>
                              <div className="timer-meta">
                                <span>{app?.name}</span>
                                {isUntimed && (
                                  <span className="pill" style={{ background: 'var(--bg-canvas)' }}>
                                    Prep · No Timer
                                  </span>
                                )}
                                {s.temperature !== undefined && (
                                  <span className="pill temp">
                                    <Flame size={10} /> {s.temperature}°F
                                  </span>
                                )}
                              </div>
                            </div>
                            {isRinging && (
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '3px 7px', fontSize: '0.72rem' }}
                                onClick={() =>
                                  setMutedAlarms((prev) => new Set(prev).add(s.id))
                                }
                              >
                                Silence
                              </button>
                            )}
                          </div>

                          {isUntimed ? (
                            <div
                              style={{
                                fontSize: '0.8rem',
                                color: 'var(--ink-secondary)',
                                margin: '6px 0 10px',
                              }}
                            >
                              In progress · Est. {formatDuration(s.durationMin)} (finish by{' '}
                              <span className="mono">{formatTimeMin(s.endMin)}</span>)
                            </div>
                          ) : (
                            <>
                              <div className="timer-readout">
                                {formatCountdownSec(s.remainingSec)}
                                {isRinging && (
                                  <span style={{ fontSize: '0.78rem', marginLeft: 8, fontWeight: 600 }}>
                                    OVERTIME
                                  </span>
                                )}
                              </div>

                              <div className="progress-track">
                                <div className="progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                            </>
                          )}

                          <div className="timer-controls">
                            <button
                              type="button"
                              className="btn-timer done"
                              onClick={() => completeStep(s.id)}
                            >
                              <Check size={14} /> Done
                            </button>
                            {!isUntimed && (
                              <>
                                <button
                                  type="button"
                                  className="btn-timer"
                                  onClick={() => extendStep(s.id, 2)}
                                >
                                  +2m
                                </button>
                                <button
                                  type="button"
                                  className="btn-timer"
                                  onClick={() => extendStep(s.id, 5)}
                                >
                                  +5m
                                </button>
                                <button
                                  type="button"
                                  className="btn-timer"
                                  onClick={() => extendStep(s.id, 10)}
                                >
                                  +10m
                                </button>
                                <button
                                  type="button"
                                  className="btn-timer"
                                  onClick={() => extendStep(s.id, 15)}
                                >
                                  +15m
                                </button>
                                {s.status === 'running' ? (
                                  <button
                                    type="button"
                                    className="btn-timer"
                                    onClick={() => pauseStep(s.id)}
                                  >
                                    <Pause size={13} />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn-timer"
                                    onClick={() => startStep(s.id)}
                                  >
                                    <Play size={13} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Up Next */}
                <div>
                  <div className="section-label">
                    <span>Up Next ({upNextSteps.length})</span>
                  </div>
                  {upNextSteps.map((s) => {
                    const app = applianceMap.get(s.resolvedApplianceId || s.applianceId);
                    const startsIn = s.startMin - nowMin;
                    return (
                      <div
                        key={s.id}
                        className="upnext-item"
                        onClick={() => {
                          setSelectedStepId(s.id);
                          setEditingStep({ step: s });
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="upnext-info">
                          <div className="upnext-title">{s.title}</div>
                          <div className="upnext-sub">
                            <span className="mono" style={{ fontWeight: 600 }}>
                              {formatTimeMin(s.startMin)}
                            </span>
                            <span>· {formatDuration(s.durationMin)}</span>
                            <span>· {app?.name}</span>
                            {s.temperature !== undefined && (
                              <span className="pill temp">{s.temperature}°F</span>
                            )}
                            {s.requiresTimer === false && (
                              <span className="pill" style={{ background: 'var(--bg-canvas)' }}>
                                Start Alert
                              </span>
                            )}
                            {s.isDelayed && <span className="pill delayed">+{s.delayMin}m</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {startsIn <= 0 && (
                            <span
                              style={{
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                color: 'var(--accent-sage)',
                              }}
                            >
                              DUE
                            </span>
                          )}
                          {s.requiresTimer === false ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '5px 8px', fontSize: '0.73rem' }}
                                title="Mark prep in progress (no countdown timer)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startStep(s.id);
                                }}
                              >
                                Begin
                              </button>
                              <button
                                type="button"
                                className="btn btn-primary"
                                style={{ padding: '5px 8px', fontSize: '0.73rem' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  completeStep(s.id);
                                }}
                              >
                                <Check size={12} /> Done
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '5px 9px', fontSize: '0.75rem' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                startStep(s.id);
                              }}
                            >
                              <Play size={12} /> Start
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Completed */}
                {doneSteps.length > 0 && (
                  <div>
                    <div className="section-label">
                      <span>Completed ({doneSteps.length})</span>
                    </div>
                    {doneSteps.map((s) => (
                      <div
                        key={s.id}
                        className="upnext-item"
                        style={{ opacity: 0.7, background: 'var(--status-sage-soft)' }}
                      >
                        <div className="upnext-info">
                          <div className="upnext-title" style={{ textDecoration: 'line-through' }}>
                            {s.title}
                          </div>
                          <div className="upnext-sub">
                            Finished {formatTimeMin(s.actualEndMin ?? s.endMin)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '3px 7px', fontSize: '0.72rem' }}
                          onClick={() => reopenStep(s.id)}
                        >
                          Reopen
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Right: Appliance-Lane Gantt Timeline */}
        <GanttTimeline
          appliances={appliances}
          steps={schedule.steps}
          earliestStartMin={schedule.earliestStartMin}
          projectedDinnerMin={schedule.projectedDinnerMin}
          targetDinnerMin={targetDinnerMin}
          nowMin={nowMin}
          selectedStepId={selectedStepId}
          highlightedDish={activeDishGroup?.item.name ?? null}
          onSelectStep={(step: ScheduledStep) => {
            setSelectedStepId(step.id);
            setEditingStep({ step });
          }}
          onStartStep={startStep}
          onMoveStep={handleMoveStep}
          onReorderAppliances={handleReorderAppliances}
          onAssignAppliance={handleAssignAppliance}
        />
      </main>

      {/* Modals */}
      {editingStep !== null && (
        <StepModal
          step={editingStep.step}
          defaultDish={editingStep.defaultDish}
          allSteps={
            editingStep.returnToItem?.target === 'library'
              ? workspace.mealLibrary.find((l) => l.id === editingStep.returnToItem?.id)?.steps ?? []
              : steps
          }
          appliances={appliances}
          onSave={(saved) => {
            const ret = editingStep.returnToItem;
            if (ret?.target === 'library') {
              const parent = workspace.mealLibrary.find((l) => l.id === ret.id);
              if (parent) {
                const updatedParent: MealItem = {
                  ...parent,
                  steps: parent.steps.some((s) => s.id === saved.id)
                    ? parent.steps.map((s) => (s.id === saved.id ? saved : s))
                    : [...parent.steps, { ...saved, dish: parent.name }],
                  updatedAt: Date.now(),
                };
                setWorkspace((prev) => ({
                  ...prev,
                  updatedAt: Date.now(),
                  mealLibrary: prev.mealLibrary.map((l) => (l.id === ret.id ? updatedParent : l)),
                }));
                setEditingStep(null);
                setEditingMealItem({
                  item: updatedParent,
                  target: 'library',
                  returnTo: ret.returnTo,
                });
              } else {
                setEditingStep(null);
              }
              showToast(`Saved library step "${saved.title}"`);
              return;
            }

            handleSaveStep(saved);
            showToast(`Saved step "${saved.title}"`);
            if (ret) {
              const parent = activeEvent.mealItems.find((it) => it.id === ret.id);
              if (parent) {
                const updatedParent: MealItem = {
                  ...parent,
                  steps: parent.steps.some((s) => s.id === saved.id)
                    ? parent.steps.map((s) => (s.id === saved.id ? saved : s))
                    : [...parent.steps, { ...saved, dish: parent.name }],
                };
                setEditingMealItem({
                  item: updatedParent,
                  target: ret.target,
                  returnTo: ret.returnTo,
                });
              }
            }
          }}
          onDelete={(id) => {
            const ret = editingStep.returnToItem;
            if (ret?.target === 'library') {
              const parent = workspace.mealLibrary.find((l) => l.id === ret.id);
              if (parent) {
                const updatedParent: MealItem = {
                  ...parent,
                  steps: parent.steps
                    .filter((s) => s.id !== id)
                    .map((s) => ({
                      ...s,
                      dependencies: s.dependencies.filter((d) => d !== id),
                      readyBeforeIds: s.readyBeforeIds.filter((d) => d !== id),
                    })),
                  updatedAt: Date.now(),
                };
                setWorkspace((prev) => ({
                  ...prev,
                  updatedAt: Date.now(),
                  mealLibrary: prev.mealLibrary.map((l) => (l.id === ret.id ? updatedParent : l)),
                }));
                setEditingStep(null);
                setEditingMealItem({
                  item: updatedParent,
                  target: 'library',
                  returnTo: ret.returnTo,
                });
              } else {
                setEditingStep(null);
              }
              showToast('Deleted library step');
              return;
            }

            handleDeleteStep(id);
            showToast('Deleted cooking step');
            if (ret) {
              const parent = activeEvent.mealItems.find((it) => it.id === ret.id);
              if (parent) {
                setEditingMealItem({
                  item: { ...parent, steps: parent.steps.filter((s) => s.id !== id) },
                  target: ret.target,
                  returnTo: ret.returnTo,
                });
              }
            }
          }}
          onDuplicate={(orig) => {
            const ret = editingStep.returnToItem;
            if (ret?.target === 'library') {
              const parent = workspace.mealLibrary.find((l) => l.id === ret.id);
              if (parent) {
                const copy: MealStep = {
                  ...orig,
                  id: `step-${Date.now()}`,
                  title: `${orig.title} (Copy)`,
                  status: 'pending',
                  remainingSec: orig.durationMin * 60,
                  addedMin: 0,
                  actualStartMin: undefined,
                  actualEndMin: undefined,
                };
                const updatedParent: MealItem = {
                  ...parent,
                  steps: [...parent.steps, copy],
                  updatedAt: Date.now(),
                };
                setWorkspace((prev) => ({
                  ...prev,
                  updatedAt: Date.now(),
                  mealLibrary: prev.mealLibrary.map((l) => (l.id === ret.id ? updatedParent : l)),
                }));
                setEditingStep(null);
                setEditingMealItem({
                  item: updatedParent,
                  target: 'library',
                  returnTo: ret.returnTo,
                });
              }
              showToast(`Duplicated "${orig.title}"`);
              return;
            }

            handleDuplicateStep(orig);
            showToast(`Duplicated "${orig.title}"`);
          }}
          onClose={() => {
            const ret = editingStep.returnToItem;
            setEditingStep(null);
            if (ret) {
              const sourceList =
                ret.target === 'library' ? workspace.mealLibrary : activeEvent.mealItems;
              const parent = sourceList.find((it) => it.id === ret.id);
              if (parent) {
                setEditingMealItem({
                  item: parent,
                  target: ret.target,
                  returnTo: ret.returnTo,
                });
              }
            }
          }}
        />
      )}

      {editingMealItem !== null && (
        <MealItemModal
          item={editingMealItem.item}
          mode={editingMealItem.target}
          libraryItems={workspace.mealLibrary}
          appliances={appliances}
          otherItems={
            editingMealItem.target === 'event'
              ? activeEvent.mealItems.filter((it) => it.id !== editingMealItem.item?.id)
              : []
          }
          allEventSteps={steps}
          apiKey={settings.geminiApiKey}
          onOpenSettings={() => setShowSettingsModal(true)}
          onSave={handleSaveMealItem}
          onDelete={handleDeleteMealItem}
          onSaveToLibrary={handleSaveToLibrary}
          onQuickImportFromLibrary={handleImportFromLibrary}
          onClose={() => {
            const shouldReturnToLibrary = editingMealItem.returnTo === 'library';
            setEditingMealItem(null);
            if (shouldReturnToLibrary) setShowLibraryModal(true);
          }}
        />
      )}

      {showLibraryModal && (
        <MealLibraryModal
          library={workspace.mealLibrary}
          activeEventName={activeEvent.name}
          onImportToEvent={handleImportFromLibrary}
          onEditLibraryItem={(libItem) => {
            setShowLibraryModal(false);
            setEditingMealItem({ item: libItem, target: 'library', returnTo: 'library' });
          }}
          onCreateLibraryItem={() => {
            setShowLibraryModal(false);
            setEditingMealItem({ item: null, target: 'library', returnTo: 'library' });
          }}
          onDeleteFromLibrary={(libId) => {
            const target = workspace.mealLibrary.find((l) => l.id === libId);
            setWorkspace((prev) => ({
              ...prev,
              updatedAt: Date.now(),
              mealLibrary: prev.mealLibrary.filter((l) => l.id !== libId),
            }));
            showToast(`Removed "${target?.name ?? 'dish'}" from Meal Library`);
          }}
          onClose={() => setShowLibraryModal(false)}
        />
      )}

      {showApplianceModal && (
        <ApplianceModal
          appliances={appliances}
          onSave={(updated: Appliance[]) => {
            pushUndo('Update appliances');
            if (activeEvent.appliancesOverride) {
              updateActiveEvent((ev) => ({ ...ev, appliancesOverride: updated }));
            } else {
              setWorkspace((prev) => ({
                ...prev,
                updatedAt: Date.now(),
                defaultAppliances: updated,
              }));
            }
            setShowApplianceModal(false);
            showToast('Saved kitchen appliances');
          }}
          onClose={() => setShowApplianceModal(false)}
        />
      )}

      {showGeminiModal && (
        <GeminiModal
          appliances={appliances}
          mealItems={activeEvent.mealItems}
          steps={steps}
          scheduledSteps={schedule.steps}
          targetDinnerMin={targetDinnerMin}
          projectedDinnerMin={schedule.projectedDinnerMin}
          apiKey={settings.geminiApiKey}
          onOpenSettings={() => setShowSettingsModal(true)}
          onApplyScheduleUpdates={handleApplyScheduleUpdates}
          onImportSteps={(imported, mode) => {
            const newItems = stepsToMealItems(imported);
            if (mode === 'add') {
              pushUndo(`Add ${imported.length} step${imported.length === 1 ? '' : 's'} via Gemini`);
              const merged = mergeImportedSteps(steps, imported);
              const mergedIds = new Set(merged.slice(steps.length).map((s) => s.id));
              const addedItems = stepsToMealItems(merged.filter((s) => mergedIds.has(s.id)));
              updateActiveEvent((ev) => ({
                ...ev,
                mealItems: [...ev.mealItems, ...addedItems],
              }));
              showToast(`Added ${imported.length} step(s) to ${activeEvent.name}`);
            } else {
              pushUndo('Import schedule');
              updateActiveEvent((ev) => ({ ...ev, mealItems: newItems }));
              setSelectedStepId(null);
              setSelectedDish(null);
              setMutedAlarms(new Set());
              showToast(`Imported ${imported.length} step(s) into ${activeEvent.name}`);
            }
          }}
          onClose={() => setShowGeminiModal(false)}
        />
      )}

      {showSyncModal && (
        <SyncModal
          workspace={workspace}
          passcode={settings.syncPasscode}
          onOpenSettings={() => setShowSettingsModal(true)}
          onApplyRemoteWorkspace={(remote) => {
            setWorkspace(remote);
            setSelectedStepId(null);
            setSelectedDish(null);
            showToast(`Synced from cloud (v${remote.syncVersion})`);
          }}
          onMarkSynced={(syncVersion, updatedAt) => {
            setWorkspace((prev) => ({ ...prev, syncVersion, updatedAt }));
            showToast(`Saved to cloud (v${syncVersion})`);
          }}
          onClose={() => setShowSyncModal(false)}
        />
      )}

      {showSettingsModal && (
        <SettingsModal
          settings={settings}
          simulatedNowMin={nowMin}
          simTimeOverridden={Boolean(activeEvent.simTimeOverridden)}
          onSave={(nextSettings, nextSimMin, nextSimOverridden) => {
            setSettings(nextSettings);
            updateActiveEvent((ev) => ({
              ...ev,
              ...(typeof nextSimMin === 'number' ? { simulatedNowMin: nextSimMin } : {}),
              ...(nextSimOverridden !== undefined ? { simTimeOverridden: nextSimOverridden } : {}),
            }));
            showToast('Saved settings');
          }}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {toastMessage && (
        <div className="toast-banner" role="status" aria-live="polite">
          <Check size={15} color="var(--accent-sage)" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

export default App;
