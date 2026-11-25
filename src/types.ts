export type StepStatus = 'pending' | 'running' | 'paused' | 'done';

export interface Appliance {
  id: string;
  name: string;
  /** Optional grouping category (e.g. "Oven", "Stovetop", "Counter") for multi-unit balancing */
  category?: string;
  /** Optional operating modes supported by this appliance (e.g. ["Bake", "Convection"]) */
  supportedModes?: string[];
  /** Number of simultaneous slots (e.g., oven racks, stovetop burners) */
  capacity: number;
  /** Unit label for slots, e.g. "rack", "burner", "spot" */
  slotLabel: string;
  /** Whether this appliance has a shared chamber temperature */
  hasTemperature: boolean;
  /** Max °F difference allowed between simultaneous items */
  tempTolerance: number;
  /** Optional fixed preheat buffer (min) when temp increases > tolerance (default: dynamic 5m/50°F, 5–20m) */
  preheatBufferMin?: number;
  /** Optional fixed cooldown buffer (min) when temp decreases > tolerance (default: dynamic 5m/25°F, 5–30m) */
  cooldownBufferMin?: number;
  /** Accent hex color for timeline lane */
  color: string;
}

export type RelativeAnchor = 'after_start' | 'before_end' | 'after_end';

export interface RelativeDependency {
  stepId: string;
  anchor: RelativeAnchor;
  offsetMin: number;
}

export interface MealStep {
  id: string;
  title: string;
  dish: string;
  /** Optional step category: 'preheat' for standalone appliance preheat steps */
  stepKind?: 'cooking' | 'preheat';
  /** Planned duration in minutes */
  durationMin: number;
  /** Appliance ID */
  applianceId: string;
  /** Optional operating mode requested (e.g. "Convection", "Air Fryer", "Toaster") */
  applianceMode?: string;
  /** Whether applianceMode is strictly required or preferred (default 'preferred') */
  modePreference?: 'required' | 'preferred';
  /** How many slots/racks/burners this step occupies */
  slotsRequired: number;
  /** Target temperature in °F (if applicable) */
  temperature?: number;
  /** Step IDs that MUST finish before this step can start */
  dependencies: string[];
  /** Step IDs that rely on this step finishing before they can start ("ready before") */
  readyBeforeIds: string[];
  /** Optional time-relative concurrent dependencies (e.g., 60m before another step ends) */
  relativeDeps?: RelativeDependency[];
  /** Whether this step must finish by target dinner time (default true) */
  mustFinishByDinner: boolean;
  /** True/undefined = needs a countdown timer; false = start-time alert only (e.g., peeling apples) */
  requiresTimer?: boolean;
  /** Optional finish timing / window inherited from parent MealItem */
  finishConstraint?: FinishConstraint;
  /** Manual start time override (minutes from midnight) when dragged/pinned on timeline */
  pinnedStartMin?: number;
  /** Whether this step can be completed early and held in a preserved state */
  canPrepEarly?: boolean;
  /** Minimum minutes before dependent/serve time this step can be prepped early */
  earlyPrepMinBefore?: number;
  /** Maximum minutes early this step can safely be prepared */
  earlyPrepMaxBefore?: number;
  /** Preservation / holding instructions when completed early */
  preservationNotes?: string;
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

export type DishCourse =
  | 'Main'
  | 'Side'
  | 'Appetizer'
  | 'Sauce / Gravy'
  | 'Bread'
  | 'Dessert'
  | 'Beverage'
  | 'Prep / Other';

export type FinishWindowMode =
  | 'at_target'
  | 'before_target'
  | 'window'
  | 'after_target';

export interface FinishConstraint {
  mode: FinishWindowMode;
  /** Minutes before targetDinnerMin (used for 'before_target') */
  offsetMin?: number;
  /** Earliest minutes before targetDinnerMin (used for 'window', e.g. 240 = 4h early) */
  windowMaxBeforeMin?: number;
  /** Latest minutes before targetDinnerMin (used for 'window', e.g. 30 = 30m early) */
  windowMinBeforeMin?: number;
}

export interface ManualChangeEntry {
  id: string;
  timestamp: number;
  field: string;
  summary: string;
}

export interface MealItem {
  id: string;
  name: string;
  course: DishCourse;
  servings?: string;
  portionMultiplier?: number;
  dietaryTags?: string[];
  rawNotes: string;
  sourceUrl?: string;
  ingredients?: string[];
  recipeInstructions?: string;
  convertedNotes: string;
  prepAheadNotes?: string;
  scalingReview?: string;
  finishConstraint: FinishConstraint;
  steps: MealStep[];
  aiProcessedAt?: number;
  manualChangeLog: ManualChangeEntry[];
  libraryItemId?: string;
  updatedAt: number;
}

export interface MealEvent {
  id: string;
  name: string;
  date?: string;
  targetDinnerMin: number;
  simulatedNowMin: number;
  /** When true, Planning Mode uses simulatedNowMin instead of auto-following suggestedStartMin */
  simTimeOverridden?: boolean;
  mealItems: MealItem[];
  appliancesOverride?: Appliance[] | null;
  updatedAt: number;
}

export interface ThymeLineWorkspace {
  schemaVersion: number;
  syncVersion: number;
  updatedAt: number;
  activeEventId: string;
  events: MealEvent[];
  mealLibrary: MealItem[];
  defaultAppliances: Appliance[];
}

export interface TempTransition {
  type: 'preheat' | 'cooldown';
  durationMin: number;
  fromTemp: number;
  toTemp: number;
  fromStepId: string;
}

export interface ScheduledStep extends MealStep {
  /** Concrete appliance ID selected by scheduler (resolves category:* targets, or '' if unassigned) */
  resolvedApplianceId: string;
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
  /** Required preheat or cooldown transition immediately before this step on the same appliance */
  transitionBefore?: TempTransition;
  /** Actual operating mode resolved by the scheduler (may differ from applianceMode on fallback) */
  effectiveMode?: string;
  /** Explanation when the scheduler fell back from a preferred applianceMode */
  modeDecisionNote?: string;
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
  /** Ideal earliest start time from Pass 1 (independent of current clock) */
  suggestedStartMin: number;
  /** Cycle error if user created a circular dependency */
  cycleError: string | null;
}

export interface AppSettings {
  targetDinnerMin: number; // e.g., 17 * 60 = 1020 (5:00 PM)
  soundEnabled: boolean;
  voiceEnabled: boolean;
  warningAt5Min: boolean;
  browserNotificationsEnabled?: boolean;
  useSimulatedClock: boolean;
  simulatedNowMin: number;
  geminiApiKey: string;
  syncPasscode: string;
}

export interface ScheduleSnapshot {
  label: string;
  timestamp: number;
  steps: MealStep[];
  mealItems: MealItem[];
  appliances: Appliance[];
  targetDinnerMin: number;
}
