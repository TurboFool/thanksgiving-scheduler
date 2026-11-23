import React, { useState } from 'react';
import {
  X,
  Sparkles,
  ExternalLink,
  Plus,
  Trash2,
  BookmarkPlus,
  AlertTriangle,
  History,
  Edit3,
} from 'lucide-react';
import type {
  Appliance,
  DishCourse,
  FinishWindowMode,
  ManualChangeEntry,
  MealItem,
  MealStep,
} from '../types';
import { processMealItemWithGemini } from '../gemini';
import { formatDuration } from '../scheduler';

interface MealItemModalProps {
  item: MealItem | null;
  appliances: Appliance[];
  otherItems: MealItem[];
  allEventSteps: MealStep[];
  apiKey: string;
  onOpenSettings: () => void;
  onSave: (item: MealItem) => void;
  onDelete?: (itemId: string) => void;
  onSaveToLibrary: (item: MealItem) => void;
  onEditStep: (step: MealStep, parentItemId: string) => void;
  onClose: () => void;
}

const COURSES: DishCourse[] = [
  'Main',
  'Side',
  'Appetizer',
  'Sauce / Gravy',
  'Bread',
  'Dessert',
  'Beverage',
  'Prep / Other',
];

export const MealItemModal: React.FC<MealItemModalProps> = ({
  item,
  appliances,
  otherItems,
  apiKey,
  onOpenSettings,
  onSave,
  onDelete,
  onSaveToLibrary,
  onEditStep,
  onClose,
}) => {
  const isNew = !item;
  const [name, setName] = useState(item?.name ?? '');
  const [course, setCourse] = useState<DishCourse>(item?.course ?? 'Side');
  const [servings, setServings] = useState(item?.servings ?? '');
  const [dietaryText, setDietaryText] = useState((item?.dietaryTags ?? []).join(', '));
  const [sourceUrl, setSourceUrl] = useState(item?.sourceUrl ?? '');
  const [rawNotes, setRawNotes] = useState(item?.rawNotes ?? '');
  const [convertedNotes, setConvertedNotes] = useState(item?.convertedNotes ?? '');
  const [prepAheadNotes, setPrepAheadNotes] = useState(item?.prepAheadNotes ?? '');

  const [finishMode, setFinishMode] = useState<FinishWindowMode>(
    item?.finishConstraint.mode ?? 'at_target'
  );
  const [offsetMin, setOffsetMin] = useState(item?.finishConstraint.offsetMin ?? 45);
  const [windowMaxBeforeMin, setWindowMaxBeforeMin] = useState(
    item?.finishConstraint.windowMaxBeforeMin ?? 180
  );
  const [windowMinBeforeMin, setWindowMinBeforeMin] = useState(
    item?.finishConstraint.windowMinBeforeMin ?? 30
  );

  const [steps, setSteps] = useState<MealStep[]>(item?.steps ?? []);
  const [aiProcessedAt, setAiProcessedAt] = useState<number | undefined>(item?.aiProcessedAt);
  const [manualChangeLog, setManualChangeLog] = useState<ManualChangeEntry[]>(
    item?.manualChangeLog ?? []
  );

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [savedToLibMsg, setSavedToLibMsg] = useState(false);

  const appendManualLog = (field: string, summary: string) => {
    if (!aiProcessedAt) return;
    setManualChangeLog((prev) => [
      ...prev,
      {
        id: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: Date.now(),
        field,
        summary,
      },
    ]);
  };

  const buildCurrentItem = (): MealItem => {
    const tags = dietaryText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    return {
      id: item?.id ?? `item-${Date.now()}`,
      name: name.trim() || 'Untitled Dish',
      course,
      servings: servings.trim() || undefined,
      dietaryTags: tags.length > 0 ? tags : undefined,
      rawNotes: rawNotes.trim(),
      sourceUrl: sourceUrl.trim() || undefined,
      convertedNotes: convertedNotes.trim(),
      prepAheadNotes: prepAheadNotes.trim() || undefined,
      finishConstraint: {
        mode: finishMode,
        offsetMin: finishMode === 'before_target' ? Math.max(0, Number(offsetMin) || 0) : undefined,
        windowMaxBeforeMin:
          finishMode === 'window' ? Math.max(15, Number(windowMaxBeforeMin) || 180) : undefined,
        windowMinBeforeMin:
          finishMode === 'window' ? Math.max(0, Number(windowMinBeforeMin) || 30) : undefined,
      },
      steps: steps.map((s) => ({ ...s, dish: name.trim() || s.dish })),
      aiProcessedAt,
      manualChangeLog,
      libraryItemId: item?.libraryItemId,
      updatedAt: Date.now(),
    };
  };

  const handleAddManualStep = () => {
    const app = appliances[0];
    const newStep: MealStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      title: `${name.trim() || 'Dish'} — Step ${steps.length + 1}`,
      dish: name.trim() || 'General',
      durationMin: 20,
      applianceId: app?.id ?? 'oven',
      slotsRequired: 1,
      temperature: app?.hasTemperature ? 350 : undefined,
      dependencies: steps.length > 0 ? [steps[steps.length - 1].id] : [],
      readyBeforeIds: [],
      mustFinishByDinner: finishMode !== 'after_target',
      status: 'pending',
      remainingSec: 20 * 60,
      addedMin: 0,
    };
    setSteps((prev) => [...prev, newStep]);
    appendManualLog('step:added', `Added manual step "${newStep.title}"`);
  };

  const handleRemoveStep = (stepId: string, title: string) => {
    setSteps((prev) =>
      prev
        .filter((s) => s.id !== stepId)
        .map((s) => ({
          ...s,
          dependencies: s.dependencies.filter((d) => d !== stepId),
          readyBeforeIds: s.readyBeforeIds.filter((d) => d !== stepId),
        }))
    );
    appendManualLog('step:removed', `Removed step "${title}"`);
  };

  const handleProcessWithAI = async () => {
    setAiError(null);
    if (!apiKey.trim()) {
      setAiError('Configure your Gemini API key in Settings first.');
      return;
    }
    if (!name.trim() && !rawNotes.trim()) {
      setAiError('Enter a dish name or raw notes first.');
      return;
    }
    setAiLoading(true);
    try {
      const draft = buildCurrentItem();
      const result = await processMealItemWithGemini(apiKey, draft, appliances, otherItems);
      setConvertedNotes(result.convertedNotes);
      if (result.prepAheadNotes) setPrepAheadNotes(result.prepAheadNotes);
      setSteps(result.steps);
      setAiProcessedAt(Date.now());
      setManualChangeLog([]);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to process item with Gemini');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(buildCurrentItem());
  };

  const appMap = new Map(appliances.map((a) => [a.id, a]));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 className="modal-title">{isNew ? 'Add Meal Item' : `Edit Dish: ${item.name}`}</h2>
            {manualChangeLog.length > 0 && (
              <span className="pill delayed" title="Manual edits made after last AI processing">
                Edited since AI ({manualChangeLog.length})
              </span>
            )}
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-field">
                <label htmlFor="dish-name">Dish / Meal Item Name</label>
                <input
                  id="dish-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Herb Roast Turkey, Garlic Mashed Potatoes"
                  required
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label htmlFor="dish-course">Course / Category</label>
                <select
                  id="dish-course"
                  value={course}
                  onChange={(e) => setCourse(e.target.value as DishCourse)}
                >
                  {COURSES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="dish-servings">Servings (optional)</label>
                <input
                  id="dish-servings"
                  type="text"
                  value={servings}
                  onChange={(e) => setServings(e.target.value)}
                  placeholder="e.g., 10–12 guests"
                />
              </div>

              <div className="form-field">
                <label htmlFor="dish-tags">Dietary / Tags (comma-separated)</label>
                <input
                  id="dish-tags"
                  type="text"
                  value={dietaryText}
                  onChange={(e) => setDietaryText(e.target.value)}
                  placeholder="e.g., GF, Vegetarian, Make-Ahead"
                />
              </div>

              <div className="form-field full">
                <label htmlFor="dish-url">Source Recipe URL (optional)</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="dish-url"
                    type="url"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://..."
                    style={{ flex: 1 }}
                  />
                  {sourceUrl.trim() && (
                    <a
                      href={sourceUrl.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary"
                    >
                      <ExternalLink size={13} /> Open
                    </a>
                  )}
                </div>
              </div>

              {/* Finish Window Constraint */}
              <div className="form-field full">
                <label>When Should This Item Finish?</label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 10,
                    alignItems: 'center',
                    padding: 10,
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-light)',
                    background: 'var(--bg-canvas)',
                  }}
                >
                  <select
                    value={finishMode}
                    onChange={(e) => {
                      const next = e.target.value as FinishWindowMode;
                      setFinishMode(next);
                      appendManualLog('finishConstraint', `Changed finish timing to ${next}`);
                    }}
                  >
                    <option value="at_target">At Target Serve Time (hot/fresh at mealtime)</option>
                    <option value="before_target">
                      X Minutes Before Serve Time (cooling / appetizer)
                    </option>
                    <option value="window">
                      Flexible Finish Window (room-temp / reheatable — frees oven space)
                    </option>
                    <option value="after_target">
                      Post-Dinner / Flexible (doesn&apos;t block main serve time)
                    </option>
                  </select>

                  {finishMode === 'before_target' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                      <input
                        type="number"
                        min={5}
                        max={480}
                        value={offsetMin}
                        onChange={(e) => setOffsetMin(Number(e.target.value))}
                        style={{ width: 70 }}
                      />
                      <span>min before</span>
                    </div>
                  )}

                  {finishMode === 'window' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                      <input
                        type="number"
                        min={15}
                        max={720}
                        value={windowMaxBeforeMin}
                        onChange={(e) => setWindowMaxBeforeMin(Number(e.target.value))}
                        style={{ width: 66 }}
                      />
                      <span>to</span>
                      <input
                        type="number"
                        min={0}
                        max={480}
                        value={windowMinBeforeMin}
                        onChange={(e) => setWindowMinBeforeMin(Number(e.target.value))}
                        style={{ width: 66 }}
                      />
                      <span>min early</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="form-field full">
                <label htmlFor="dish-raw">
                  Primary Notes &amp; Recipe (your raw notes, ingredients, and instructions)
                </label>
                <textarea
                  id="dish-raw"
                  rows={4}
                  value={rawNotes}
                  onChange={(e) => {
                    setRawNotes(e.target.value);
                    if (aiProcessedAt) {
                      // Only mark on save if needed; keeping lightweight here
                    }
                  }}
                  placeholder="Paste your recipe, temperatures, prep notes, or rough ideas here..."
                />
              </div>

              {/* AI Processing Bar */}
              <div
                className="form-field full"
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-sage-soft)',
                  border: '1px solid var(--border-strong)',
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
                    <Sparkles size={15} color="var(--accent-sage)" />
                    {apiKey.trim() ? (
                      <span>Use Gemini AI to sanitize notes and generate cooking steps.</span>
                    ) : (
                      <span>
                        No Gemini API key configured.{' '}
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ padding: '2px 6px', fontSize: '0.78rem', textDecoration: 'underline' }}
                          onClick={() => {
                            onClose();
                            onOpenSettings();
                          }}
                        >
                          Open Settings
                        </button>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleProcessWithAI}
                    disabled={aiLoading}
                  >
                    <Sparkles size={14} />
                    {aiLoading
                      ? 'Processing...'
                      : aiProcessedAt
                      ? manualChangeLog.length > 0
                        ? 'Reprocess & Reconcile Manual Edits'
                        : 'Reprocess with Gemini'
                      : 'Process Notes & Generate Steps'}
                  </button>
                </div>
                {aiError && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: '0.78rem',
                      color: 'var(--status-crimson)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <AlertTriangle size={14} /> {aiError}
                  </div>
                )}
              </div>

              <div className="form-field full">
                <label htmlFor="dish-converted">
                  Converted Notes (AI-sanitized kitchen summary)
                </label>
                <textarea
                  id="dish-converted"
                  rows={3}
                  value={convertedNotes}
                  onChange={(e) => setConvertedNotes(e.target.value)}
                  placeholder="Clean step-by-step summary populated by Gemini (or write your own)..."
                />
              </div>

              <div className="form-field full">
                <label htmlFor="dish-prep-ahead">Prep-Ahead / Day-Before Notes (optional)</label>
                <input
                  id="dish-prep-ahead"
                  type="text"
                  value={prepAheadNotes}
                  onChange={(e) => setPrepAheadNotes(e.target.value)}
                  placeholder="e.g., Chop aromatics and assemble casserole the night before"
                />
              </div>

              {/* Steps for this Meal Item */}
              <div className="form-field full">
                <div className="section-label">
                  <span>Cooking &amp; Prep Steps ({steps.length})</span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                    onClick={handleAddManualStep}
                  >
                    <Plus size={12} /> Add Manual Step
                  </button>
                </div>
                {steps.length === 0 ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px dashed var(--border-strong)',
                      fontSize: '0.8rem',
                      color: 'var(--ink-muted)',
                      textAlign: 'center',
                    }}
                  >
                    No steps yet. Click <strong>Process Notes &amp; Generate Steps</strong> or{' '}
                    <strong>Add Manual Step</strong>.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {steps.map((s) => (
                      <div key={s.id} className="upnext-item" style={{ marginBottom: 0 }}>
                        <div className="upnext-info">
                          <div className="upnext-title">{s.title}</div>
                          <div className="upnext-sub">
                            <span>{formatDuration(s.durationMin)}</span>
                            <span>· {appMap.get(s.applianceId)?.name ?? s.applianceId}</span>
                            {s.temperature !== undefined && (
                              <span className="pill temp">{s.temperature}°F</span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {!isNew && (
                            <button
                              type="button"
                              className="btn-icon"
                              title="Edit step details & dependencies"
                              onClick={() => onEditStep(s, item.id)}
                            >
                              <Edit3 size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-icon"
                            title="Remove step"
                            onClick={() => handleRemoveStep(s.id, s.title)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {manualChangeLog.length > 0 && (
                <div className="form-field full">
                  <div className="section-label">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <History size={12} /> Manual Change Log Since Last AI Run
                    </span>
                  </div>
                  <div
                    style={{
                      padding: 8,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--status-amber-soft)',
                      fontSize: '0.76rem',
                      color: 'var(--ink-secondary)',
                    }}
                  >
                    {manualChangeLog.map((m) => (
                      <div key={m.id}>• {m.summary}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {item && onDelete && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: 'var(--status-crimson)' }}
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 size={14} /> Delete Dish
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  onSaveToLibrary(buildCurrentItem());
                  setSavedToLibMsg(true);
                  setTimeout(() => setSavedToLibMsg(false), 2000);
                }}
              >
                <BookmarkPlus size={14} />
                {savedToLibMsg ? 'Saved to Library!' : 'Save to Library'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                {isNew ? 'Add Dish to Event' : 'Save Dish'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
