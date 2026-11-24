import React, { useState } from 'react';
import { X, Plus, Trash2, GripVertical } from 'lucide-react';
import type { Appliance } from '../types';

interface ApplianceModalProps {
  appliances: Appliance[];
  onSave: (appliances: Appliance[]) => void;
  onClose: () => void;
}

const COLORS = ['#C2592B', '#B45309', '#0F766E', '#6D28D9', '#2F7A53', '#1D4ED8', '#4B5563'];

export const ApplianceModal: React.FC<ApplianceModalProps> = ({ appliances, onSave, onClose }) => {
  const [list, setList] = useState<Appliance[]>(appliances.map((a) => ({ ...a })));
  const [modesText, setModesText] = useState<Record<string, string>>(() =>
    Object.fromEntries(list.map((a) => [a.id, (a.supportedModes ?? []).join(', ')]))
  );
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const updateItem = (idx: number, patch: Partial<Appliance>) => {
    setList((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const addAppliance = () => {
    const idx = list.length;
    const newId = `app-${Date.now()}`;
    setList((prev) => [
      ...prev,
      {
        id: newId,
        name: 'Slow Cooker',
        capacity: 1,
        slotLabel: 'pot',
        hasTemperature: false,
        tempTolerance: 0,
        color: COLORS[idx % COLORS.length],
      },
    ]);
    setModesText((prev) => ({ ...prev, [newId]: '' }));
  };

  const removeAppliance = (idx: number) => {
    if (list.length <= 1) return;
    setList((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    setList((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setOverIdx(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = list.map((a) => {
      const raw = modesText[a.id] ?? (a.supportedModes ?? []).join(', ');
      const modes = raw
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      return {
        ...a,
        supportedModes: modes.length > 0 ? modes : undefined,
      };
    });
    onSave(normalized);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 660 }}>
        <div className="modal-header">
          <h2 className="modal-title">Kitchen Appliances &amp; Capacity</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSave}>
          <div className="modal-body">
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-secondary)' }}>
              Drag the handle to reorder timeline lanes, and configure capacity (racks, burners,
              baskets) and temperature tolerance.
            </p>
            {list.map((app, idx) => (
              <div
                key={app.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overIdx !== idx) setOverIdx(idx);
                }}
                onDrop={() => handleDrop(idx)}
                onDragEnd={() => {
                  setDragIdx(null);
                  setOverIdx(null);
                }}
                style={{
                  border:
                    overIdx === idx && dragIdx !== idx
                      ? '2px dashed var(--accent-terracotta)'
                      : '1px solid var(--border-light)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  background: 'var(--bg-canvas)',
                  opacity: dragIdx === idx ? 0.55 : 1,
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1.4fr) minmax(0, 1.1fr) 72px 92px auto',
                  gap: 10,
                  alignItems: 'end',
                }}
              >
                <div
                  title="Drag to reorder"
                  style={{
                    cursor: 'grab',
                    color: 'var(--ink-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    alignSelf: 'center',
                    padding: '4px 2px',
                  }}
                >
                  <GripVertical size={16} />
                </div>
                <div className="form-field">
                  <label>Name</label>
                  <input
                    type="text"
                    value={app.name}
                    onChange={(e) => updateItem(idx, { name: e.target.value })}
                    required
                  />
                </div>
                <div className="form-field">
                  <label>Category</label>
                  <input
                    type="text"
                    list="appliance-categories"
                    value={app.category ?? ''}
                    onChange={(e) => updateItem(idx, { category: e.target.value })}
                    placeholder="e.g., Oven"
                  />
                </div>
                <div className="form-field">
                  <label>Capacity</label>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={app.capacity}
                    onChange={(e) => updateItem(idx, { capacity: Math.max(1, Number(e.target.value)) })}
                  />
                </div>
                <div className="form-field">
                  <label>Unit Label</label>
                  <input
                    type="text"
                    value={app.slotLabel}
                    onChange={(e) => updateItem(idx, { slotLabel: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className="btn-icon"
                  onClick={() => removeAppliance(idx)}
                  title="Remove appliance"
                  disabled={list.length <= 1}
                >
                  <Trash2 size={15} />
                </button>

                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <label className="dep-check-item">
                    <input
                      type="checkbox"
                      checked={app.hasTemperature}
                      onChange={(e) => updateItem(idx, { hasTemperature: e.target.checked })}
                    />
                    Shared Temperature Constraint
                  </label>
                  {app.hasTemperature && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                      <span>Tolerance (±°F):</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={5}
                        value={app.tempTolerance}
                        onChange={(e) =>
                          updateItem(idx, { tempTolerance: Math.max(0, Number(e.target.value)) })
                        }
                        style={{
                          width: 64,
                          padding: '4px 6px',
                          borderRadius: 6,
                          border: '1px solid var(--border-strong)',
                        }}
                      />
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 210, fontSize: '0.8rem' }}>
                    <span style={{ whiteSpace: 'nowrap', color: 'var(--ink-secondary)' }}>Modes:</span>
                    <input
                      type="text"
                      value={modesText[app.id] ?? (app.supportedModes ?? []).join(', ')}
                      onChange={(e) => {
                        const val = e.target.value;
                        setModesText((prev) => ({ ...prev, [app.id]: val }));
                      }}
                      placeholder="e.g., Bake, Convection, Air Fryer"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '4px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-strong)',
                        fontSize: '0.78rem',
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}

            <button type="button" className="btn btn-secondary" onClick={addAppliance}>
              <Plus size={15} /> Add Appliance
            </button>
            <datalist id="appliance-categories">
              <option value="Oven" />
              <option value="Stovetop" />
              <option value="Counter" />
              <option value="Air Fryer" />
              <option value="Slow Cooker" />
              <option value="Microwave" />
              <option value="Grill" />
            </datalist>
          </div>

          <div className="modal-footer">
            <span />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save Appliances
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
