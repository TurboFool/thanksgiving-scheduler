import React, { useState } from 'react';
import { X, Trash2, Copy } from 'lucide-react';
import type { Appliance, MealStep } from '../types';

interface StepModalProps {
  step: MealStep | null;
  defaultDish?: string;
  allSteps: MealStep[];
  appliances: Appliance[];
  onSave: (step: MealStep) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (step: MealStep) => void;
  onClose: () => void;
}

export const StepModal: React.FC<StepModalProps> = ({
  step,
  defaultDish,
  allSteps,
  appliances,
  onSave,
  onDelete,
  onDuplicate,
  onClose,
}) => {
  const isNew = !step;
  const [title, setTitle] = useState(step?.title ?? '');
  const [dish, setDish] = useState(step?.dish ?? defaultDish ?? '');
  const [durationMin, setDurationMin] = useState(step?.durationMin ?? 30);
  const [applianceId, setApplianceId] = useState(step?.applianceId ?? appliances[0]?.id ?? 'oven');
  const [slotsRequired, setSlotsRequired] = useState(step?.slotsRequired ?? 1);
  const [temperature, setTemperature] = useState<string>(
    step?.temperature !== undefined ? String(step.temperature) : ''
  );
  const [dependencies, setDependencies] = useState<string[]>(step?.dependencies ?? []);
  const [readyBeforeIds, setReadyBeforeIds] = useState<string[]>(step?.readyBeforeIds ?? []);
  const [mustFinishByDinner, setMustFinishByDinner] = useState(step?.mustFinishByDinner ?? true);
  const [pinnedStartMin, setPinnedStartMin] = useState<number | undefined>(step?.pinnedStartMin);
  const [canPrepEarly, setCanPrepEarly] = useState(step?.canPrepEarly ?? false);
  const [earlyPrepMinBefore, setEarlyPrepMinBefore] = useState<number>(
    step?.earlyPrepMinBefore ?? 30
  );
  const [earlyPrepMaxBefore, setEarlyPrepMaxBefore] = useState<number>(
    step?.earlyPrepMaxBefore ?? 240
  );
  const [preservationNotes, setPreservationNotes] = useState(step?.preservationNotes ?? '');
  const [notes, setNotes] = useState(step?.notes ?? '');

  const selectedApp = appliances.find((a) => a.id === applianceId);
  const otherSteps = allSteps.filter((s) => s.id !== step?.id);

  const toggleId = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const minToTimeInput = (min: number): string => {
    const norm = ((Math.round(min) % 1440) + 1440) % 1440;
    const h = Math.floor(norm / 60);
    const m = norm % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const timeInputToMin = (val: string): number | undefined => {
    if (!val) return undefined;
    const [h, m] = val.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
    return h * 60 + m;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const dur = Math.max(1, Number(durationMin) || 15);
    const parsedTemp =
      selectedApp?.hasTemperature && temperature.trim() !== '' ? Number(temperature) : undefined;

    const saved: MealStep = {
      id: step?.id ?? `step-${Date.now()}`,
      title: title.trim(),
      dish: dish.trim() || 'General',
      durationMin: dur,
      applianceId,
      slotsRequired: Math.max(1, Number(slotsRequired) || 1),
      temperature: Number.isFinite(parsedTemp) ? parsedTemp : undefined,
      dependencies,
      readyBeforeIds,
      mustFinishByDinner,
      finishConstraint: step?.finishConstraint,
      pinnedStartMin,
      canPrepEarly,
      earlyPrepMinBefore: canPrepEarly ? Math.max(0, Number(earlyPrepMinBefore) || 0) : undefined,
      earlyPrepMaxBefore: canPrepEarly ? Math.max(0, Number(earlyPrepMaxBefore) || 0) : undefined,
      preservationNotes: canPrepEarly ? preservationNotes.trim() || undefined : undefined,
      notes: notes.trim() || undefined,
      status: step?.status ?? 'pending',
      remainingSec:
        step && step.durationMin === dur ? step.remainingSec : dur * 60,
      addedMin: step?.addedMin ?? 0,
      actualStartMin: step?.actualStartMin,
      actualEndMin: step?.actualEndMin,
    };
    onSave(saved);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <h2 className="modal-title">{isNew ? 'Add Cooking Step' : 'Edit Cooking Step'}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-field full">
                <label htmlFor="step-title">Step Title</label>
                <input
                  id="step-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Roast 14lb Turkey"
                  required
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label htmlFor="step-dish">Dish Group</label>
                <input
                  id="step-dish"
                  type="text"
                  value={dish}
                  onChange={(e) => setDish(e.target.value)}
                  placeholder="e.g., Turkey, Sides"
                />
              </div>

              <div className="form-field">
                <label htmlFor="step-duration">Expected Duration (min)</label>
                <input
                  id="step-duration"
                  type="number"
                  min={1}
                  max={720}
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor="step-appliance">Appliance</label>
                <select
                  id="step-appliance"
                  value={applianceId}
                  onChange={(e) => setApplianceId(e.target.value)}
                >
                  {appliances.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.capacity} {a.slotLabel}
                      {a.capacity > 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="step-slots">
                  Space Needed ({selectedApp?.slotLabel ?? 'slot'}s)
                </label>
                <input
                  id="step-slots"
                  type="number"
                  min={1}
                  max={selectedApp?.capacity ?? 12}
                  value={slotsRequired}
                  onChange={(e) => setSlotsRequired(Number(e.target.value))}
                />
              </div>

              {selectedApp?.hasTemperature && (
                <div className="form-field">
                  <label htmlFor="step-temp">
                    Temperature (°F, ±{selectedApp.tempTolerance}°F shareable)
                  </label>
                  <input
                    id="step-temp"
                    type="number"
                    min={100}
                    max={550}
                    step={5}
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    placeholder="e.g., 350"
                  />
                </div>
              )}

              <div className="form-field" style={{ justifyContent: 'center' }}>
                <label className="dep-check-item" style={{ marginTop: 18 }}>
                  <input
                    type="checkbox"
                    checked={mustFinishByDinner}
                    onChange={(e) => setMustFinishByDinner(e.target.checked)}
                  />
                  Must be ready by Serve Time
                </label>
              </div>

              {/* Manual Schedule Override */}
              <div className="form-field">
                <label htmlFor="step-pinned-start">
                  Manual Start Time (optional, or drag on timeline)
                </label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    id="step-pinned-start"
                    type="time"
                    value={pinnedStartMin !== undefined ? minToTimeInput(pinnedStartMin) : ''}
                    onChange={(e) => setPinnedStartMin(timeInputToMin(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  {pinnedStartMin !== undefined && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '5px 8px', fontSize: '0.74rem' }}
                      onClick={() => setPinnedStartMin(undefined)}
                    >
                      Auto
                    </button>
                  )}
                </div>
              </div>

              {/* Early Prep & Preservation */}
              <div
                className="form-field full"
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-light)',
                  background: 'var(--bg-canvas)',
                  gap: 8,
                }}
              >
                <label className="dep-check-item">
                  <input
                    type="checkbox"
                    checked={canPrepEarly}
                    onChange={(e) => setCanPrepEarly(e.target.checked)}
                  />
                  <span>
                    <strong>Can be completed early &amp; held/preserved</strong> until ready
                  </span>
                </label>
                {canPrepEarly && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: '0.8rem' }}>
                      <span>Early prep window:</span>
                      <input
                        type="number"
                        aria-label="Max minutes early"
                        min={15}
                        max={2880}
                        value={earlyPrepMaxBefore}
                        onChange={(e) => setEarlyPrepMaxBefore(Number(e.target.value))}
                        style={{ width: 72 }}
                      />
                      <span>to</span>
                      <input
                        type="number"
                        aria-label="Min minutes early"
                        min={0}
                        max={1440}
                        value={earlyPrepMinBefore}
                        onChange={(e) => setEarlyPrepMinBefore(Number(e.target.value))}
                        style={{ width: 72 }}
                      />
                      <span>min before needed</span>
                    </div>
                    <div className="form-field">
                      <label htmlFor="step-preservation">Preservation / Holding Steps</label>
                      <input
                        id="step-preservation"
                        type="text"
                        value={preservationNotes}
                        onChange={(e) => setPreservationNotes(e.target.value)}
                        placeholder="e.g., Cover tightly and refrigerate; bring to room temp 30m before baking"
                      />
                    </div>
                  </div>
                )}
              </div>

              {otherSteps.length > 0 && (
                <>
                  <div className="form-field full">
                    <label>Depends On (must finish BEFORE this starts)</label>
                    <div className="dep-checklist">
                      {otherSteps.map((s) => (
                        <label key={s.id} className="dep-check-item">
                          <input
                            type="checkbox"
                            checked={dependencies.includes(s.id)}
                            onChange={() => toggleId(dependencies, setDependencies, s.id)}
                          />
                          <span>{s.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="form-field full">
                    <label>Must Be Ready Before (later items that rely on this)</label>
                    <div className="dep-checklist">
                      {otherSteps.map((s) => (
                        <label key={s.id} className="dep-check-item">
                          <input
                            type="checkbox"
                            checked={readyBeforeIds.includes(s.id)}
                            onChange={() => toggleId(readyBeforeIds, setReadyBeforeIds, s.id)}
                          />
                          <span>{s.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="form-field full">
                <label htmlFor="step-notes">Notes / Prep Reminders</label>
                <textarea
                  id="step-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional instructions..."
                />
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <div style={{ display: 'flex', gap: 8 }}>
              {step && onDelete && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: 'var(--status-crimson)' }}
                  onClick={() => onDelete(step.id)}
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
              {step && onDuplicate && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onDuplicate(step)}
                >
                  <Copy size={14} /> Duplicate
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {isNew ? 'Add Step' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
