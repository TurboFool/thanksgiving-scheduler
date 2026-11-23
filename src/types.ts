export type StepStatus = 'pending' | 'running' | 'paused' | 'done';

export interface Appliance {
  id: string;
  name: string;
  /** Number of simultaneous slots (e.g., oven racks, stovetop burners) */
  capacity: number;
  /** Unit label for slots, e.g. "rack", "burner", "spot" */
  slotLabel: string;
  /** Whether this appliance has a shared chamber temperature */
  hasTemperature: boolean;
  /** Max °F difference allowed between simultaneous items */
  tempTolerance: number;
  /** Accent hex color for timeline lane */
  color: string;
}

export interface MealStep {
  id: string;
  title: string;
  dish: string;
  /** Planned duration in minutes */
  durationMin: number;
  /** Appliance ID */
  applianceId: string;
  /** How many slots/racks/burners this step occupies */
  slotsRequired: number;
  /** Target temperature in °F (if applicable) */
  temperature?: number;
  /** Step IDs that MUST finish before this step can start */
  dependencies: string[];
  /** Step IDs that rely on this step finishing before they can start ("ready before") */
  readyBeforeIds: string[];
  /** Whether this step must finish by target dinner time (default true) */
  mustFinishByDinner: boolean;
  /** Optional notes / instructions */
  notes?: string;

  // Live timer & execution state
  status: StepStatus;
  /** Remaining seconds when running or paused (can go <= 0 for overtime) */
  remainingSec: number;
  /** Extra minutes added via +5/+10m or overtime */
  addedMin: number;
  /** Actual start time in minutes-from-midnight (when started/done) */
  actualStartMin?: number;
  /** Actual end time in minutes-from-midnight (when done) */
  actualEndMin?: number;
}

export interface ScheduledStep extends MealStep {
  /** Planned/projected start in minutes from midnight */
  startMin: number;
  /** Planned/projected end in minutes from midnight */
  endMin: number;
  /** Vertical sub-lane index within the appliance swimlane (0..capacity-1) */
  laneRow: number;
  /** Minutes of slack before pushing a dependent or dinner */
  slackMin: number;
  /** Whether this step is on the critical path or pushing dinner late */
  isCritical: boolean;
  /** Effective dependency IDs (merged dependencies + reverse readyBeforeIds) */
  effectivePrereqs: string[];
  /** Effective downstream IDs */
  effectiveDependents: string[];
  /** True if this step was pushed past its ideal back-scheduled time */
  isDelayed: boolean;
  /** Minutes delayed relative to ideal plan */
  delayMin: number;
}

export interface ScheduleResult {
  steps: ScheduledStep[];
  /** Projected finish time of the latest mustFinishByDinner step */
  projectedDinnerMin: number;
  /** Target dinner time in minutes from midnight */
  targetDinnerMin: number;
  /** projectedDinnerMin - targetDinnerMin (positive = behind schedule) */
  dinnerDeltaMin: number;
  /** Earliest start time of any step */
  earliestStartMin: number;
  /** Cycle error if user created a circular dependency */
  cycleError: string | null;
}

export interface AppSettings {
  targetDinnerMin: number; // e.g., 17 * 60 = 1020 (5:00 PM)
  soundEnabled: boolean;
  voiceEnabled: boolean;
  warningAt5Min: boolean;
  useSimulatedClock: boolean;
  simulatedNowMin: number;
  geminiApiKey: string;
}

export interface ScheduleSnapshot {
  label: string;
  timestamp: number;
  steps: MealStep[];
  appliances: Appliance[];
  targetDinnerMin: number;
}
