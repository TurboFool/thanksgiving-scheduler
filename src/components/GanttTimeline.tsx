import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, ZoomIn, ZoomOut, Clock, Play, GripVertical, Pin, Snowflake } from 'lucide-react';
import type { Appliance, ScheduledStep } from '../types';
import { formatApplianceWithMode, formatDuration, formatTimeMin } from '../scheduler';

interface GanttTimelineProps {
  appliances: Appliance[];
  steps: ScheduledStep[];
  earliestStartMin: number;
  projectedDinnerMin: number;
  targetDinnerMin: number;
  nowMin: number;
  selectedStepId: string | null;
  highlightedDish?: string | null;
  onSelectStep: (step: ScheduledStep) => void;
  onStartStep: (id: string) => void;
  onMoveStep?: (stepId: string, newStartMin: number) => void;
  onAssignAppliance?: (stepId: string, applianceId: string) => void;
  onReorderAppliances?: (fromIndex: number, toIndex: number) => void;
}

const ROW_HEIGHT = 58;
const LANE_PAD_Y = 8;

export const GanttTimeline: React.FC<GanttTimelineProps> = ({
  appliances,
  steps,
  earliestStartMin,
  projectedDinnerMin,
  targetDinnerMin,
  nowMin,
  selectedStepId,
  highlightedDish,
  onSelectStep,
  onStartStep,
  onMoveStep,
  onAssignAppliance,
  onReorderAppliances,
}) => {
  const [pxPerMin, setPxPerMin] = useState(4.6);
  const [autoZoom, setAutoZoom] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(900);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lastInteractionAtRef = useRef<number>(0);
  const lastAutoZoomAtRef = useRef<number>(0);
  const lastAutoStateRef = useRef<{ tier: string; doneCount: number; runningCount: number }>({
    tier: '',
    doneCount: -1,
    runningCount: -1,
  });

  const [dragLaneIdx, setDragLaneIdx] = useState<number | null>(null);
  const [overLaneIdx, setOverLaneIdx] = useState<number | null>(null);
  const [dragStep, setDragStep] = useState<{
    id: string;
    origStartMin: number;
    previewStartMin: number;
  } | null>(null);
  const dragOriginRef = useRef<{
    id: string;
    startX: number;
    origStartMin: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      if (el.clientWidth > 0) setViewportWidth(el.clientWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      const dx = e.clientX - origin.startX;
      if (!origin.moved && Math.abs(dx) < 6) return;
      origin.moved = true;
      lastInteractionAtRef.current = Date.now();
      const deltaMin = Math.round(dx / pxPerMin / 5) * 5;
      const nextStart = Math.max(0, Math.min(23 * 60 + 45, origin.origStartMin + deltaMin));
      setDragStep({
        id: origin.id,
        origStartMin: origin.origStartMin,
        previewStartMin: nextStart,
      });
    };

    const handlePointerUp = () => {
      const origin = dragOriginRef.current;
      if (!origin) return;
      dragOriginRef.current = null;
      if (origin.moved) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 50);
      }
      setDragStep((cur) => {
        if (cur && origin.moved && cur.previewStartMin !== cur.origStartMin && onMoveStep) {
          onMoveStep(cur.id, cur.previewStartMin);
        }
        return null;
      });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [pxPerMin, onMoveStep]);

  // Timeline bounds: pad 20m before earliest/now and 30m after projected/target dinner
  const startBound = useMemo(() => {
    const raw = Math.min(earliestStartMin, nowMin) - 20;
    return Math.floor(raw / 30) * 30;
  }, [earliestStartMin, nowMin]);

  const endBound = useMemo(() => {
    const raw = Math.max(projectedDinnerMin, targetDinnerMin, nowMin + 30) + 30;
    return Math.ceil(raw / 30) * 30;
  }, [projectedDinnerMin, targetDinnerMin, nowMin]);

  const totalMin = Math.max(60, endBound - startBound);
  const availTrackWidth = Math.max(320, viewportWidth - 195);

  const startBoundRef = useRef(startBound);
  const pxPerMinRef = useRef(pxPerMin);
  useEffect(() => {
    startBoundRef.current = startBound;
    pxPerMinRef.current = pxPerMin;
  }, [startBound, pxPerMin]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const applyZoomAroundClientX = (nextPxRaw: number, clientX: number) => {
      const prevPx = pxPerMinRef.current;
      const nextPx = Math.min(60, Math.max(1.2, Number(nextPxRaw.toFixed(2))));
      if (nextPx === prevPx) return;

      const rect = el.getBoundingClientRect();
      const pointerXInView = clientX - rect.left;
      const trackOffsetX = Math.max(0, pointerXInView - 185);
      const sb = startBoundRef.current;
      const timeAtPointer = sb + (el.scrollLeft + trackOffsetX) / prevPx;

      pxPerMinRef.current = nextPx;
      lastInteractionAtRef.current = Date.now();
      setAutoZoom(false);
      setPxPerMin(nextPx);

      window.requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, (timeAtPointer - startBoundRef.current) * nextPx - trackOffsetX);
      });
    };

    const handleWheel = (e: WheelEvent) => {
      lastInteractionAtRef.current = Date.now();
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.max(0.7, Math.min(1.4, Math.exp(-e.deltaY * 0.01)));
      applyZoomAroundClientX(pxPerMinRef.current * factor, e.clientX);
    };

    let lastPinchDist: number | null = null;
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const [t1, t2] = [e.touches[0], e.touches[1]];
        lastPinchDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      } else {
        lastPinchDist = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && lastPinchDist !== null) {
        e.preventDefault();
        const [t1, t2] = [e.touches[0], e.touches[1]];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        if (lastPinchDist > 0) {
          const ratio = Math.max(0.7, Math.min(1.4, dist / lastPinchDist));
          const midX = (t1.clientX + t2.clientX) / 2;
          applyZoomAroundClientX(pxPerMinRef.current * ratio, midX);
        }
        lastPinchDist = dist;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        lastPinchDist = null;
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });
    el.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  const zoomToWindow = (windowMin: number, focusMin = nowMin) => {
    const nextPx = Math.min(60, Math.max(1.2, availTrackWidth / Math.max(15, windowMin)));
    setPxPerMin(nextPx);
    window.requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const targetX = Math.max(0, (focusMin - startBound) * nextPx - availTrackWidth * 0.22);
      el.scrollTo({ left: targetX, behavior: 'smooth' });
    });
  };

  // Infrequent, non-disruptive Auto-Zoom as dinner approaches & steps complete/start
  useEffect(() => {
    if (!autoZoom || dragStep) return;
    const nowMs = Date.now();
    // Pause auto-zoom for 15s after any user scroll/pointer/wheel interaction
    if (nowMs - lastInteractionAtRef.current < 15_000) return;

    const doneCount = steps.filter((s) => s.status === 'done').length;
    const runningCount = steps.filter((s) => s.status === 'running').length;
    const activeOrPending = steps.filter((s) => s.status !== 'done');
    const maxEnd = activeOrPending.reduce(
      (acc, s) => Math.max(acc, s.endMin),
      Math.max(targetDinnerMin, projectedDinnerMin)
    );
    const remainingMin = Math.max(15, maxEnd - nowMin);

    let tier = 'fit';
    let targetWindow = totalMin;
    if (remainingMin <= 25) {
      tier = '15m';
      targetWindow = 18;
    } else if (remainingMin <= 50) {
      tier = '30m';
      targetWindow = 35;
    } else if (remainingMin <= 105) {
      tier = '60m';
      targetWindow = 75;
    } else if (remainingMin <= 180) {
      tier = '120m';
      targetWindow = 140;
    }

    const prev = lastAutoStateRef.current;
    const completionChanged = doneCount !== prev.doneCount || runningCount !== prev.runningCount;
    const tierChanged = tier !== prev.tier;
    const cooldownElapsed = nowMs - lastAutoZoomAtRef.current >= 90_000;

    if (!tierChanged && !completionChanged) return;
    if (!completionChanged && !cooldownElapsed && prev.tier !== '') return;

    lastAutoStateRef.current = { tier, doneCount, runningCount };
    lastAutoZoomAtRef.current = nowMs;

    const nextPx = Math.min(60, Math.max(1.2, availTrackWidth / Math.max(15, targetWindow)));
    setPxPerMin(nextPx);
    window.requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const focus = tier === 'fit' ? startBound : nowMin;
      const targetX = Math.max(0, (focus - startBound) * nextPx - availTrackWidth * 0.2);
      el.scrollTo({ left: targetX, behavior: 'smooth' });
    });
  }, [
    autoZoom,
    dragStep,
    steps,
    nowMin,
    targetDinnerMin,
    projectedDinnerMin,
    totalMin,
    availTrackWidth,
    startBound,
  ]);

  const trackWidth = Math.max(700, totalMin * pxPerMin);

  // Tick marks adapt cleanly from 60m (zoomed out) down to 5m (15m crunch-time view)
  const tickStep =
    pxPerMin >= 30 ? 5 : pxPerMin >= 15 ? 10 : pxPerMin >= 8 ? 15 : pxPerMin >= 2.2 ? 30 : 60;
  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (let t = startBound; t <= endBound; t += tickStep) {
      arr.push(t);
    }
    return arr;
  }, [startBound, endBound, tickStep]);

  const unassignedSteps = useMemo(
    () => steps.filter((s) => !s.resolvedApplianceId),
    [steps]
  );

  const categories = useMemo(
    () =>
      Array.from(
        new Set(appliances.map((a) => (a.category || '').trim()).filter(Boolean))
      ),
    [appliances]
  );

  // Compute lane heights, step Y positions, and staggered callout planes for crowded narrow bars
  const laneLayout = useMemo(() => {
    const CALLOUT_PLANE_H = 26;
    let yCursor = 0;
    const laneMeta = new Map<string, { top: number; height: number; rows: number }>();
    const stepRects = new Map<
      string,
      { x: number; y: number; w: number; h: number; calloutPlane: number; calloutTopInLane: number }
    >();

    if (unassignedSteps.length > 0) {
      const rows = unassignedSteps.length;
      const height = rows * ROW_HEIGHT + LANE_PAD_Y * 2;
      laneMeta.set('__unassigned__', { top: yCursor, height, rows });
      unassignedSteps.forEach((s, idx) => {
        const x = (s.startMin - startBound) * pxPerMin;
        const w = Math.max(120, (s.endMin - s.startMin) * pxPerMin);
        const y = yCursor + LANE_PAD_Y + idx * ROW_HEIGHT + 3;
        const h = ROW_HEIGHT - 6;
        stepRects.set(s.id, { x, y, w, h, calloutPlane: 0, calloutTopInLane: 0 });
      });
      yCursor += height;
    }

    for (const app of appliances) {
      const appSteps = steps.filter((s) => s.resolvedApplianceId === app.id);
      let maxRowUsed = 1;
      for (const s of appSteps) {
        maxRowUsed = Math.max(maxRowUsed, s.laneRow + Math.max(1, s.slotsRequired));
      }
      const rows = Math.max(1, maxRowUsed);
      const barsBottomInLane = rows * ROW_HEIGHT + LANE_PAD_Y;

      // Compute bar rectangles first
      const barEntries = appSteps.map((s) => {
        const x = (s.startMin - startBound) * pxPerMin;
        const w = Math.max(32, (s.endMin - s.startMin) * pxPerMin);
        const slotSpan = Math.min(rows - s.laneRow, Math.max(1, s.slotsRequired));
        const y = yCursor + LANE_PAD_Y + s.laneRow * ROW_HEIGHT + 3;
        const h = slotSpan * ROW_HEIGHT - 6;
        return { s, x, w, y, h };
      });

      // Plane 0 is inline beside the bar; seed it with all bar footprints so inline callouts
      // never overlap adjacent bars on laneRow 0. Planes 1+ sit cleanly below the bars.
      const planeIntervals: Array<Array<{ start: number; end: number; stepId?: string }>> = [
        barEntries.map((b) => ({ start: b.x - 2, end: b.x + b.w + 2, stepId: b.s.id })),
      ];

      const narrowEntries = barEntries
        .filter((b) => b.w < 110)
        .sort((a, b) => a.x - b.x);

      const calloutAssignments = new Map<string, { plane: number; topInLane: number }>();

      for (const entry of narrowEntries) {
        const estWidth = Math.min(220, Math.max(84, entry.s.title.length * 6.8 + 46));
        const nearRightEdge = entry.x + entry.w > trackWidth - 180;

        // Plane 0 sits beside the bar; Planes 1+ sit below the bars aligned with the bar's edge
        let chosenPlane = -1;
        for (let p = 0; p < planeIntervals.length; p++) {
          const pStart =
            p === 0
              ? nearRightEdge
                ? entry.x - estWidth - 5
                : entry.x + entry.w + 5
              : nearRightEdge
              ? entry.x + entry.w - estWidth
              : entry.x;
          const pEnd = pStart + estWidth;

          const overlaps = planeIntervals[p].some(
            (iv) => iv.stepId !== entry.s.id && iv.start < pEnd + 6 && iv.end > pStart - 6
          );
          if (!overlaps) {
            chosenPlane = p;
            planeIntervals[p].push({ start: pStart, end: pEnd, stepId: entry.s.id });
            break;
          }
        }

        if (chosenPlane === -1) {
          chosenPlane = planeIntervals.length;
          const pStart = nearRightEdge ? entry.x + entry.w - estWidth : entry.x;
          planeIntervals.push([{ start: pStart, end: pStart + estWidth, stepId: entry.s.id }]);
        }

        const topInLane =
          chosenPlane === 0 ? 0 : barsBottomInLane + (chosenPlane - 1) * CALLOUT_PLANE_H + 2;
        calloutAssignments.set(entry.s.id, { plane: chosenPlane, topInLane });
      }

      const extraPlanes = Math.max(0, planeIntervals.length - 1);
      const height = rows * ROW_HEIGHT + LANE_PAD_Y * 2 + extraPlanes * CALLOUT_PLANE_H;
      laneMeta.set(app.id, { top: yCursor, height, rows });

      for (const b of barEntries) {
        const assigned = calloutAssignments.get(b.s.id);
        stepRects.set(b.s.id, {
          x: b.x,
          y: b.y,
          w: b.w,
          h: b.h,
          calloutPlane: assigned?.plane ?? 0,
          calloutTopInLane: assigned?.topInLane ?? 0,
        });
      }
      yCursor += height;
    }

    return { laneMeta, stepRects, totalHeight: yCursor };
  }, [appliances, steps, unassignedSteps, startBound, pxPerMin, trackWidth]);

  const nowX = (nowMin - startBound) * pxPerMin;
  const dinnerX = (targetDinnerMin - startBound) * pxPerMin;

  return (
    <section className="timeline-panel">
      <div className="timeline-toolbar">
        <div className="panel-title">
          <Clock size={15} /> Appliance Timeline &amp; Dependencies
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--ink-muted)' }}>
            Click block to edit · Drag pending to reschedule
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '3px 7px', fontSize: '0.72rem' }}
              onClick={() => {
                setAutoZoom(false);
                zoomToWindow(15);
              }}
              title="Zoom in to a 15-minute crunch-time window around Now"
            >
              15m
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '3px 7px', fontSize: '0.72rem' }}
              onClick={() => {
                setAutoZoom(false);
                zoomToWindow(30);
              }}
              title="Zoom in to a 30-minute window around Now"
            >
              30m
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '3px 7px', fontSize: '0.72rem' }}
              onClick={() => {
                setAutoZoom(false);
                zoomToWindow(60);
              }}
              title="Zoom to a 1-hour window around Now"
            >
              1h
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '3px 7px', fontSize: '0.72rem' }}
              onClick={() => {
                setAutoZoom(false);
                zoomToWindow(totalMin, startBound);
              }}
              title="Fit entire schedule"
            >
              Fit
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => {
                setAutoZoom(false);
                setPxPerMin((p) => Math.max(1.2, Number((p * 0.75).toFixed(2))));
              }}
              title="Zoom out"
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => {
                setAutoZoom(false);
                setPxPerMin((p) => Math.min(60, Number((p * 1.35).toFixed(2))));
              }}
              title="Zoom in"
            >
              <ZoomIn size={15} />
            </button>
            <button
              type="button"
              className={`btn ${autoZoom ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '3px 8px', fontSize: '0.72rem', marginLeft: 2 }}
              onClick={() => {
                lastAutoStateRef.current = { tier: '', doneCount: -1, runningCount: -1 };
                lastInteractionAtRef.current = 0;
                setAutoZoom((a) => !a);
              }}
              title="Automatically zoom in as dinner approaches and older steps complete (pauses for 15s whenever you scroll or interact)"
            >
              Auto
            </button>
          </div>
        </div>
      </div>

      <div
        className="timeline-scroll"
        ref={scrollContainerRef}
        onScroll={() => {
          lastInteractionAtRef.current = Date.now();
        }}
        onWheel={() => {
          lastInteractionAtRef.current = Date.now();
        }}
        onPointerDown={() => {
          lastInteractionAtRef.current = Date.now();
        }}
      >
        <div className="gantt-container" style={{ width: 185 + trackWidth }}>
          {/* Sticky Header */}
          <div className="gantt-header">
            <div className="gantt-lane-label-head">Appliance</div>
            <div className="gantt-time-axis" style={{ width: trackWidth }}>
              {ticks.map((t) => (
                <div
                  key={t}
                  className="time-tick"
                  style={{ left: (t - startBound) * pxPerMin }}
                >
                  {formatTimeMin(t)}
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="gantt-body" style={{ height: laneLayout.totalHeight }}>
            {unassignedSteps.length > 0 && (() => {
              const meta = laneLayout.laneMeta.get('__unassigned__')!;
              return (
                <div
                  key="__unassigned__"
                  className="gantt-lane"
                  style={{ height: meta.height, background: 'var(--status-amber-soft)' }}
                >
                  <div className="gantt-lane-label" style={{ background: 'var(--status-amber-soft)' }}>
                    <div className="lane-name" style={{ color: 'var(--status-amber)' }}>
                      <span className="lane-dot" style={{ background: 'var(--status-amber)' }} />
                      Needs Location
                    </div>
                    <div className="lane-cap">
                      {unassignedSteps.length} unassigned step(s)
                    </div>
                  </div>
                  <div className="gantt-lane-track" style={{ width: trackWidth }}>
                    {ticks.map((t) => (
                      <div
                        key={t}
                        className="gantt-grid-line"
                        style={{ left: (t - startBound) * pxPerMin }}
                      />
                    ))}
                    {unassignedSteps.map((s) => {
                      const rect = laneLayout.stepRects.get(s.id)!;
                      return (
                        <div
                          key={s.id}
                          className="gantt-task status-pending"
                          style={{
                            left: rect.x,
                            top: rect.y - meta.top,
                            width: rect.w,
                            height: rect.h,
                            borderLeftWidth: 4,
                            borderLeftColor: 'var(--status-amber)',
                            borderStyle: 'dashed',
                          }}
                          onClick={() => onSelectStep(s)}
                          title={`${s.title} — click to edit or choose an appliance`}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                            <span className="task-bar-title">{s.title}</span>
                          </div>
                          <div className="task-bar-sub" style={{ justifyContent: 'space-between' }}>
                            <span className="mono">{formatDuration(s.endMin - s.startMin)}</span>
                            {onAssignAppliance && (
                              <select
                                aria-label={`Assign appliance for ${s.title}`}
                                value=""
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  if (e.target.value) onAssignAppliance(s.id, e.target.value);
                                }}
                                style={{
                                  fontSize: '0.66rem',
                                  padding: '1px 3px',
                                  borderRadius: 4,
                                  border: '1px solid var(--border-strong)',
                                  background: '#fff',
                                  maxWidth: 110,
                                }}
                              >
                                <option value="">Assign...</option>
                                {categories.map((cat) => (
                                  <option key={`c-${cat}`} value={`category:${cat}`}>
                                    Any {cat}
                                  </option>
                                ))}
                                {appliances.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {appliances.map((app, appIdx) => {
              const meta = laneLayout.laneMeta.get(app.id)!;
              const appSteps = steps.filter((s) => s.resolvedApplianceId === app.id);
              const isDropTarget = overLaneIdx === appIdx && dragLaneIdx !== null && dragLaneIdx !== appIdx;

              return (
                <div
                  key={app.id}
                  className="gantt-lane"
                  style={{
                    height: meta.height,
                    boxShadow: isDropTarget ? 'inset 0 2px 0 var(--accent-terracotta)' : undefined,
                  }}
                  onDragOver={(e) => {
                    if (dragLaneIdx === null) return;
                    e.preventDefault();
                    if (overLaneIdx !== appIdx) setOverLaneIdx(appIdx);
                  }}
                  onDrop={() => {
                    if (dragLaneIdx !== null && dragLaneIdx !== appIdx && onReorderAppliances) {
                      onReorderAppliances(dragLaneIdx, appIdx);
                    }
                    setDragLaneIdx(null);
                    setOverLaneIdx(null);
                  }}
                >
                  <div
                    className="gantt-lane-label"
                    draggable={Boolean(onReorderAppliances)}
                    onDragStart={() => setDragLaneIdx(appIdx)}
                    onDragEnd={() => {
                      setDragLaneIdx(null);
                      setOverLaneIdx(null);
                    }}
                    title={onReorderAppliances ? 'Drag to reorder appliance lane' : undefined}
                    style={{
                      cursor: onReorderAppliances ? 'grab' : undefined,
                      opacity: dragLaneIdx === appIdx ? 0.55 : 1,
                    }}
                  >
                    <div className="lane-name">
                      {onReorderAppliances && (
                        <GripVertical size={13} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
                      )}
                      <span className="lane-dot" style={{ background: app.color }} />
                      {app.name}
                    </div>
                    <div className="lane-cap">
                      {app.capacity} {app.slotLabel}
                      {app.capacity > 1 ? 's' : ''}
                      {app.hasTemperature ? ` · ±${app.tempTolerance}°F` : ''}
                    </div>
                  </div>

                  <div className="gantt-lane-track" style={{ width: trackWidth }}>
                    {ticks.map((t) => (
                      <div
                        key={t}
                        className="gantt-grid-line"
                        style={{ left: (t - startBound) * pxPerMin }}
                      />
                    ))}

                    {appSteps.map((s) => {
                      const rect = laneLayout.stepRects.get(s.id)!;
                      const isRinging = s.status === 'running' && s.remainingSec <= 0;
                      const statusClass = isRinging ? 'ringing' : `status-${s.status}`;
                      const isSelected = selectedStepId === s.id;
                      const isDimmed = Boolean(highlightedDish && s.dish !== highlightedDish);
                      const isDraggingThis = dragStep?.id === s.id;
                      const displayX = isDraggingThis
                        ? (dragStep.previewStartMin - startBound) * pxPerMin
                        : rect.x;
                      const canDrag = s.status === 'pending' && Boolean(onMoveStep);
                      const isNarrow = rect.w < 110;
                      const calloutLeft = displayX + rect.w > trackWidth - 180;

                      const trans = s.transitionBefore;
                      const prevTransStep = trans
                        ? appSteps.find((p) => p.id === trans.fromStepId)
                        : undefined;
                      const transVisMin = trans
                        ? prevTransStep
                          ? Math.max(0, Math.min(trans.durationMin, s.startMin - prevTransStep.endMin))
                          : trans.durationMin
                        : 0;
                      const transW = transVisMin > 0 ? Math.max(8, transVisMin * pxPerMin) : 0;

                      return (
                        <React.Fragment key={s.id}>
                          {trans && transW > 0 && !isDraggingThis && (
                            <div
                              className={`gantt-transition-band ${trans.type}`}
                              style={{
                                left: displayX - transW,
                                top: rect.y - meta.top,
                                width: transW,
                                height: rect.h,
                              }}
                              title={`${
                                trans.type === 'preheat' ? 'Preheat' : 'Cool down'
                              } ${trans.durationMin}m (${trans.fromTemp}°F → ${trans.toTemp}°F)`}
                            >
                              {transW >= 58
                                ? `${trans.type === 'preheat' ? 'Preheat' : 'Cool'} +${trans.durationMin}m`
                                : transW >= 24
                                ? `+${trans.durationMin}m`
                                : ''}
                            </div>
                          )}
                          <div
                            className={`gantt-task ${statusClass} ${isSelected ? 'selected' : ''} ${
                              isNarrow ? 'is-narrow' : ''
                            }`}
                            style={{
                              left: displayX,
                              top: rect.y - meta.top,
                              width: rect.w,
                              height: rect.h,
                              borderLeftWidth: 4,
                              borderLeftColor: app.color,
                              opacity: isDimmed ? 0.32 : isDraggingThis ? 0.88 : undefined,
                              cursor: canDrag ? (isDraggingThis ? 'grabbing' : 'grab') : 'pointer',
                              zIndex: isDraggingThis ? 25 : undefined,
                            }}
                            onPointerDown={(e) => {
                              if (!canDrag || e.button !== 0) return;
                              if ((e.target as HTMLElement).closest('button')) return;
                              dragOriginRef.current = {
                                id: s.id,
                                startX: e.clientX,
                                origStartMin: s.startMin,
                                moved: false,
                              };
                            }}
                            onClick={() => {
                              if (suppressClickRef.current) return;
                              onSelectStep(s);
                            }}
                            title={`${s.title} (${formatTimeMin(s.startMin)} – ${formatTimeMin(s.endMin)})\n${formatApplianceWithMode(app.name, s.effectiveMode ?? s.applianceMode)}${
                              s.temperature !== undefined ? ` @ ${s.temperature}°F` : ''
                            }${
                              s.modeDecisionNote ? `\nMode Note: ${s.modeDecisionNote}` : ''
                            }${
                              trans
                                ? `\n${trans.type === 'preheat' ? 'Preheat' : 'Cool down'}: ${trans.durationMin}m (${trans.fromTemp}°F → ${trans.toTemp}°F)`
                                : ''
                            }${
                              s.canPrepEarly && s.preservationNotes
                                ? `\nEarly Prep: ${s.preservationNotes}`
                                : ''
                            }`}
                          >
                            {isNarrow && !isDraggingThis && (() => {
                              const barTopInLane = rect.y - meta.top;
                              const isStaggered = rect.calloutPlane > 0;
                              const relTop = isStaggered ? rect.calloutTopInLane - barTopInLane : 0;
                              return (
                                <>
                                  {isStaggered && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        top: rect.h,
                                        left: calloutLeft ? undefined : Math.min(10, rect.w / 2),
                                        right: calloutLeft ? Math.min(10, rect.w / 2) : undefined,
                                        width: 1.5,
                                        height: Math.max(4, relTop - rect.h + 4),
                                        background: app.color,
                                        opacity: 0.65,
                                        pointerEvents: 'none',
                                      }}
                                    />
                                  )}
                                  <div
                                    className={`gantt-task-callout ${
                                      isStaggered
                                        ? ''
                                        : calloutLeft
                                        ? 'align-left'
                                        : 'align-right'
                                    }`}
                                    style={{
                                      borderLeft: `3px solid ${app.color}`,
                                      ...(isStaggered
                                        ? {
                                            top: relTop,
                                            transform: 'none',
                                            left: calloutLeft ? undefined : 0,
                                            right: calloutLeft ? 0 : undefined,
                                          }
                                        : {}),
                                    }}
                                  >
                                    <span
                                      style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {s.title}
                                    </span>
                                    {(s.effectiveMode || s.applianceMode) && (
                                      <span
                                        className={`pill ${s.modeDecisionNote ? 'mode-fallback' : 'mode'}`}
                                        style={{ fontSize: '0.62rem', padding: '0 4px', flexShrink: 0 }}
                                        title={s.modeDecisionNote || `Mode: ${s.effectiveMode ?? s.applianceMode}`}
                                      >
                                        {s.effectiveMode || s.applianceMode}
                                        {s.modeDecisionNote ? ' ⓘ' : ''}
                                      </span>
                                    )}
                                    <span
                                      className="mono"
                                      style={{ fontSize: '0.66rem', color: 'var(--ink-muted)', flexShrink: 0 }}
                                    >
                                      {formatDuration(s.endMin - s.startMin)}
                                    </span>
                                  </div>
                                </>
                              );
                            })()}
                          {isDraggingThis && (
                            <div
                              style={{
                                position: 'absolute',
                                top: -20,
                                left: 0,
                                background: 'var(--ink-primary)',
                                color: '#fff',
                                fontSize: '0.66rem',
                                fontWeight: 600,
                                padding: '2px 6px',
                                borderRadius: 4,
                                whiteSpace: 'nowrap',
                                pointerEvents: 'none',
                              }}
                            >
                              {formatTimeMin(dragStep.previewStartMin)}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                            <span className="task-bar-title">{s.title}</span>
                            {s.status === 'pending' && rect.w > 75 && (
                              <button
                                type="button"
                                className="btn-icon"
                                style={{ padding: 2, border: 'none', background: 'rgba(255,255,255,0.75)' }}
                                title="Start timer now"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onStartStep(s.id);
                                }}
                              >
                                <Play size={11} />
                              </button>
                            )}
                          </div>
                          <div className="task-bar-sub">
                            <span className="mono">{formatDuration(s.endMin - s.startMin)}</span>
                            {(s.effectiveMode || s.applianceMode) && (
                              <span
                                className={`pill ${s.modeDecisionNote ? 'mode-fallback' : 'mode'}`}
                                style={{ padding: '0 4px', fontSize: '0.64rem' }}
                                title={
                                  s.modeDecisionNote ??
                                  `Mode: ${s.effectiveMode ?? s.applianceMode} (${s.modePreference ?? 'preferred'})`
                                }
                              >
                                {s.effectiveMode || s.applianceMode}
                                {s.modeDecisionNote ? ' ⓘ' : ''}
                              </span>
                            )}
                            {s.pinnedStartMin !== undefined && (
                              <span title="Manually pinned start time" style={{ color: 'var(--accent-sage)' }}>
                                <Pin size={10} />
                              </span>
                            )}
                            {s.canPrepEarly && (
                              <span
                                title={
                                  s.preservationNotes
                                    ? `Early Prep: ${s.preservationNotes}`
                                    : 'Can be prepped early & held'
                                }
                                style={{ color: '#0F766E' }}
                              >
                                <Snowflake size={10} />
                              </span>
                            )}
                            {s.temperature !== undefined && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: '#B44619', fontWeight: 600 }}>
                                <Flame size={10} />
                                {s.temperature}°F
                              </span>
                            )}
                            {s.slotsRequired > 1 && (
                              <span>
                                · {s.slotsRequired} {app.slotLabel}s
                              </span>
                            )}
                            {s.isDelayed && (
                              <span style={{ color: 'var(--status-amber)', fontWeight: 700 }}>
                                +{s.delayMin}m
                              </span>
                            )}
                          </div>
                        </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* SVG Dependency Arrows Overlay */}
            <svg
              width={trackWidth}
              height={laneLayout.totalHeight}
              style={{
                position: 'absolute',
                top: 0,
                left: 185,
                pointerEvents: 'none',
                zIndex: 4,
              }}
            >
              <defs>
                <marker
                  id="dep-arrow"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6 Z" fill="#8A7E73" />
                </marker>
                <marker
                  id="dep-arrow-active"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6 Z" fill="#C2592B" />
                </marker>
              </defs>
              {steps.map((s) =>
                s.effectivePrereqs.map((pId) => {
                  const from = laneLayout.stepRects.get(pId);
                  const to = laneLayout.stepRects.get(s.id);
                  if (!from || !to) return null;
                  const x1 = from.x + from.w;
                  const y1 = from.y + from.h / 2;
                  const x2 = to.x;
                  const y2 = to.y + to.h / 2;
                  const dx = Math.max(18, Math.abs(x2 - x1) * 0.45);
                  const highlighted = selectedStepId === s.id || selectedStepId === pId;

                  return (
                    <path
                      key={`${pId}->${s.id}`}
                      d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={highlighted ? '#C2592B' : 'rgba(138, 126, 115, 0.45)'}
                      strokeWidth={highlighted ? 2 : 1.25}
                      markerEnd={highlighted ? 'url(#dep-arrow-active)' : 'url(#dep-arrow)'}
                    />
                  );
                })
              )}
            </svg>

            {/* Target Dinner Line */}
            {dinnerX >= 0 && dinnerX <= trackWidth && (
              <div
                className="dinner-line"
                style={{ left: 185 + dinnerX }}
                title={`Target Dinner: ${formatTimeMin(targetDinnerMin)}`}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: 4,
                    background: 'var(--status-sage)',
                    color: '#fff',
                    fontSize: '0.64rem',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    whiteSpace: 'nowrap',
                  }}
                >
                  DINNER {formatTimeMin(targetDinnerMin)}
                </div>
              </div>
            )}

            {/* Live NOW Playhead */}
            {nowX >= 0 && nowX <= trackWidth && (
              <div className="playhead-line" style={{ left: 185 + nowX }}>
                <div className="playhead-tag">NOW</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
