import React, { useState } from 'react';
import { X, Trash2, Copy } from 'lucide-react';
import type { Appliance, MealStep } from '../types';

interface StepModalProps {
  step: MealStep | null;
  allSteps: MealStep[];
  appliances: Appliance[];
  onSave: (step: MealStep) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (step: MealStep) => void;
  onClose: () => void;
}

export const StepModal: React.FC<StepModalProps> = ({
  step,
  allSteps,
  appliances,
  onSave,
  onDelete,
  onDuplicate,
  onClose,
}) => {
  const isNew = !step;
  const [title, setTitle] = useState(step?.title ?? '');
  const [dish, setDish] = useState(step?.dish ?? '');
  const [durationMin, setDurationMin] = useState(step?.durationMin ?? 30);
  const [applianceId, setApplianceId] = useState(step?.applianceId ?? appliances[0]?.id ?? 'oven');
  const [slotsRequired, setSlotsRequired] = useState(step?.slotsRequired ?? 1);
  const [temperature, setTemperature] = useState<string>(
    step?.temperature !== undefined ? String(step.temperature) : ''
  );
  const [dependencies, setDependencies] = useState<string[]>(step?.dependencies ?? []);
  const [readyBeforeIds, setReadyBeforeIds] = useState<string[]>(step?.readyBeforeIds ?? []);
  const [mustFinishByDinner, setMustFinishByDinner] = useState(step?.mustFinishByDinner ?? true);
  const [notes, setNotes] = useState(step?.notes ?? '');

  const selectedApp = appliances.find((a) => a.id === applianceId);
  const otherSteps = allSteps.filter((s) => s.id !== step?.id);

  const toggleId = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
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
                  Must be ready by Dinner Time
                </label>
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
