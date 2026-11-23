import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Copy,
  Check,
  Download,
  Upload,
  AlertTriangle,
  Send,
  Sliders,
} from 'lucide-react';
import type { Appliance, MealItem, MealStep, ScheduledStep } from '../types';
import {
  buildGeminiChatPrompt,
  buildGeminiSkillInstructions,
  evaluateAndAdjustScheduleWithGemini,
  generateScheduleWithGemini,
  parseImportedMeals,
  type ScheduleAdjustmentProposal,
} from '../gemini';

interface GeminiModalProps {
  appliances: Appliance[];
  mealItems: MealItem[];
  steps: MealStep[];
  scheduledSteps: ScheduledStep[];
  targetDinnerMin: number;
  projectedDinnerMin: number;
  apiKey: string;
  onOpenSettings: () => void;
  onApplyScheduleUpdates: (updates: ScheduleAdjustmentProposal[]) => void;
  onImportMeals: (meals: MealItem[], mode: 'add' | 'replace') => void;
  onClose: () => void;
}

const SAMPLE_MENU_TEXT =
  '14lb roast turkey, pan drippings gravy, herb stuffing (350°F), green bean casserole (350°F), mashed potatoes, cranberry sauce, dinner rolls, pumpkin pie reheat';

export const GeminiModal: React.FC<GeminiModalProps> = ({
  appliances,
  mealItems,
  steps,
  scheduledSteps,
  targetDinnerMin,
  projectedDinnerMin,
  apiKey,
  onOpenSettings,
  onApplyScheduleUpdates,
  onImportMeals,
  onClose,
}) => {
  const [tab, setTab] = useState<'evaluate' | 'paste' | 'export'>('evaluate');
  const [mode, setMode] = useState<'add' | 'replace'>(steps.length > 0 ? 'add' : 'replace');
  const [menuInput, setMenuInput] = useState(steps.length > 0 ? '' : SAMPLE_MENU_TEXT);
  const [jsonInput, setJsonInput] = useState('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedSkill, setCopiedSkill] = useState(false);
  const [copiedExport, setCopiedExport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Interactive Schedule Evaluator state
  const [chatTurns, setChatTurns] = useState<Array<{ role: 'user' | 'model'; text: string }>>([]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [proposedUpdates, setProposedUpdates] = useState<ScheduleAdjustmentProposal[]>([]);
  const [appliedUpdates, setAppliedUpdates] = useState(false);

  const effectiveMode = steps.length === 0 ? 'replace' : mode;
  const unassignedCount = scheduledSteps.filter((s) => !s.resolvedApplianceId).length;
  const delayedCount = scheduledSteps.filter((s) => s.isDelayed).length;

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

  const handleCopySkillInstructions = () => {
    const instructions = buildGeminiSkillInstructions(appliances);
    navigator.clipboard.writeText(instructions);
    setCopiedSkill(true);
    setTimeout(() => setCopiedSkill(false), 2500);
  };

  const handleParsePaste = () => {
    setError(null);
    try {
      const parsedMeals = parseImportedMeals(
        jsonInput,
        appliances,
        effectiveMode === 'add' ? steps : []
      );
      onImportMeals(parsedMeals, effectiveMode);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  };

  const handleApiGenerate = async () => {
    setError(null);
    if (!apiKey.trim()) {
      setError('Please configure your Gemini API key in Settings first.');
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
    setLoading(true);
    try {
      const generated = await generateScheduleWithGemini(
        apiKey,
        menuInput,
        appliances,
        effectiveMode === 'add' ? steps : undefined
      );
      const meals = parseImportedMeals(
        JSON.stringify(generated),
        appliances,
        effectiveMode === 'add' ? steps : []
      );
      onImportMeals(meals, effectiveMode);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to call Gemini API');
    } finally {
      setLoading(false);
    }
  };

  const runEvaluation = async (userMessage?: string) => {
    setError(null);
    setAppliedUpdates(false);
    if (!apiKey.trim()) {
      setError('Please configure your Gemini API key in Settings first.');
      return;
    }
    const promptMsg =
      userMessage?.trim() ||
      'Evaluate my current event schedule for unassigned steps, appliance/oven conflicts, temperature clashes, and timing delays, and propose updates.';

    const nextHistory: Array<{ role: 'user' | 'model'; text: string }> = [
      ...chatTurns,
      { role: 'user', text: promptMsg },
    ];
    setChatTurns(nextHistory);
    setFollowUpInput('');
    setLoading(true);
    try {
      const res = await evaluateAndAdjustScheduleWithGemini(
        apiKey,
        nextHistory,
        mealItems,
        scheduledSteps,
        appliances,
        targetDinnerMin,
        projectedDinnerMin
      );
      setChatTurns((prev) => [...prev, { role: 'model', text: res.reply }]);
      setProposedUpdates(res.recommendedUpdates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to evaluate schedule.');
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
    a.download = 'thymeline-schedule.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 700 }}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color="var(--accent-sage)" />
            Gemini Schedule Optimizer &amp; Import
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
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className={`btn ${tab === 'evaluate' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('evaluate')}
          >
            <Sliders size={14} /> Evaluate &amp; Adjust Schedule
          </button>
          <button
            type="button"
            className={`btn ${tab === 'paste' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab('paste')}
          >
            <Upload size={14} /> Import / Add Items
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

          {!apiKey.trim() && tab === 'evaluate' && (
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--status-amber-soft)',
                border: '1px solid var(--status-amber)',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span>Configure your Gemini API key in Settings to evaluate and adjust schedules.</span>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
              >
                Open Settings
              </button>
            </div>
          )}

          {tab === 'evaluate' && (
            <>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-canvas)',
                  border: '1px solid var(--border-light)',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span>
                    <strong>{scheduledSteps.length}</strong> step(s)
                  </span>
                  {unassignedCount > 0 && (
                    <span className="pill delayed">{unassignedCount} unassigned</span>
                  )}
                  {delayedCount > 0 && (
                    <span className="pill delayed">{delayedCount} delayed</span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => runEvaluation()}
                  disabled={loading || scheduledSteps.length === 0}
                >
                  <Sparkles size={14} />
                  {loading
                    ? 'Evaluating...'
                    : chatTurns.length > 0
                    ? 'Re-Evaluate Schedule'
                    : 'Evaluate Current Schedule'}
                </button>
              </div>

              {chatTurns.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {chatTurns.map((turn, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '9px 12px',
                        borderRadius: 'var(--radius-sm)',
                        background:
                          turn.role === 'user' ? 'var(--accent-sage-soft)' : 'var(--bg-canvas)',
                        border: '1px solid var(--border-light)',
                        fontSize: '0.82rem',
                        whiteSpace: 'pre-line',
                      }}
                    >
                      <strong style={{ fontSize: '0.72rem', color: 'var(--ink-muted)' }}>
                        {turn.role === 'user' ? 'YOU' : 'GEMINI'}
                      </strong>
                      <div style={{ marginTop: 2 }}>{turn.text}</div>
                    </div>
                  ))}
                </div>
              )}

              {proposedUpdates.length > 0 && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--status-amber-soft)',
                    border: '1px solid var(--status-amber)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    fontSize: '0.78rem',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    Proposed Timeline Adjustments ({proposedUpdates.length}):
                  </div>
                  {proposedUpdates.map((u, idx) => (
                    <div key={idx}>
                      • <strong>{u.stepTitle}</strong>
                      {u.applianceId !== undefined ? ` → ${u.applianceId || 'Unassigned'}` : ''}
                      {u.durationMin !== undefined ? ` · ${u.durationMin}m` : ''}
                      {u.temperature !== undefined ? ` · ${u.temperature}°F` : ''}
                      {u.slotsRequired !== undefined ? ` · ${u.slotsRequired} slots` : ''} —{' '}
                      <span style={{ color: 'var(--ink-secondary)' }}>{u.reason}</span>
                    </div>
                  ))}
                  <div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ marginTop: 4 }}
                      disabled={appliedUpdates}
                      onClick={() => {
                        onApplyScheduleUpdates(proposedUpdates);
                        setAppliedUpdates(true);
                      }}
                    >
                      <Check size={14} />
                      {appliedUpdates
                        ? 'Applied Updates to Timeline!'
                        : 'Apply Recommended Updates to Timeline'}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="text"
                  value={followUpInput}
                  onChange={(e) => setFollowUpInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && followUpInput.trim() && !loading) {
                      e.preventDefault();
                      runEvaluation(followUpInput);
                    }
                  }}
                  placeholder="Reply with corrections or preferences (e.g., Put stuffing in Second Oven)..."
                  style={{ flex: 1, padding: '7px 10px', fontSize: '0.82rem' }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={loading || !followUpInput.trim()}
                  onClick={() => runEvaluation(followUpInput)}
                >
                  <Send size={13} /> Reply
                </button>
              </div>
            </>
          )}

          {tab === 'paste' && (
            <>
              {/* Gemini Skill / Gem Instructions Builder */}
              <div
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-sage-soft)',
                  border: '1px solid var(--border-strong)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--ink-primary)' }}>
                      Gemini Skill / Gem Instructions
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--ink-secondary)', marginTop: 2 }}>
                      Copy these instructions to create a reusable Gemini Gem/Skill with your exact
                      appliances &amp; ThymeLine meal schema—so you can brainstorm menus, process
                      photos, or research recipes and export meals ready to paste below.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: '0.78rem' }}
                    onClick={handleCopySkillInstructions}
                  >
                    {copiedSkill ? <Check size={14} /> : <Copy size={14} />}
                    {copiedSkill ? 'Copied Skill Instructions!' : 'Copy Gemini Skill Instructions'}
                  </button>
                </div>
              </div>

              {steps.length > 0 && (
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

              <div className="form-field">
                <label>
                  {effectiveMode === 'add'
                    ? `1. Quick-describe new items to add (prompt includes your ${steps.length} existing steps)`
                    : '1. Quick-describe your full meal menu'}
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

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="btn btn-secondary" onClick={handleCopyPrompt}>
                  {copiedPrompt ? <Check size={14} /> : <Copy size={14} />}
                  {copiedPrompt ? 'Copied Gemini Prompt!' : 'Copy Prompt for Gemini Chat'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleApiGenerate}
                  disabled={loading}
                >
                  <Sparkles size={14} />
                  {loading
                    ? 'Generating...'
                    : effectiveMode === 'add'
                    ? 'Generate & Add via API'
                    : 'Generate Schedule via API'}
                </button>
              </div>

              <div className="form-field">
                <label>
                  {effectiveMode === 'add'
                    ? '2. Paste Meal JSON (single dish or array of dishes) or Step JSON from Gemini'
                    : '2. Paste Meal JSON (single dish or array of dishes) or Step JSON from Gemini'}
                </label>
                <textarea
                  rows={6}
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  placeholder='[{"name": "Hot Apple Cider", "course": "Beverage", "ingredients": [...], "steps": [...]}]'
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
                />
              </div>
            </>
          )}

          {tab === 'export' && (
            <>
              <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-secondary)' }}>
                Save a local JSON backup of your event steps, or copy it to share across devices.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-primary" onClick={handleDownloadJson}>
                  <Download size={14} /> Download thymeline-schedule.json
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
                {effectiveMode === 'add' ? 'Import Meals to Schedule' : 'Import Meals'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
