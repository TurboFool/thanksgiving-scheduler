import React, { useMemo, useState } from 'react';
import { Flame, ZoomIn, ZoomOut, Clock, Play } from 'lucide-react';
import type { Appliance, ScheduledStep } from '../types';
import { formatDuration, formatTimeMin } from '../scheduler';

interface GanttTimelineProps {
  appliances: Appliance[];
  steps: ScheduledStep[];
  earliestStartMin: number;
  projectedDinnerMin: number;
  targetDinnerMin: number;
  nowMin: number;
  selectedStepId: string | null;
  onSelectStep: (step: ScheduledStep) => void;
  onStartStep: (id: string) => void;
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
  onSelectStep,
  onStartStep,
}) => {
  const [pxPerMin, setPxPerMin] = useState(4.6);

  // Timeline bounds: pad 30m before earliest/now and 30m after projected/target dinner
  const startBound = useMemo(() => {
    const raw = Math.min(earliestStartMin, nowMin) - 20;
    return Math.floor(raw / 30) * 30;
  }, [earliestStartMin, nowMin]);

  const endBound = useMemo(() => {
    const raw = Math.max(projectedDinnerMin, targetDinnerMin, nowMin + 30) + 30;
    return Math.ceil(raw / 30) * 30;
  }, [projectedDinnerMin, targetDinnerMin, nowMin]);

  const totalMin = Math.max(60, endBound - startBound);
  const trackWidth = Math.max(700, totalMin * pxPerMin);

  // Tick marks every 30 min (or 60 min when zoomed out)
  const tickStep = pxPerMin < 2.2 ? 60 : 30;
  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (let t = startBound; t <= endBound; t += tickStep) {
      arr.push(t);
    }
    return arr;
  }, [startBound, endBound, tickStep]);

  // Compute lane heights and step Y positions for SVG dependency arrows
  const laneLayout = useMemo(() => {
    let yCursor = 0;
    const laneMeta = new Map<string, { top: number; height: number; rows: number }>();
    const stepRects = new Map<string, { x: number; y: number; w: number; h: number }>();

    for (const app of appliances) {
      const appSteps = steps.filter((s) => s.applianceId === app.id);
      let maxRowUsed = 1;
      for (const s of appSteps) {
        maxRowUsed = Math.max(maxRowUsed, s.laneRow + Math.max(1, s.slotsRequired));
      }
      const rows = Math.max(1, Math.min(app.capacity, maxRowUsed));
      const height = rows * ROW_HEIGHT + LANE_PAD_Y * 2;
      laneMeta.set(app.id, { top: yCursor, height, rows });

      for (const s of appSteps) {
        const x = (s.startMin - startBound) * pxPerMin;
        const w = Math.max(32, (s.endMin - s.startMin) * pxPerMin);
        const slotSpan = Math.min(rows - s.laneRow, Math.max(1, s.slotsRequired));
        const y = yCursor + LANE_PAD_Y + s.laneRow * ROW_HEIGHT + 3;
        const h = slotSpan * ROW_HEIGHT - 6;
        stepRects.set(s.id, { x, y, w, h });
      }
      yCursor += height;
    }

    return { laneMeta, stepRects, totalHeight: yCursor };
  }, [appliances, steps, startBound, pxPerMin]);

  const nowX = (nowMin - startBound) * pxPerMin;
  const dinnerX = (targetDinnerMin - startBound) * pxPerMin;

  return (
    <section className="timeline-panel">
      <div className="timeline-toolbar">
        <div className="panel-title">
          <Clock size={15} /> Appliance Timeline &amp; Dependencies
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
            Click any block to edit dependencies, racks, or temp
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setPxPerMin((p) => Math.max(1.5, p - 0.8))}
              title="Zoom out"
            >
              <ZoomOut size={15} />
            </button>
            <button
              type="button"
              className="btn-icon"
              onClick={() => setPxPerMin((p) => Math.min(12, p + 0.8))}
              title="Zoom in"
            >
              <ZoomIn size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="timeline-scroll">
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
            {appliances.map((app) => {
              const meta = laneLayout.laneMeta.get(app.id)!;
              const appSteps = steps.filter((s) => s.applianceId === app.id);

              return (
                <div key={app.id} className="gantt-lane" style={{ height: meta.height }}>
                  <div className="gantt-lane-label">
                    <div className="lane-name">
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

                      return (
                        <div
                          key={s.id}
                          className={`gantt-task ${statusClass} ${isSelected ? 'selected' : ''}`}
                          style={{
                            left: rect.x,
                            top: rect.y - meta.top,
                            width: rect.w,
                            height: rect.h,
                            borderLeftWidth: 4,
                            borderLeftColor: app.color,
                          }}
                          onClick={() => onSelectStep(s)}
                          title={`${s.title} (${formatTimeMin(s.startMin)} – ${formatTimeMin(s.endMin)})`}
                        >
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
