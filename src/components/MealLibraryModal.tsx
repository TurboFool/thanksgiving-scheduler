import React, { useMemo, useState } from 'react';
import { X, Search, Plus, Trash2, BookOpen, ExternalLink } from 'lucide-react';
import type { DishCourse, MealItem } from '../types';

interface MealLibraryModalProps {
  library: MealItem[];
  activeEventName: string;
  onImportToEvent: (item: MealItem) => void;
  onDeleteFromLibrary: (libraryId: string) => void;
  onClose: () => void;
}

const COURSE_FILTERS: Array<'All' | DishCourse> = [
  'All',
  'Main',
  'Side',
  'Appetizer',
  'Sauce / Gravy',
  'Bread',
  'Dessert',
  'Beverage',
  'Prep / Other',
];

export const MealLibraryModal: React.FC<MealLibraryModalProps> = ({
  library,
  activeEventName,
  onImportToEvent,
  onDeleteFromLibrary,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState<'All' | DishCourse>('All');
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library.filter((item) => {
      if (courseFilter !== 'All' && item.course !== courseFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.rawNotes.toLowerCase().includes(q) ||
        item.convertedNotes.toLowerCase().includes(q) ||
        (item.dietaryTags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [library, query, courseFilter]);

  const handleImport = (item: MealItem) => {
    onImportToEvent(item);
    setImportedIds((prev) => new Set(prev).add(item.id));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={18} color="var(--accent-sage)" />
            Saved Meal Library ({library.length})
          </h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--ink-secondary)' }}>
            Import saved dishes into <strong>{activeEventName}</strong>. Each import creates an
            independent copy for this event.
          </p>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--ink-muted)',
                }}
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search dishes, notes, or tags..."
                style={{
                  width: '100%',
                  padding: '7px 10px 7px 30px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-strong)',
                  fontSize: '0.84rem',
                }}
              />
            </div>

            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value as 'All' | DishCourse)}
              style={{
                padding: '7px 10px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-strong)',
                fontSize: '0.84rem',
              }}
            >
              {COURSE_FILTERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div
              style={{
                padding: 20,
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-strong)',
                textAlign: 'center',
                fontSize: '0.82rem',
                color: 'var(--ink-muted)',
              }}
            >
              No matching dishes in your library yet. Open any dish and click{' '}
              <strong>Save to Library</strong> to reuse it across future events.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map((item) => {
                const justImported = importedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className="upnext-item"
                    style={{ marginBottom: 0, alignItems: 'flex-start' }}
                  >
                    <div className="upnext-info">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span className="upnext-title">{item.name}</span>
                        <span className="pill">{item.course}</span>
                        <span className="pill">{item.steps.length} step(s)</span>
                        {item.sourceUrl && (
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: '0.72rem',
                              color: 'var(--accent-sage)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 2,
                            }}
                          >
                            Recipe <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                      {(item.convertedNotes || item.rawNotes) && (
                        <div
                          style={{
                            fontSize: '0.76rem',
                            color: 'var(--ink-secondary)',
                            marginTop: 4,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {item.convertedNotes || item.rawNotes}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        className={`btn ${justImported ? 'btn-secondary' : 'btn-primary'}`}
                        style={{ padding: '5px 10px', fontSize: '0.76rem' }}
                        onClick={() => handleImport(item)}
                      >
                        <Plus size={12} />
                        {justImported ? 'Added!' : 'Add to Event'}
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        title="Remove from library"
                        onClick={() => onDeleteFromLibrary(item.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
            Library items are shared across all events and included in cloud sync.
          </span>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
