import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  Clock,
  Flame,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  Undo2,
  Utensils,
  Volume2,
  VolumeX,
  AlertCircle,
} from 'lucide-react';
import type { Appliance, AppSettings, MealStep, ScheduledStep, ScheduleSnapshot } from './types';
import { DEFAULT_APPLIANCES, DEFAULT_STEPS } from './defaultData';
import { computeSchedule, formatCountdownSec, formatDuration, formatTimeMin } from './scheduler';
import { soundManager } from './audio';
import { GanttTimeline } from './components/GanttTimeline';
import { StepModal } from './components/StepModal';
import { ApplianceModal } from './components/ApplianceModal';
import { GeminiModal } from './components/GeminiModal';

const STORAGE_KEY = 'harvestline_state_v1';

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

export function App() {
  const loadInitial = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.steps) && Array.isArray(parsed.appliances)) {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return null;
  };

  const initial = loadInitial();

  const [appliances, setAppliances] = useState<Appliance[]>(
    initial?.appliances ?? DEFAULT_APPLIANCES
  );
  const [steps, setSteps] = useState<MealStep[]>(initial?.steps ?? DEFAULT_STEPS);
  const [settings, setSettings] = useState<AppSettings>(
    initial?.settings ?? {
      targetDinnerMin: 17 * 60, // 5:00 PM
      soundEnabled: true,
      voiceEnabled: false,
      warningAt5Min: true,
      useSimulatedClock: true,
      simulatedNowMin: 12 * 60 + 30, // 12:30 PM default sim so Thanksgiving timeline is visible immediately
      geminiApiKey: '',
    }
  );

  const [realNowMin, setRealNowMin] = useState<number>(getRealNowMin);
  const [undoStack, setUndoStack] = useState<ScheduleSnapshot[]>([]);
  const [editingStep, setEditingStep] = useState<MealStep | null | 'new'>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showApplianceModal, setShowApplianceModal] = useState(false);
  const [showGeminiModal, setShowGeminiModal] = useState(false);
  const [mutedAlarms, setMutedAlarms] = useState<Set<string>>(new Set());

  const warned5MinRef = useRef<Set<string>>(new Set());
  const alarmTickRef = useRef<number>(0);

  const nowMin = settings.useSimulatedClock ? settings.simulatedNowMin : realNowMin;

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ appliances, steps, settings }));
    } catch {
      // ignore
    }
  }, [appliances, steps, settings]);

  // 1-second timer & alarm loop
  useEffect(() => {
    const interval = setInterval(() => {
      setRealNowMin(getRealNowMin());
      alarmTickRef.current += 1;

      setSteps((prev) => {
        let changed = false;
        const next = prev.map((s) => {
          if (s.status !== 'running') return s;
          changed = true;
          const nextSec = s.remainingSec - 1;

          // 5-minute warning
          if (
            settings.warningAt5Min &&
            nextSec === 300 &&
            !warned5MinRef.current.has(s.id)
          ) {
            warned5MinRef.current.add(s.id);
            if (settings.soundEnabled) soundManager.playWarningChime();
            if (settings.voiceEnabled) soundManager.speak(`5 minutes left for ${s.title}`);
          }

          // Just hit 0
          if (nextSec === 0) {
            if (settings.soundEnabled) soundManager.playAlarmBell();
            if (settings.voiceEnabled) soundManager.speak(`${s.title} timer is complete!`);
          }

          return { ...s, remainingSec: nextSec };
        });

        // Repeat alarm every 4 seconds for unmuted ringing timers
        if (alarmTickRef.current % 4 === 0 && settings.soundEnabled) {
          const hasRinging = next.some(
            (s) => s.status === 'running' && s.remainingSec <= 0 && !mutedAlarms.has(s.id)
          );
          if (hasRinging) {
            soundManager.playAlarmBell();
          }
        }

        return changed ? next : prev;
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
        appliances: appliances.map((a) => ({ ...a })),
        targetDinnerMin: settings.targetDinnerMin,
      },
    ]);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setSteps(last.steps);
    setAppliances(last.appliances);
    setSettings((s) => ({ ...s, targetDinnerMin: last.targetDinnerMin }));
  };

  // Compute deterministic schedule
  const schedule = useMemo(
    () => computeSchedule(steps, appliances, settings.targetDinnerMin, nowMin),
    [steps, appliances, settings.targetDinnerMin, nowMin]
  );

  const applianceMap = useMemo(() => new Map(appliances.map((a) => [a.id, a])), [appliances]);

  // Step actions
  const startStep = (id: string) => {
    soundManager.unlock();
    pushUndo('Start timer');
    setMutedAlarms((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSteps((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status: 'running',
              actualStartMin: s.actualStartMin ?? nowMin,
              remainingSec: s.remainingSec > 0 ? s.remainingSec : s.durationMin * 60,
            }
          : s
      )
    );
  };

  const pauseStep = (id: string) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: 'paused' } : s))
    );
  };

  const extendStep = (id: string, extraMin: number) => {
    soundManager.unlock();
    pushUndo(`Extend +${extraMin}m`);
    setMutedAlarms((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const baseSec = Math.max(0, s.remainingSec);
        return {
          ...s,
          addedMin: (s.addedMin || 0) + extraMin,
          remainingSec: baseSec + extraMin * 60,
        };
      })
    );
  };

  const completeStep = (id: string) => {
    pushUndo('Complete step');
    setSteps((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status: 'done',
              actualStartMin: s.actualStartMin ?? Math.max(0, nowMin - s.durationMin),
              actualEndMin: nowMin,
              remainingSec: 0,
            }
          : s
      )
    );
  };

  const reopenStep = (id: string) => {
    pushUndo('Reopen step');
    setSteps((prev) =>
      prev.map((s) =>
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
      )
    );
  };

  const handleSaveStep = (saved: MealStep) => {
    pushUndo(editingStep === 'new' ? 'Add step' : 'Edit step');
    setSteps((prev) => {
      const exists = prev.some((s) => s.id === saved.id);
      if (exists) return prev.map((s) => (s.id === saved.id ? saved : s));
      return [...prev, saved];
    });
    setEditingStep(null);
  };

  const handleDeleteStep = (id: string) => {
    pushUndo('Delete step');
    setSteps((prev) =>
      prev
        .filter((s) => s.id !== id)
        .map((s) => ({
          ...s,
          dependencies: s.dependencies.filter((d) => d !== id),
          readyBeforeIds: s.readyBeforeIds.filter((d) => d !== id),
        }))
    );
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
    setSteps((prev) => [...prev, copy]);
    setEditingStep(null);
  };

  const handleResetDemo = () => {
    pushUndo('Reset sample menu');
    setAppliances(DEFAULT_APPLIANCES);
    setSteps(DEFAULT_STEPS);
    setSettings((s) => ({ ...s, targetDinnerMin: 17 * 60, simulatedNowMin: 12 * 60 + 30 }));
  };

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

  return (
    <div className="app-shell">
      {/* Top Command Bar */}
      <header className="top-bar">
        <div className="brand-group">
          <div className="brand-mark">
            <Utensils size={18} />
          </div>
          <div>
            <h1 className="brand-title">HarvestLine</h1>
            <div className="brand-subtitle">
              Cascading Kitchen Scheduler · Start by{' '}
              <strong className="mono">{formatTimeMin(schedule.earliestStartMin)}</strong>
            </div>
          </div>
        </div>

        {/* Dinner Target & Projected Status */}
        <div className="dinner-cluster">
          <label className="dinner-field">
            <span>Target Dinner</span>
            <input
              type="time"
              value={minToTimeInput(settings.targetDinnerMin)}
              onChange={(e) => {
                pushUndo('Change dinner time');
                setSettings((s) => ({ ...s, targetDinnerMin: timeInputToMin(e.target.value) }));
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
            <button
              type="button"
              className={`btn ${settings.useSimulatedClock ? 'btn-secondary' : 'btn-primary'}`}
              style={{ padding: '5px 9px', fontSize: '0.76rem' }}
              onClick={() =>
                setSettings((s) => ({ ...s, useSimulatedClock: !s.useSimulatedClock }))
              }
              title="Toggle between live computer clock and simulated test clock"
            >
              <Clock size={13} />
              {settings.useSimulatedClock ? `Sim: ${formatTimeMin(nowMin)}` : `Live: ${formatTimeMin(nowMin)}`}
            </button>
            {settings.useSimulatedClock && (
              <div style={{ display: 'flex', gap: 3 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 7px', fontSize: '0.72rem' }}
                  onClick={() =>
                    setSettings((s) => ({ ...s, simulatedNowMin: s.simulatedNowMin - 15 }))
                  }
                >
                  -15m
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '4px 7px', fontSize: '0.72rem' }}
                  onClick={() =>
                    setSettings((s) => ({ ...s, simulatedNowMin: s.simulatedNowMin + 15 }))
                  }
                >
                  +15m
                </button>
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
            title={settings.soundEnabled ? 'Alarms On' : 'Alarms Muted'}
          >
            {settings.soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          <button
            type="button"
            className={`btn-icon ${settings.voiceEnabled ? 'active' : ''}`}
            onClick={() => setSettings((s) => ({ ...s, voiceEnabled: !s.voiceEnabled }))}
            title={settings.voiceEnabled ? 'Voice Announcements On' : 'Voice Announcements Off'}
          >
            {settings.voiceEnabled ? <Bell size={16} /> : <BellOff size={16} />}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              soundManager.unlock();
              soundManager.playAlarmBell();
            }}
            title="Test audible alarm bell"
          >
            Test Bell
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
            onClick={() => setShowApplianceModal(true)}
          >
            <Settings size={14} /> Appliances
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setShowGeminiModal(true)}
          >
            <Sparkles size={14} color="var(--accent-terracotta)" /> Gemini / Import
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setEditingStep('new')}
          >
            <Plus size={15} /> Add Step
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
        {/* Left: Kitchen Mode (Active Timers & Up Next) */}
        <aside className="kitchen-panel">
          <div className="panel-header">
            <span className="panel-title">
              <Bell size={15} /> Kitchen Mode
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: '0.74rem', padding: '3px 7px' }}
              onClick={handleResetDemo}
              title="Reset to sample Thanksgiving menu"
            >
              <RotateCcw size={12} /> Reset Sample
            </button>
          </div>

          <div className="kitchen-scroll">
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
                  const app = applianceMap.get(s.applianceId);
                  const isRinging = s.status === 'running' && s.remainingSec <= 0;
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

                      <div className="timer-controls">
                        <button
                          type="button"
                          className="btn-timer done"
                          onClick={() => completeStep(s.id)}
                        >
                          <Check size={14} /> Done
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
                const app = applianceMap.get(s.applianceId);
                const startsIn = s.startMin - nowMin;
                return (
                  <div
                    key={s.id}
                    className="upnext-item"
                    onClick={() => {
                      setSelectedStepId(s.id);
                      setEditingStep(s);
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
                        {s.isDelayed && <span className="pill delayed">+{s.delayMin}m</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {startsIn <= 0 && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: 'var(--accent-terracotta)',
                          }}
                        >
                          DUE
                        </span>
                      )}
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
          </div>
        </aside>

        {/* Right: Appliance-Lane Gantt Timeline */}
        <GanttTimeline
          appliances={appliances}
          steps={schedule.steps}
          earliestStartMin={schedule.earliestStartMin}
          projectedDinnerMin={schedule.projectedDinnerMin}
          targetDinnerMin={settings.targetDinnerMin}
          nowMin={nowMin}
          selectedStepId={selectedStepId}
          onSelectStep={(step: ScheduledStep) => {
            setSelectedStepId(step.id);
            setEditingStep(step);
          }}
          onStartStep={startStep}
        />
      </main>

      {/* Modals */}
      {editingStep !== null && (
        <StepModal
          step={editingStep === 'new' ? null : editingStep}
          allSteps={steps}
          appliances={appliances}
          onSave={handleSaveStep}
          onDelete={handleDeleteStep}
          onDuplicate={handleDuplicateStep}
          onClose={() => setEditingStep(null)}
        />
      )}

      {showApplianceModal && (
        <ApplianceModal
          appliances={appliances}
          onSave={(updated) => {
            pushUndo('Update appliances');
            setAppliances(updated);
            setShowApplianceModal(false);
          }}
          onClose={() => setShowApplianceModal(false)}
        />
      )}

      {showGeminiModal && (
        <GeminiModal
          appliances={appliances}
          steps={steps}
          scheduledSteps={schedule.steps}
          targetDinnerMin={settings.targetDinnerMin}
          projectedDinnerMin={schedule.projectedDinnerMin}
          apiKey={settings.geminiApiKey}
          onSaveApiKey={(key) => setSettings((s) => ({ ...s, geminiApiKey: key }))}
          onImportSteps={(imported) => {
            pushUndo('Import schedule');
            setSteps(imported);
          }}
          onClose={() => setShowGeminiModal(false)}
        />
      )}
    </div>
  );
}

export default App;
