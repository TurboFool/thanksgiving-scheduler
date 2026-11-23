import React, { useState } from 'react';
import { X, Sparkles, Copy, Check, Download, Upload, AlertTriangle } from 'lucide-react';
import type { Appliance, MealStep, ScheduledStep } from '../types';
import {
  buildGeminiChatPrompt,
  generateScheduleWithGemini,
  getRecoveryAdviceWithGemini,
  parseImportedSteps,
} from '../gemini';

interface GeminiModalProps {
  appliances: Appliance[];
  steps: MealStep[];
  scheduledSteps: ScheduledStep[];
  targetDinnerMin: number;
  projectedDinnerMin: number;
  apiKey: string;
  onSaveApiKey: (key: string) => void;
  onImportSteps: (steps: MealStep[], mode: 'add' | 'replace') => void;
  onClose: () => void;
}

const SAMPLE_MENU_TEXT =
  '14lb roast turkey, pan drippings gravy, herb stuffing (350°F), green bean casserole (350°F), mashed potatoes, cranberry sauce, dinner rolls, pumpkin pie reheat';

export const GeminiModal: React.FC<GeminiModalProps> = ({
  appliances,
  steps,
  scheduledSteps,
  targetDinnerMin,
  projectedDinnerMin,
  apiKey,
  onSaveApiKey,
  onImportSteps,
  onClose,
}) => {
  const [tab, setTab] = useState<'paste' | 'api' | 'export'>('paste');
  const [mode, setMode] = useState<'add' | 'replace'>(steps.length > 0 ? 'add' : 'replace');
  const [menuInput, setMenuInput] = useState(steps.length > 0 ? '' : SAMPLE_MENU_TEXT);
  const [jsonInput, setJsonInput] = useState('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedExport, setCopiedExport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [localKey, setLocalKey] = useState(apiKey);

  const effectiveMode = steps.length === 0 ? 'replace' : mode;

  const handleModeChange = (nextMode: 'add' | 'replace') => {
    setMode(nextMode);
    if (nextMode === 'replace' && !menuInput.trim()) {
      setMenuInput(SAMPLE_MENU_TEXT);
    } else if (nextMode === 'add' && menuInput === SAMPLE_MENU_TEXT) {
      setMenuInput('');
    }
  };

  const handleCopyPrompt = () => {
    const prompt = buildGeminiChatPrompt(
      appliances,
      menuInput,
      effectiveMode === 'add' ? steps : undefined
    );
    navigator.clipboard.writeText(prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const handleParsePaste = () => {
    setError(null);
    try {
      const parsed = parseImportedSteps(jsonInput, appliances);
      onImportSteps(parsed, effectiveMode);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleApiGenerate = async () => {
    setError(null);
    if (!localKey.trim()) {
      setError('Please enter your Gemini API key first.');
      return;
    }
    if (!menuInput.trim()) {
      setError(
        effectiveMode === 'add'
          ? 'Please describe the new item(s) you want to add.'
          : 'Please describe your menu first.'
      );
      return;
    }
    onSaveApiKey(localKey.trim());
    setLoading(true);
    try {
      const generated = await generateScheduleWithGemini(
        localKey,
        menuInput,
        appliances,
        effectiveMode === 'add' ? steps : undefined
      );
      onImportSteps(generated, effectiveMode);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to call Gemini API');
    } finally {
      setLoading(false);
    }
  };

  const handleGetAdvice = async () => {
    setError(null);
    if (!localKey.trim()) {
      setError('Please enter your Gemini API key first.');
      return;
    }
    onSaveApiKey(localKey.trim());
    setLoading(true);
    try {
      const text = await getRecoveryAdviceWithGemini(
        localKey,
        scheduledSteps,
        appliances,
        targetDinnerMin,
        projectedDinnerMin
      );
      setAdvice(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get recovery advice');
    } finally {
      setLoading(false);
    }
  };

  const exportJson = JSON.stringify(steps, null, 2);

  const handleDownloadJson = () => {
    const blob = new Blob([exportJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'thanksgiving-schedule.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color="var(--accent-terracotta)" />
            Gemini Planner &amp; Schedule Import
          </h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '10px 20px',
            borderBottom: '1px solid var(--border-light)',
            background: 'var(--bg-canvas)',
          }}
        >
          <button
            type="button"
            className={`btn ${tab === 'paste' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('paste')}
          >
            <Upload size={14} /> Copy Prompt / Paste JSON
          </button>
          <button
            type="button"
            className={`btn ${tab === 'api' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('api')}
          >
            <Sparkles size={14} /> Gemini API Assistant
          </button>
          <button
            type="button"
            className={`btn ${tab === 'export' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('export')}
          >
            <Download size={14} /> Export / Backup
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--status-crimson-soft)',
                color: 'var(--status-crimson)',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          {(tab === 'paste' || tab === 'api') && steps.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-canvas)',
                border: '1px solid var(--border-light)',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--ink-secondary)' }}>
                Mode:
              </span>
              <button
                type="button"
                className={`btn ${effectiveMode === 'add' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                onClick={() => handleModeChange('add')}
              >
                Add to Schedule ({steps.length} existing)
              </button>
              <button
                type="button"
                className={`btn ${effectiveMode === 'replace' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                onClick={() => handleModeChange('replace')}
              >
                Replace Entire Schedule
              </button>
            </div>
          )}

          {tab === 'paste' && (
            <>
              <div className="form-field">
                <label>
                  {effectiveMode === 'add'
                    ? `1. Describe new items to add (prompt includes your ${steps.length} existing steps)`
                    : '1. Describe your Thanksgiving menu (optional, included in prompt)'}
                </label>
                <textarea
                  rows={2}
                  value={menuInput}
                  onChange={(e) => setMenuInput(e.target.value)}
                  placeholder={
                    effectiveMode === 'add'
                      ? 'e.g., garlic bread (400°F, 10m), roasted Brussels sprouts (400°F, 25m)'
                      : SAMPLE_MENU_TEXT
                  }
                />
              </div>
              <div>
                <button type="button" className="btn btn-secondary" onClick={handleCopyPrompt}>
                  {copiedPrompt ? <Check size={14} /> : <Copy size={14} />}
                  {copiedPrompt ? 'Copied Gemini Prompt!' : 'Copy Prompt for Gemini Chat'}
                </button>
                <span style={{ fontSize: '0.76rem', color: 'var(--ink-muted)', marginLeft: 10 }}>
                  Paste into Gemini, then paste the JSON output below.
                </span>
              </div>

              <div className="form-field">
                <label>
                  {effectiveMode === 'add'
                    ? '2. Paste JSON from Gemini (adds to current steps & re-evaluates schedule)'
                    : '2. Paste JSON from Gemini (replaces current steps)'}
                </label>
                <textarea
                  rows={7}
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  placeholder='[{"id": "garlic-bread", "title": "Bake Garlic Bread", ...}]'
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
                />
              </div>
            </>
          )}

          {tab === 'api' && (
            <>
              <div className="form-field">
                <label>Gemini API Key (saved only in your browser localStorage)</label>
                <input
                  type="password"
                  value={localKey}
                  onChange={(e) => setLocalKey(e.target.value)}
                  placeholder="AIza..."
                />
              </div>

              <div className="form-field">
                <label>
                  {effectiveMode === 'add'
                    ? `New Items to Add (Gemini sees your ${steps.length} existing steps & re-evaluates timing)`
                    : 'Menu to Generate (creates full steps, dependencies & appliance temps)'}
                </label>
                <textarea
                  rows={3}
                  value={menuInput}
                  onChange={(e) => setMenuInput(e.target.value)}
                  placeholder={
                    effectiveMode === 'add'
                      ? 'e.g., garlic bread (400°F, 10m), roasted Brussels sprouts (400°F, 25m)'
                      : SAMPLE_MENU_TEXT
                  }
                />
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleApiGenerate}
                  disabled={loading}
                >
                  <Sparkles size={14} />
                  {loading
                    ? 'Working...'
                    : effectiveMode === 'add'
                    ? 'Add Steps with Gemini'
                    : 'Generate Schedule with Gemini'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleGetAdvice}
                  disabled={loading}
                >
                  {loading ? 'Analyzing...' : 'Get Slip Recovery Advice for Current Schedule'}
                </button>
              </div>

              {advice && (
                <div>
                  <div className="section-label" style={{ marginTop: 8 }}>
                    Gemini Recovery Suggestions
                  </div>
                  <div className="advice-box">{advice}</div>
                </div>
              )}
            </>
          )}

          {tab === 'export' && (
            <>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-secondary)' }}>
                Save a local JSON backup of your meal steps to your Windows computer, or copy it to
                share across devices.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-primary" onClick={handleDownloadJson}>
                  <Download size={14} /> Download thanksgiving-schedule.json
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(exportJson);
                    setCopiedExport(true);
                    setTimeout(() => setCopiedExport(false), 2000);
                  }}
                >
                  {copiedExport ? <Check size={14} /> : <Copy size={14} />}
                  {copiedExport ? 'Copied!' : 'Copy JSON'}
                </button>
              </div>
              <textarea
                readOnly
                rows={8}
                value={exportJson}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  padding: 10,
                  borderRadius: 8,
                  border: '1px solid var(--border-light)',
                  background: 'var(--bg-canvas)',
                }}
              />
            </>
          )}
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
            Scheduling &amp; cascading math runs 100% locally and deterministically.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            {tab === 'paste' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleParsePaste}
                disabled={!jsonInput.trim()}
              >
                {effectiveMode === 'add' ? 'Add Steps to Schedule' : 'Import Steps'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
