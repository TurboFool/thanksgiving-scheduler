import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Appliance } from '../types';

interface ApplianceModalProps {
  appliances: Appliance[];
  onSave: (appliances: Appliance[]) => void;
  onClose: () => void;
}

const COLORS = ['#C2592B', '#B45309', '#0F766E', '#6D28D9', '#2F7A53', '#1D4ED8', '#4B5563'];

export const ApplianceModal: React.FC<ApplianceModalProps> = ({ appliances, onSave, onClose }) => {
  const [list, setList] = useState<Appliance[]>(appliances.map((a) => ({ ...a })));

  const updateItem = (idx: number, patch: Partial<Appliance>) => {
    setList((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const addAppliance = () => {
    const idx = list.length;
    setList((prev) => [
      ...prev,
      {
        id: `app-${Date.now()}`,
        name: 'Slow Cooker',
        capacity: 1,
        slotLabel: 'pot',
        hasTemperature: false,
        tempTolerance: 0,
        color: COLORS[idx % COLORS.length],
      },
    ]);
  };

  const removeAppliance = (idx: number) => {
    if (list.length <= 1) return;
    setList((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(list);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Kitchen Appliances &amp; Capacity</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSave}>
          <div className="modal-body">
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-secondary)' }}>
              Configure available space (racks, burners, baskets) and temperature tolerance for sharing
              an appliance simultaneously.
            </p>
            {list.map((app, idx) => (
              <div
                key={app.id}
                style={{
                  border: '1px solid var(--border-light)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                  background: 'var(--bg-canvas)',
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 0.8fr 0.9fr auto',
                  gap: 10,
                  alignItems: 'end',
                }}
              >
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

                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 16 }}>
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
                </div>
              </div>
            ))}

            <button type="button" className="btn btn-secondary" onClick={addAppliance}>
              <Plus size={15} /> Add Appliance
            </button>
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
