import type { Appliance, MealStep, ScheduledStep, ScheduleResult, TempTransition } from './types';

interface Interval {
  stepId: string;
  start: number;
  end: number;
  slots: number;
  temp?: number;
  mode?: string;
  stepKind?: 'cooking' | 'preheat';
  row: number;
}

export function getInitialPreheatDurationMin(targetTemp: number, appliance: Appliance): number {
  if (appliance.preheatBufferMin !== undefined && appliance.preheatBufferMin > 0) {
    return appliance.preheatBufferMin;
  }
  return Math.min(20, Math.max(10, Math.ceil(Math.max(0, targetTemp - 70) / 80) * 5));
}

export function getRequiredTempTransition(
  fromTemp: number | undefined,
  toTemp: number | undefined,
  appliance: Appliance
): { type: 'preheat' | 'cooldown'; durationMin: number } | null {
  if (!appliance.hasTemperature || fromTemp === undefined || toTemp === undefined) {
    return null;
  }
  const diff = toTemp - fromTemp;
  if (Math.abs(diff) <= appliance.tempTolerance) {
    return null;
  }
  if (diff > 0) {
    const durationMin =
      appliance.preheatBufferMin !== undefined && appliance.preheatBufferMin >= 0
        ? appliance.preheatBufferMin
        : Math.min(20, Math.max(5, Math.ceil(diff / 50) * 5));
    return durationMin > 0 ? { type: 'preheat', durationMin } : null;
  }
  const absDiff = Math.abs(diff);
  const durationMin =
    appliance.cooldownBufferMin !== undefined && appliance.cooldownBufferMin >= 0
      ? appliance.cooldownBufferMin
      : Math.min(30, Math.max(5, Math.ceil(absDiff / 25) * 5));
  return durationMin > 0 ? { type: 'cooldown', durationMin } : null;
}

/**
 * Checks whether placing a step with (slots, temp, mode) at [start, end)
 * on `appliance` is valid given existing intervals, and returns an available laneRow.
 */
function findValidPlacement(
  start: number,
  end: number,
  slots: number,
  temp: number | undefined,
  appliance: Appliance,
  existing: Interval[],
  sharedAnchorStepIds?: Set<string>,
  stepMode?: string,
  stepKind?: 'cooking' | 'preheat'
): { valid: boolean; row: number } {
  if (slots > appliance.capacity) {
    // Even if misconfigured, allow at row 0 so scheduler never infinite-loops
    return { valid: existing.every((iv) => iv.end <= start || iv.start >= end), row: 0 };
  }

  // Enforce preheat/cooldown transition gaps between sequential uses when temperature changes > tolerance
  // (Skip when either step is already an explicit preheat step)
  if (appliance.hasTemperature && temp !== undefined && stepKind !== 'preheat') {
    for (const iv of existing) {
      if (iv.temp === undefined || iv.stepKind === 'preheat') continue;
      if (iv.end <= start) {
        const trans = getRequiredTempTransition(iv.temp, temp, appliance);
        if (trans && start - iv.end < trans.durationMin) {
          return { valid: false, row: 0 };
        }
      } else if (iv.start >= end) {
        const trans = getRequiredTempTransition(temp, iv.temp, appliance);
        if (trans && iv.start - end < trans.durationMin) {
          return { valid: false, row: 0 };
        }
      }
    }
  }

  // Collect overlapping intervals
  const overlapping = existing.filter((iv) => iv.start < end && iv.end > start);
  if (overlapping.length === 0) {
    return { valid: true, row: 0 };
  }

  // Check slot capacity, temperature tolerance, and mode exclusivity at every boundary
  const checkpoints = new Set<number>([start]);
  for (const iv of overlapping) {
    if (iv.start > start && iv.start < end) checkpoints.add(iv.start);
  }

  const normStepMode = (stepMode || '').trim().toLowerCase();

  for (const t of checkpoints) {
    let sharesAnchorAtT = false;
    let usedSlots = 0;
    const tempsAtT: number[] = temp !== undefined ? [temp] : [];

    for (const iv of overlapping) {
      if (iv.start <= t && iv.end > t) {
        const ivMode = (iv.mode || '').trim().toLowerCase();
        if (normStepMode !== ivMode && !sharedAnchorStepIds?.has(iv.stepId)) {
          return { valid: false, row: 0 };
        }
        usedSlots += iv.slots;
        if (sharedAnchorStepIds?.has(iv.stepId)) {
          sharesAnchorAtT = true;
        }
        if (iv.temp !== undefined) {
          tempsAtT.push(iv.temp);
        }
      }
    }

    if (!sharesAnchorAtT) {
      usedSlots += slots;
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
    const visualSlots = Math.max(1, iv.slots);
    for (let r = iv.row; r < iv.row + visualSlots; r++) {
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
  rawNowMin?: number
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

  // 1. Build unified DAG:
  //    - prereqs[id] / dependents[id]: finish-to-start links
  //    - allPrereqs[id] / allDependents[id]: finish-to-start + relativeDeps (for topo order & arrows)
  const prereqs = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const allPrereqs = new Map<string, Set<string>>();
  const allDependents = new Map<string, Set<string>>();
  for (const s of rawSteps) {
    prereqs.set(s.id, new Set());
    dependents.set(s.id, new Set());
    allPrereqs.set(s.id, new Set());
    allDependents.set(s.id, new Set());
  }

  for (const s of rawSteps) {
    for (const depId of s.dependencies) {
      if (stepMap.has(depId) && depId !== s.id) {
        prereqs.get(s.id)!.add(depId);
        dependents.get(depId)!.add(s.id);
        allPrereqs.get(s.id)!.add(depId);
        allDependents.get(depId)!.add(s.id);
      }
    }
    for (const afterId of s.readyBeforeIds) {
      if (stepMap.has(afterId) && afterId !== s.id) {
        prereqs.get(afterId)!.add(s.id);
        dependents.get(s.id)!.add(afterId);
        allPrereqs.get(afterId)!.add(s.id);
        allDependents.get(s.id)!.add(afterId);
      }
    }
    for (const rel of s.relativeDeps ?? []) {
      if (stepMap.has(rel.stepId) && rel.stepId !== s.id) {
        allPrereqs.get(s.id)!.add(rel.stepId);
        allDependents.get(rel.stepId)!.add(s.id);
      }
    }
  }

  // 2. Topological Sort (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  for (const s of rawSteps) {
    inDegree.set(s.id, allPrereqs.get(s.id)!.size);
  }

  const queue: string[] = [];
  for (const s of rawSteps) {
    if ((inDegree.get(s.id) ?? 0) === 0) queue.push(s.id);
  }

  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    topoOrder.push(curr);
    for (const next of allDependents.get(curr) ?? []) {
      const deg = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  if (topoOrder.length !== rawSteps.length) {
    return {
      steps: rawSteps.map((s) => ({
        ...s,
        resolvedApplianceId: s.applianceId.startsWith('category:')
          ? fallbackAppliance.id
          : s.applianceId,
        startMin: targetDinnerMin - s.durationMin,
        endMin: targetDinnerMin,
        laneRow: 0,
        slackMin: 0,
        isCritical: false,
        effectivePrereqs: Array.from(allPrereqs.get(s.id) ?? []),
        effectiveDependents: Array.from(allDependents.get(s.id) ?? []),
        isDelayed: false,
        delayMin: 0,
      })),
      projectedDinnerMin: targetDinnerMin,
      targetDinnerMin,
      dinnerDeltaMin: 0,
      earliestStartMin: targetDinnerMin,
      suggestedStartMin: targetDinnerMin,
      cycleError: 'Circular dependency detected! Check "Depends On" and "Ready Before" links.',
    };
  }

  const applianceSupportsMode = (app: Appliance, mode: string): boolean => {
    const norm = mode.trim().toLowerCase();
    if (!norm) return true;
    return (app.supportedModes ?? []).some((m) => m.trim().toLowerCase() === norm);
  };

  const getCandidateAppliances = (
    specId: string,
    stepMode?: string,
    modePreference: 'required' | 'preferred' = 'preferred'
  ): Appliance[] => {
    if (!specId) return [];
    const normMode = (stepMode || '').trim();
    if (specId.startsWith('category:')) {
      const cat = specId.slice('category:'.length).trim().toLowerCase();
      const matches = appliances.filter(
        (a) => (a.category || '').trim().toLowerCase() === cat
      );
      if (matches.length === 0) return [fallbackAppliance];
      if (!normMode) return matches;
      const modeMatches = matches.filter((a) => applianceSupportsMode(a, normMode));
      if (modePreference === 'required') {
        return modeMatches.length > 0 ? modeMatches : matches;
      }
      // Preferred: try mode-matching appliances first, fall back to others if needed
      return [...modeMatches, ...matches.filter((a) => !applianceSupportsMode(a, normMode))];
    }
    const specific = applianceMap.get(specId) ?? fallbackAppliance;
    if (normMode && modePreference === 'preferred' && !applianceSupportsMode(specific, normMode)) {
      const sameCat = appliances.filter(
        (a) =>
          a.id !== specific.id &&
          (a.category || '').trim().toLowerCase() === (specific.category || '').trim().toLowerCase() &&
          applianceSupportsMode(a, normMode)
      );
      if (sameCat.length > 0) return [...sameCat, specific];
    }
    return [specific];
  };

  // 3. Backward Resource-Constrained Pass (Ideal Plan anchored to targetDinnerMin & finishConstraint)
  const idealIntervalsByApp = new Map<string, Interval[]>();
  for (const app of appliances) idealIntervalsByApp.set(app.id, []);

  const idealStart = new Map<string, number>();
  const idealEnd = new Map<string, number>();
  const idealApp = new Map<string, string>();

  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const step = stepMap.get(id)!;
    const duration = Math.max(1, step.durationMin);

    let { latestEnd } = getStepTargetEnd(step, targetDinnerMin);
    if (step.pinnedStartMin !== undefined) {
      latestEnd = step.pinnedStartMin + duration;
    }
    for (const depId of dependents.get(id) ?? []) {
      const depStart = idealStart.get(depId);
      if (depStart !== undefined && depStart < latestEnd) {
        latestEnd = depStart;
      }
    }

    const candidatesApps = getCandidateAppliances(
      step.applianceId,
      step.applianceMode,
      step.modePreference
    );
    if (candidatesApps.length === 0) {
      idealStart.set(id, latestEnd - duration);
      idealEnd.set(id, latestEnd);
      idealApp.set(id, '');
      continue;
    }

    let bestMatchEnd = -Infinity;
    let bestMatchRow = 0;
    let bestMatchApp: Appliance | null = null;
    let bestMatchMode: string | undefined = step.applianceMode;

    let bestAnyEnd = -Infinity;
    let bestAnyRow = 0;
    let bestAnyApp = candidatesApps[0];
    let bestAnyMode: string | undefined = step.applianceMode;

    const normReqMode = (step.applianceMode || '').trim();
    const isPreferredMode = Boolean(normReqMode) && (step.modePreference ?? 'preferred') === 'preferred';

    for (const app of candidatesApps) {
      const appIntervals = idealIntervalsByApp.get(app.id) ?? [];
      if (!idealIntervalsByApp.has(app.id)) idealIntervalsByApp.set(app.id, appIntervals);

      const supportsReq = !normReqMode || applianceSupportsMode(app, normReqMode);
      const tryMode = supportsReq
        ? step.applianceMode
        : isPreferredMode
        ? app.supportedModes?.[0]
        : step.applianceMode;

      const candidates = new Set<number>([latestEnd]);
      for (const iv of appIntervals) {
        if (iv.start <= latestEnd) {
          candidates.add(iv.start);
          const trans = getRequiredTempTransition(step.temperature, iv.temp, app);
          if (trans && iv.start - trans.durationMin <= latestEnd) {
            candidates.add(iv.start - trans.durationMin);
          }
        }
      }
      const sortedCandidates = Array.from(candidates).sort((a, b) => b - a);

      for (const candEnd of sortedCandidates) {
        const candStart = candEnd - duration;
        const check = findValidPlacement(
          candStart,
          candEnd,
          step.slotsRequired,
          step.temperature,
          app,
          appIntervals,
          undefined,
          tryMode,
          step.stepKind
        );
        if (check.valid) {
          if (supportsReq && candEnd > bestMatchEnd) {
            bestMatchEnd = candEnd;
            bestMatchRow = check.row;
            bestMatchApp = app;
            bestMatchMode = tryMode;
          }
          if (candEnd > bestAnyEnd) {
            bestAnyEnd = candEnd;
            bestAnyRow = check.row;
            bestAnyApp = app;
            bestAnyMode = tryMode;
          }
          break;
        }
      }
    }

    const useMatch = bestMatchApp !== null && bestMatchEnd > -Infinity;
    const chosenEnd = useMatch ? bestMatchEnd : bestAnyEnd === -Infinity ? latestEnd : bestAnyEnd;
    const chosenStart = chosenEnd - duration;
    const chosenApp = useMatch ? bestMatchApp! : bestAnyApp;
    const chosenRow = useMatch ? bestMatchRow : bestAnyRow;
    const chosenMode = useMatch ? bestMatchMode : bestAnyMode;

    idealStart.set(id, chosenStart);
    idealEnd.set(id, chosenEnd);
    idealApp.set(id, chosenApp.id);
    const targetIntervals = idealIntervalsByApp.get(chosenApp.id) ?? [];
    targetIntervals.push({
      stepId: id,
      start: chosenStart,
      end: chosenEnd,
      slots: step.slotsRequired,
      temp: step.temperature,
      mode: chosenMode,
      stepKind: step.stepKind,
      row: chosenRow,
    });
    idealIntervalsByApp.set(chosenApp.id, targetIntervals);
  }

  // Resolve time-relative concurrent dependencies in forward topo order for ideal plan
  for (const id of topoOrder) {
    const step = stepMap.get(id)!;
    if (step.pinnedStartMin !== undefined || !step.relativeDeps?.length) continue;
    const duration = Math.max(1, step.durationMin);
    let relStart = -Infinity;
    for (const rel of step.relativeDeps) {
      const tStart = idealStart.get(rel.stepId);
      const tEnd = idealEnd.get(rel.stepId);
      if (tStart === undefined || tEnd === undefined) continue;
      const offset = Math.max(0, rel.offsetMin);
      const cand =
        rel.anchor === 'before_end'
          ? tEnd - offset
          : rel.anchor === 'after_start'
          ? tStart + offset
          : tEnd + offset;
      if (cand > relStart) relStart = cand;
    }
    if (relStart > -Infinity) {
      idealStart.set(id, relStart);
      idealEnd.set(id, relStart + duration);
    }
  }

  // Pull any finish-to-start prerequisites earlier if a relativeDeps step now starts earlier
  for (let i = topoOrder.length - 1; i >= 0; i--) {
    const id = topoOrder[i];
    const step = stepMap.get(id)!;
    if (step.pinnedStartMin !== undefined) continue;
    const myEnd = idealEnd.get(id);
    if (myEnd === undefined) continue;
    let maxAllowedEnd = myEnd;
    for (const depId of dependents.get(id) ?? []) {
      const depStart = idealStart.get(depId);
      if (depStart !== undefined && depStart < maxAllowedEnd) {
        maxAllowedEnd = depStart;
      }
    }
    if (maxAllowedEnd < myEnd) {
      const duration = Math.max(1, step.durationMin);
      idealEnd.set(id, maxAllowedEnd);
      idealStart.set(id, maxAllowedEnd - duration);
    }
  }

  let suggestedStartMin = Infinity;
  for (const st of idealStart.values()) {
    if (st < suggestedStartMin) suggestedStartMin = st;
  }
  if (suggestedStartMin === Infinity) suggestedStartMin = targetDinnerMin - 60;
  const nowMin = rawNowMin !== undefined ? rawNowMin : suggestedStartMin;

  // 4. Forward Live-Cascade Pass
  const liveIntervalsByApp = new Map<string, Interval[]>();
  for (const app of appliances) liveIntervalsByApp.set(app.id, []);

  const liveStart = new Map<string, number>();
  const liveEnd = new Map<string, number>();
  const liveRow = new Map<string, number>();
  const liveApp = new Map<string, string>();
  const liveEffectiveMode = new Map<string, string | undefined>();
  const liveModeNote = new Map<string, string | undefined>();

  // First, pin 'done', 'running', and 'paused' steps so their real-time occupancy is respected
  for (const id of topoOrder) {
    const step = stepMap.get(id)!;
    if (step.status !== 'done' && step.status !== 'running' && step.status !== 'paused') continue;

    const resolvedId = idealApp.get(id) ?? '';
    if (!resolvedId) {
      const s =
        step.status === 'done'
          ? step.actualStartMin ?? idealStart.get(id)!
          : step.actualStartMin ?? nowMin;
      const e =
        step.status === 'done'
          ? step.actualEndMin ?? s + Math.max(1, step.durationMin)
          : Math.max(s + 1, nowMin + Math.max(1, Math.ceil(step.remainingSec / 60)));
      liveStart.set(id, s);
      liveEnd.set(id, e);
      liveRow.set(id, 0);
      liveApp.set(id, '');
      continue;
    }

    const app = applianceMap.get(resolvedId) ?? fallbackAppliance;
    const appIntervals = liveIntervalsByApp.get(app.id) ?? [];
    if (!liveIntervalsByApp.has(app.id)) liveIntervalsByApp.set(app.id, appIntervals);

    if (step.status === 'done') {
      const s = step.actualStartMin ?? idealStart.get(id)!;
      const e = step.actualEndMin ?? s + Math.max(1, step.durationMin);
      const check = findValidPlacement(
        s,
        e,
        step.slotsRequired,
        step.temperature,
        app,
        appIntervals,
        undefined,
        step.applianceMode
      );
      liveStart.set(id, s);
      liveEnd.set(id, e);
      liveRow.set(id, check.row);
      liveApp.set(id, app.id);
      const effDoneMode =
        step.applianceMode && !applianceSupportsMode(app, step.applianceMode)
          ? app.supportedModes?.[0]
          : step.applianceMode;
      liveEffectiveMode.set(id, effDoneMode);
      if (step.applianceMode && !applianceSupportsMode(app, step.applianceMode)) {
        liveModeNote.set(
          id,
          `${app.name} does not support ${step.applianceMode}; using ${effDoneMode || 'default'}`
        );
      }
      appIntervals.push({
        stepId: id,
        start: s,
        end: e,
        slots: step.slotsRequired,
        temp: step.temperature,
        mode: effDoneMode,
        row: check.row,
      });
    } else {
      const s = step.actualStartMin ?? nowMin;
      const plannedDur = Math.max(1, step.durationMin + (step.addedMin || 0));
      const remMin = Math.max(1, Math.ceil(step.remainingSec / 60));
      const e =
        step.requiresTimer === false
          ? Math.max(s + plannedDur, nowMin + 1)
          : Math.max(s + 1, nowMin + remMin);
      const effRunMode =
        step.applianceMode && !applianceSupportsMode(app, step.applianceMode)
          ? app.supportedModes?.[0]
          : step.applianceMode;
      const check = findValidPlacement(
        s,
        e,
        step.slotsRequired,
        step.temperature,
        app,
        appIntervals,
        undefined,
        effRunMode
      );
      liveStart.set(id, s);
      liveEnd.set(id, e);
      liveRow.set(id, check.row);
      liveApp.set(id, app.id);
      liveEffectiveMode.set(id, effRunMode);
      if (step.applianceMode && !applianceSupportsMode(app, step.applianceMode)) {
        liveModeNote.set(
          id,
          `${app.name} does not support ${step.applianceMode}; using ${effRunMode || 'default'}`
        );
      }
      appIntervals.push({
        stepId: id,
        start: s,
        end: e,
        slots: step.slotsRequired,
        temp: step.temperature,
        mode: effRunMode,
        row: check.row,
      });
    }
  }

  // Next, schedule all 'pending' steps in topological order
  for (const id of topoOrder) {
    const step = stepMap.get(id)!;
    if (step.status !== 'pending') continue;

    const duration = Math.max(1, step.durationMin + (step.addedMin || 0));

    let earliest =
      step.pinnedStartMin !== undefined
        ? Math.max(step.pinnedStartMin, nowMin)
        : step.relativeDeps?.length
        ? nowMin
        : Math.max(idealStart.get(id)!, nowMin);
    for (const pId of prereqs.get(id) ?? []) {
      const pEnd = liveEnd.get(pId);
      if (pEnd !== undefined && pEnd > earliest) {
        earliest = pEnd;
      }
    }
    if (step.pinnedStartMin === undefined) {
      for (const rel of step.relativeDeps ?? []) {
        const tStart = liveStart.get(rel.stepId);
        const tEnd = liveEnd.get(rel.stepId);
        if (tStart === undefined || tEnd === undefined) continue;
        const offset = Math.max(0, rel.offsetMin);
        const cand =
          rel.anchor === 'before_end'
            ? tEnd - offset
            : rel.anchor === 'after_start'
            ? tStart + offset
            : tEnd + offset;
        if (cand > earliest) {
          earliest = cand;
        }
      }
    }

    const candidatesApps = getCandidateAppliances(
      step.applianceId,
      step.applianceMode,
      step.modePreference
    );
    if (candidatesApps.length === 0) {
      liveStart.set(id, earliest);
      liveEnd.set(id, earliest + duration);
      liveRow.set(id, 0);
      liveApp.set(id, '');
      continue;
    }

    const stepTargetEnd = getStepTargetEnd(step, targetDinnerMin).latestEnd;
    const normReqMode = (step.applianceMode || '').trim();
    const isPreferredMode = Boolean(normReqMode) && (step.modePreference ?? 'preferred') === 'preferred';

    type PlacementCand = { start: number; row: number; app: Appliance; mode: string | undefined };
    let bestExact: PlacementCand | null = null;
    let bestAny: PlacementCand | null = null;

    const sharedAnchors = step.relativeDeps?.length
      ? new Set(step.relativeDeps.map((r) => r.stepId))
      : undefined;

    for (const app of candidatesApps) {
      const appIntervals = liveIntervalsByApp.get(app.id) ?? [];
      if (!liveIntervalsByApp.has(app.id)) liveIntervalsByApp.set(app.id, appIntervals);

      const candidates = new Set<number>([earliest]);
      for (const iv of appIntervals) {
        if (iv.end >= earliest) {
          candidates.add(iv.end);
          const trans = getRequiredTempTransition(iv.temp, step.temperature, app);
          if (trans && iv.end + trans.durationMin >= earliest) {
            candidates.add(iv.end + trans.durationMin);
          }
        }
      }
      const sortedCandidates = Array.from(candidates).sort((a, b) => a - b);

      const supportsReq = !normReqMode || applianceSupportsMode(app, normReqMode);
      const modesToTry: Array<string | undefined> = [];
      if (supportsReq) {
        modesToTry.push(step.applianceMode);
        if (isPreferredMode && app.supportedModes?.length) {
          const fallbackM = app.supportedModes.find(
            (m) => m.trim().toLowerCase() !== normReqMode.toLowerCase()
          );
          if (fallbackM) modesToTry.push(fallbackM);
        }
      } else {
        modesToTry.push(isPreferredMode ? app.supportedModes?.[0] : step.applianceMode);
      }

      for (const tryMode of modesToTry) {
        for (const candStart of sortedCandidates) {
          const candEnd = candStart + duration;
          const check = findValidPlacement(
            candStart,
            candEnd,
            step.slotsRequired,
            step.temperature,
            app,
            appIntervals,
            sharedAnchors,
            tryMode,
            step.stepKind
          );
          if (check.valid) {
            const isExactMatch =
              Boolean(normReqMode) &&
              supportsReq &&
              (tryMode || '').trim().toLowerCase() === normReqMode.toLowerCase();
            if (isExactMatch && (!bestExact || candStart < bestExact.start)) {
              bestExact = { start: candStart, row: check.row, app, mode: tryMode };
            }
            if (!bestAny || candStart < bestAny.start) {
              bestAny = { start: candStart, row: check.row, app, mode: tryMode };
            }
            break;
          }
        }
      }
    }

    let chosen: PlacementCand;
    if (
      bestExact &&
      (bestExact.start + duration <= stepTargetEnd ||
        !bestAny ||
        bestAny.start + duration > stepTargetEnd)
    ) {
      chosen = bestExact;
    } else if (bestAny) {
      chosen = bestAny;
    } else {
      chosen = { start: earliest, row: 0, app: candidatesApps[0], mode: step.applianceMode };
    }

    const chosenStart = chosen.start;
    const chosenEnd = chosenStart + duration;
    liveStart.set(id, chosenStart);
    liveEnd.set(id, chosenEnd);
    liveRow.set(id, chosen.row);
    liveApp.set(id, chosen.app.id);
    liveEffectiveMode.set(id, chosen.mode);

    if (normReqMode) {
      const chosenSupportsReq = applianceSupportsMode(chosen.app, normReqMode);
      const modeChanged = (chosen.mode || '').trim().toLowerCase() !== normReqMode.toLowerCase();
      if (!chosenSupportsReq || modeChanged) {
        const displayMode = chosen.mode || 'default';
        if (bestExact && bestExact.app.id !== chosen.app.id) {
          liveModeNote.set(
            id,
            `Using ${displayMode} on ${chosen.app.name} (${bestExact.app.name} busy/late for ${step.applianceMode})`
          );
        } else if (bestExact && bestExact.app.id === chosen.app.id) {
          liveModeNote.set(
            id,
            `Using ${displayMode} on ${chosen.app.name} instead of preferred ${step.applianceMode} to share oven`
          );
        } else {
          liveModeNote.set(
            id,
            `Using ${displayMode} on ${chosen.app.name} (${chosen.app.name} does not support ${step.applianceMode})`
          );
        }
      }
    }

    const targetIntervals = liveIntervalsByApp.get(chosen.app.id) ?? [];
    targetIntervals.push({
      stepId: id,
      start: chosenStart,
      end: chosenEnd,
      slots: step.slotsRequired,
      temp: step.temperature,
      mode: chosen.mode,
      stepKind: step.stepKind,
      row: chosen.row,
    });
    liveIntervalsByApp.set(chosen.app.id, targetIntervals);
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

    const resolvedAppId = liveApp.get(s.id) ?? '';
    const resolvedApp = resolvedAppId ? applianceMap.get(resolvedAppId) : undefined;
    let transitionBefore: TempTransition | undefined;
    if (resolvedApp && resolvedApp.hasTemperature && s.temperature !== undefined && s.stepKind !== 'preheat') {
      let latestPrevEnd = -Infinity;
      let prevTemp: number | undefined;
      let prevStepId: string | undefined;
      let prevStepKind: 'cooking' | 'preheat' | undefined;
      for (const other of rawSteps) {
        if (other.id === s.id) continue;
        if ((liveApp.get(other.id) ?? '') !== resolvedAppId) continue;
        if (other.temperature === undefined) continue;
        const otherEnd = liveEnd.get(other.id)!;
        if (otherEnd <= startMin && otherEnd > latestPrevEnd) {
          latestPrevEnd = otherEnd;
          prevTemp = other.temperature;
          prevStepId = other.id;
          prevStepKind = other.stepKind;
        }
      }
      if (prevTemp !== undefined && prevStepId && prevStepKind !== 'preheat') {
        const trans = getRequiredTempTransition(prevTemp, s.temperature, resolvedApp);
        if (trans) {
          transitionBefore = {
            type: trans.type,
            durationMin: trans.durationMin,
            fromTemp: prevTemp,
            toTemp: s.temperature,
            fromStepId: prevStepId,
          };
        }
      }
    }

    return {
      ...s,
      resolvedApplianceId: resolvedAppId,
      startMin,
      endMin,
      laneRow: liveRow.get(s.id) ?? 0,
      slackMin,
      isCritical,
      effectivePrereqs: Array.from(allPrereqs.get(s.id) ?? []),
      effectiveDependents: Array.from(allDependents.get(s.id) ?? []),
      isDelayed: delayMin > 0,
      delayMin,
      transitionBefore,
      effectiveMode: liveEffectiveMode.get(s.id) ?? s.applianceMode,
      modeDecisionNote: liveModeNote.get(s.id),
    };
  });

  return {
    steps: scheduledSteps,
    projectedDinnerMin,
    targetDinnerMin,
    dinnerDeltaMin: projectedDinnerMin - targetDinnerMin,
    earliestStartMin,
    suggestedStartMin,
    cycleError: null,
  };
}

export function formatApplianceWithMode(appName: string, mode?: string): string {
  const trimmedMode = mode?.trim();
  return trimmedMode ? `${appName} · ${trimmedMode}` : appName;
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
