import type { Appliance, MealStep, ScheduledStep, ScheduleResult } from './types';

interface Interval {
  stepId: string;
  start: number;
  end: number;
  slots: number;
  temp?: number;
  row: number;
}

/**
 * Checks whether placing a step with (slots, temp) at [start, end)
 * on `appliance` is valid given existing intervals, and returns an available laneRow.
 */
function findValidPlacement(
  start: number,
  end: number,
  slots: number,
  temp: number | undefined,
  appliance: Appliance,
  existing: Interval[]
): { valid: boolean; row: number } {
  if (slots > appliance.capacity) {
    // Even if misconfigured, allow at row 0 so scheduler never infinite-loops
    return { valid: existing.every((iv) => iv.end <= start || iv.start >= end), row: 0 };
  }

  // Collect overlapping intervals
  const overlapping = existing.filter((iv) => iv.start < end && iv.end > start);
  if (overlapping.length === 0) {
    return { valid: true, row: 0 };
  }

  // Check slot capacity at every critical boundary within [start, end)
  const checkpoints = new Set<number>([start]);
  for (const iv of overlapping) {
    if (iv.start > start && iv.start < end) checkpoints.add(iv.start);
  }

  for (const t of checkpoints) {
    let usedSlots = slots;
    const tempsAtT: number[] = temp !== undefined ? [temp] : [];

    for (const iv of overlapping) {
      if (iv.start <= t && iv.end > t) {
        usedSlots += iv.slots;
        if (iv.temp !== undefined) {
          tempsAtT.push(iv.temp);
        }
      }
    }

    if (usedSlots > appliance.capacity) {
      return { valid: false, row: 0 };
    }

    if (appliance.hasTemperature && tempsAtT.length > 1) {
      const minT = Math.min(...tempsAtT);
      const maxT = Math.max(...tempsAtT);
      if (maxT - minT > appliance.tempTolerance) {
        return { valid: false, row: 0 };
      }
    }
  }

  // Find lowest non-overlapping visual row
  const usedRows = new Set<number>();
  for (const iv of overlapping) {
    for (let r = iv.row; r < iv.row + iv.slots; r++) {
      usedRows.add(r);
    }
  }
  let row = 0;
  while (true) {
    let free = true;
    for (let r = row; r < row + slots; r++) {
      if (usedRows.has(r)) {
        free = false;
        break;
      }
    }
    if (free) break;
    row++;
    if (row > 50) break;
  }

  return { valid: true, row };
}

function getStepTargetEnd(step: MealStep, targetDinnerMin: number): { latestEnd: number; countsForDinner: boolean } {
  const fc = step.finishConstraint;
  if (fc) {
    switch (fc.mode) {
      case 'at_target':
        return { latestEnd: targetDinnerMin, countsForDinner: true };
      case 'before_target':
        return {
          latestEnd: targetDinnerMin - Math.max(0, fc.offsetMin ?? 0),
          countsForDinner: true,
        };
      case 'window':
        return {
          latestEnd: targetDinnerMin - Math.max(0, fc.windowMinBeforeMin ?? 30),
          countsForDinner: true,
        };
      case 'after_target':
        return { latestEnd: targetDinnerMin + 120, countsForDinner: false };
    }
  }
  return {
    latestEnd: step.mustFinishByDinner ? targetDinnerMin : targetDinnerMin + 120,
    countsForDinner: step.mustFinishByDinner,
  };
}

export function computeSchedule(
  rawSteps: MealStep[],
  appliances: Appliance[],
  targetDinnerMin: number,
  nowMin: number
): ScheduleResult {
  const applianceMap = new Map<string, Appliance>();
  for (const app of appliances) {
    applianceMap.set(app.id, app);
  }
  const fallbackAppliance: Appliance = appliances[0] ?? {
    id: 'counter',
    name: 'Prep / Counter',
    capacity: 99,
    slotLabel: 'spot',
    hasTemperature: false,
    tempTolerance: 0,
    color: '#6B7280',
  };

  const stepMap = new Map<string, MealStep>();
  for (const s of rawSteps) {
    stepMap.set(s.id, s);
  }

  // 1. Build unified DAG: prereqs[id] -> Set of step IDs that must finish before id
  const prereqs = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  for (const s of rawSteps) {
    prereqs.set(s.id, new Set());
    dependents.set(s.id, new Set());
  }

  for (const s of rawSteps) {
    for (const depId of s.dependencies) {
      if (stepMap.has(depId) && depId !== s.id) {
        prereqs.get(s.id)!.add(depId);
        dependents.get(depId)!.add(s.id);
      }
    }
    for (const afterId of s.readyBeforeIds) {
      if (stepMap.has(afterId) && afterId !== s.id) {
        prereqs.get(afterId)!.add(s.id);
        dependents.get(s.id)!.add(afterId);
      }
    }
  }

  // 2. Topological Sort (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  for (const s of rawSteps) {
    inDegree.set(s.id, prereqs.get(s.id)!.size);
  }

  const queue: string[] = [];
  for (const s of rawSteps) {
    if ((inDegree.get(s.id) ?? 0) === 0) queue.push(s.id);
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    topoOrder.push(curr);
    for (const next of dependents.get(curr) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  if (topoOrder.length !== rawSteps.length) {
    return {
      steps: rawSteps.map((s) => ({
        ...s,
        startMin: targetDinnerMin - s.durationMin,
        endMin: targetDinnerMin,
        laneRow: 0,
        slackMin: 0,
        isCritical: false,
        effectivePrereqs: Array.from(prereqs.get(s.id) ?? []),
        effectiveDependents: Array.from(dependents.get(s.id) ?? []),
        isDelayed: false,
        delayMin: 0,
      })),
      projectedDinnerMin: targetDinnerMin,
      targetDinnerMin,
      dinnerDeltaMin: 0,
      earliestStartMin: targetDinnerMin,
      cycleError: 'Circular dependency detected! Check "Depends On" and "Ready Before" links.',
    };
  }

  // 3. Backward Resource-Constrained Pass (Ideal Plan anchored to targetDinnerMin & finishConstraint)
  const idealIntervalsByApp = new Map<string, Interval[]>();
  for (const app of appliances) idealIntervalsByApp.set(app.id, []);

  const idealStart = new Map<string, number>();
  const idealEnd = new Map<string, number>();

  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const step = stepMap.get(id)!;
    const app = applianceMap.get(step.applianceId) ?? fallbackAppliance;
    const duration = Math.max(1, step.durationMin);

    // Latest end is min(finishConstraint/targetDinnerMin, min(idealStart of dependents))
    let { latestEnd } = getStepTargetEnd(step, targetDinnerMin);
    for (const depId of dependents.get(id) ?? []) {
      const depStart = idealStart.get(depId);
      if (depStart !== undefined && depStart < latestEnd) {
        latestEnd = depStart;
      }
    }

    const appIntervals = idealIntervalsByApp.get(app.id) ?? [];
    if (!idealIntervalsByApp.has(app.id)) idealIntervalsByApp.set(app.id, appIntervals);

    // Candidate end times: latestEnd, plus iv.start for any existing interval <= latestEnd
    const candidates = new Set<number>([latestEnd]);
    for (const iv of appIntervals) {
      if (iv.start <= latestEnd) {
        candidates.add(iv.start);
      }
    }
    const sortedCandidates = Array.from(candidates).sort((a, b) => b - a);

    let chosenEnd = latestEnd;
    let chosenRow = 0;
    for (const candEnd of sortedCandidates) {
      const candStart = candEnd - duration;
      const check = findValidPlacement(
        candStart,
        candEnd,
        step.slotsRequired,
        step.temperature,
        app,
        appIntervals
      );
      if (check.valid) {
        chosenEnd = candEnd;
        chosenRow = check.row;
        break;
      }
    }

    const chosenStart = chosenEnd - duration;
    idealStart.set(id, chosenStart);
    idealEnd.set(id, chosenEnd);
    appIntervals.push({
      stepId: id,
      start: chosenStart,
      end: chosenEnd,
      slots: step.slotsRequired,
      temp: step.temperature,
      row: chosenRow,
    });
  }

  // 4. Forward Live-Cascade Pass
  const liveIntervalsByApp = new Map<string, Interval[]>();
  for (const app of appliances) liveIntervalsByApp.set(app.id, []);

  const liveStart = new Map<string, number>();
  const liveEnd = new Map<string, number>();
  const liveRow = new Map<string, number>();

  // First, pin 'done', 'running', and 'paused' steps so their real-time occupancy is respected
  for (const id of topoOrder) {
    const step = stepMap.get(id)!;
    const app = applianceMap.get(step.applianceId) ?? fallbackAppliance;
    const appIntervals = liveIntervalsByApp.get(app.id) ?? [];
    if (!liveIntervalsByApp.has(app.id)) liveIntervalsByApp.set(app.id, appIntervals);

    if (step.status === 'done') {
      const s = step.actualStartMin ?? idealStart.get(id)!;
      const e = step.actualEndMin ?? s + Math.max(1, step.durationMin);
      const check = findValidPlacement(s, e, step.slotsRequired, step.temperature, app, appIntervals);
      liveStart.set(id, s);
      liveEnd.set(id, e);
      liveRow.set(id, check.row);
      appIntervals.push({
        stepId: id,
        start: s,
        end: e,
        slots: step.slotsRequired,
        temp: step.temperature,
        row: check.row,
      });
    } else if (step.status === 'running' || step.status === 'paused') {
      const s = step.actualStartMin ?? nowMin;
      const remMin = Math.max(1, Math.ceil(step.remainingSec / 60));
      const e = Math.max(s + 1, nowMin + remMin);
      const check = findValidPlacement(s, e, step.slotsRequired, step.temperature, app, appIntervals);
      liveStart.set(id, s);
      liveEnd.set(id, e);
      liveRow.set(id, check.row);
      appIntervals.push({
        stepId: id,
        start: s,
        end: e,
        slots: step.slotsRequired,
        temp: step.temperature,
        row: check.row,
      });
    }
  }

  // Next, schedule all 'pending' steps in topological order
  for (const id of topoOrder) {
    const step = stepMap.get(id)!;
    if (step.status !== 'pending') continue;

    const app = applianceMap.get(step.applianceId) ?? fallbackAppliance;
    const appIntervals = liveIntervalsByApp.get(app.id) ?? [];
    if (!liveIntervalsByApp.has(app.id)) liveIntervalsByApp.set(app.id, appIntervals);

    const duration = Math.max(1, step.durationMin + (step.addedMin || 0));

    // Earliest feasible start = max(idealStart, nowMin, max(liveEnd of prereqs))
    let earliest = Math.max(idealStart.get(id)!, nowMin);
    for (const pId of prereqs.get(id) ?? []) {
      const pEnd = liveEnd.get(pId);
      if (pEnd !== undefined && pEnd > earliest) {
        earliest = pEnd;
      }
    }

    const candidates = new Set<number>([earliest]);
    for (const iv of appIntervals) {
      if (iv.end >= earliest) {
        candidates.add(iv.end);
      }
    }
    const sortedCandidates = Array.from(candidates).sort((a, b) => a - b);

    let chosenStart = earliest;
    let chosenRow = 0;
    for (const candStart of sortedCandidates) {
      const candEnd = candStart + duration;
      const check = findValidPlacement(
        candStart,
        candEnd,
        step.slotsRequired,
        step.temperature,
        app,
        appIntervals
      );
      if (check.valid) {
        chosenStart = candStart;
        chosenRow = check.row;
        break;
      }
    }

    const chosenEnd = chosenStart + duration;
    liveStart.set(id, chosenStart);
    liveEnd.set(id, chosenEnd);
    liveRow.set(id, chosenRow);
    appIntervals.push({
      stepId: id,
      start: chosenStart,
      end: chosenEnd,
      slots: step.slotsRequired,
      temp: step.temperature,
      row: chosenRow,
    });
  }

  // 5. Compute projected dinner, earliest start, and slack
  let projectedDinnerMin = targetDinnerMin;
  let hasDinnerStep = false;
  let earliestStartMin = Infinity;

  for (const s of rawSteps) {
    const st = liveStart.get(s.id)!;
    const en = liveEnd.get(s.id)!;
    if (st < earliestStartMin) earliestStartMin = st;
    const { countsForDinner } = getStepTargetEnd(s, targetDinnerMin);
    if (countsForDinner) {
      if (!hasDinnerStep || en > projectedDinnerMin) {
        projectedDinnerMin = en;
        hasDinnerStep = true;
      }
    }
  }
  if (earliestStartMin === Infinity) earliestStartMin = targetDinnerMin - 60;
  if (!hasDinnerStep) projectedDinnerMin = targetDinnerMin;

  const scheduledSteps: ScheduledStep[] = rawSteps.map((s) => {
    const startMin = liveStart.get(s.id)!;
    const endMin = liveEnd.get(s.id)!;
    const iStart = idealStart.get(s.id)!;
    const { latestEnd, countsForDinner } = getStepTargetEnd(s, targetDinnerMin);

    let minDependentStart = countsForDinner
      ? Math.max(latestEnd, projectedDinnerMin - (targetDinnerMin - latestEnd))
      : Infinity;
    for (const depId of dependents.get(s.id) ?? []) {
      const ds = liveStart.get(depId)!;
      if (ds < minDependentStart) minDependentStart = ds;
    }
    const slackMin = minDependentStart === Infinity ? 0 : Math.max(0, minDependentStart - endMin);
    const delayMin = Math.max(0, startMin - iStart);
    const isCritical =
      slackMin === 0 &&
      (endMin >= projectedDinnerMin ||
        Array.from(dependents.get(s.id) ?? []).some((dId) => (liveStart.get(dId) ?? 0) === endMin));

    return {
      ...s,
      startMin,
      endMin,
      laneRow: liveRow.get(s.id) ?? 0,
      slackMin,
      isCritical,
      effectivePrereqs: Array.from(prereqs.get(s.id) ?? []),
      effectiveDependents: Array.from(dependents.get(s.id) ?? []),
      isDelayed: delayMin > 0,
      delayMin,
    };
  });

  return {
    steps: scheduledSteps,
    projectedDinnerMin,
    targetDinnerMin,
    dinnerDeltaMin: projectedDinnerMin - targetDinnerMin,
    earliestStartMin,
    cycleError: null,
  };
}

export function formatTimeMin(totalMin: number): string {
  const normalized = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  const h24 = Math.floor(normalized / 60);
  const m = normalized % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

export function formatDuration(min: number): string {
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatCountdownSec(sec: number): string {
  const neg = sec < 0;
  const abs = Math.abs(Math.floor(sec));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const prefix = neg ? '+' : '';
  if (h > 0) {
    return `${prefix}${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${prefix}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
