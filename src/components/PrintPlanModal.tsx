import React, { useMemo, useState } from 'react';
import { X, Copy, Check, Printer, ExternalLink, FileText } from 'lucide-react';
import type { Appliance, MealEvent, ScheduledStep } from '../types';
import {
  buildPlainTextPlan,
  buildPrintableHtmlPlan,
  type PlanViewMode,
} from '../planFormatter';

interface PrintPlanModalProps {
  event: MealEvent;
  scheduledSteps: ScheduledStep[];
  appliances: Appliance[];
  onClose: () => void;
}

export const PrintPlanModal: React.FC<PrintPlanModalProps> = ({
  event,
  scheduledSteps,
  appliances,
  onClose,
}) => {
  const [mode, setMode] = useState<PlanViewMode>('chronological');
  const [includeCheckboxes, setIncludeCheckboxes] = useState(true);
  const [includeRecipesAndNotes, setIncludeRecipesAndNotes] = useState(true);
  const [includeCompleted, setIncludeCompleted] = useState(true);
  const [copied, setCopied] = useState(false);
  const [popupError, setPopupError] = useState<string | null>(null);

  const options = useMemo(
    () => ({
      mode,
      includeCheckboxes,
      includeRecipesAndNotes,
      includeCompleted,
    }),
    [mode, includeCheckboxes, includeRecipesAndNotes, includeCompleted]
  );

  const plainText = useMemo(
    () => buildPlainTextPlan(event, scheduledSteps, appliances, options),
    [event, scheduledSteps, appliances, options]
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(plainText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openPopoutWindow = (triggerPrint: boolean) => {
    setPopupError(null);
    const html = buildPrintableHtmlPlan(event, scheduledSteps, appliances, options);
    const win = window.open('', '_blank', 'width=920,height=760,scrollbars=yes,resizable=yes');
    if (!win) {
      setPopupError(
        'Your browser blocked the pop-out window. Allow pop-ups for this site or use Copy Plain Text below.'
      );
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    if (triggerPrint) {
      win.focus();
      setTimeout(() => {
        try {
          win.print();
        } catch {
          // ignore print cancel
        }
      }, 250);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={18} color="var(--accent-sage)" />
            Kitchen Plan Sheet — {event.name}
          </h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Layout Mode Switch */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className={`btn ${mode === 'chronological' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.78rem', padding: '5px 11px' }}
              onClick={() => setMode('chronological')}
            >
              Chronological Timeline
            </button>
            <button
              type="button"
              className={`btn ${mode === 'per_dish' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.78rem', padding: '5px 11px' }}
              onClick={() => setMode('per_dish')}
            >
              Per-Dish Recipes &amp; Steps
            </button>
            <button
              type="button"
              className={`btn ${mode === 'combined' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.78rem', padding: '5px 11px' }}
              onClick={() => setMode('combined')}
            >
              Both Combined
            </button>
          </div>

          {/* Detail Toggles */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-canvas)',
              border: '1px solid var(--border-light)',
            }}
          >
            <label className="dep-check-item">
              <input
                type="checkbox"
                checked={includeCheckboxes}
                onChange={(e) => setIncludeCheckboxes(e.target.checked)}
              />
              <span>Checkboxes ([ ])</span>
            </label>
            <label className="dep-check-item">
              <input
                type="checkbox"
                checked={includeRecipesAndNotes}
                onChange={(e) => setIncludeRecipesAndNotes(e.target.checked)}
              />
              <span>Recipes, Ingredients &amp; Notes</span>
            </label>
            <label className="dep-check-item">
              <input
                type="checkbox"
                checked={includeCompleted}
                onChange={(e) => setIncludeCompleted(e.target.checked)}
              />
              <span>Include Completed Steps</span>
            </label>
          </div>

          {popupError && (
            <div
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--status-amber-soft)',
                border: '1px solid var(--status-amber)',
                fontSize: '0.78rem',
              }}
            >
              {popupError}
            </div>
          )}

          {/* Formatted Plain Text Preview */}
          <textarea
            readOnly
            rows={16}
            value={plainText}
            aria-label="Formatted kitchen plan text"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.77rem',
              lineHeight: 1.45,
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-canvas)',
              color: 'var(--ink-primary)',
              resize: 'vertical',
            }}
          />
        </div>

        <div className="modal-footer">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy Plain Text'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => openPopoutWindow(false)}
            >
              <ExternalLink size={14} /> Pop-Out Window
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openPopoutWindow(true)}
            >
              <Printer size={14} /> Print
            </button>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
