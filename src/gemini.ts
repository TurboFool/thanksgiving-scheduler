import type { Appliance, DishCourse, FinishConstraint, MealItem, MealStep, ScheduledStep } from './types';
import { computeSchedule, formatTimeMin } from './scheduler';
import { scaleIngredients } from './recipeScaler';
import { stepsToMealItems } from './workspace';

export function buildGeminiChatPrompt(
  appliances: Appliance[],
  menuText: string,
  existingSteps?: MealStep[]
): string {
  const appSummary = appliances
    .map(
      (a) =>
        `- id: "${a.id}", name: "${a.name}", capacity: ${a.capacity} ${a.slotLabel}(s), hasTemperature: ${a.hasTemperature}${
          a.hasTemperature ? `, tolerance: ±${a.tempTolerance}°F` : ''
        }`
    )
    .join('\n');

  const isAdding = Boolean(existingSteps && existingSteps.length > 0);
  const existingSummary = isAdding
    ? `\nExisting steps already on the schedule (do NOT repeat these; you may reference their IDs in "dependencies" or "readyBeforeIds" if a new step relies on them):\n${existingSteps!
        .map(
          (s) =>
            `- id: "${s.id}", title: "${s.title}", dish: "${s.dish}", applianceId: "${s.applianceId}", durationMin: ${s.durationMin}${
              s.temperature !== undefined ? `, temperature: ${s.temperature}°F` : ''
            }, status: ${s.status}`
        )
        .join('\n')}\n`
    : '';

  return `You are a Thanksgiving culinary scheduling assistant. ${
    isAdding
      ? 'Generate ONLY the NEW cooking steps for the additional items below so they can be added to the existing schedule.'
      : 'Convert the following menu into a structured JSON array of cooking steps.'
  }

Available appliances:
${appSummary}
${existingSummary}
${isAdding ? 'New items / notes to add:' : 'Menu / Notes:'}
${menuText || '(Insert your Thanksgiving dishes, turkey weight, sides, and any special timing notes here)'}

Return ONLY valid JSON matching this TypeScript type (an array of objects):
[
  {
    "id": "unique-kebab-id",
    "title": "Short action title (e.g. Roast 14lb Turkey)",
    "dish": "Dish name (e.g. Turkey)",
    "durationMin": 180,
    "applianceId": "oven",
    "slotsRequired": 2,
    "temperature": 325,
    "dependencies": ["turkey-prep"],
    "readyBeforeIds": [],
    "mustFinishByDinner": true,
    "notes": "Helpful tip"
  }
]

Rules:
1. Use only the appliance IDs listed above.
2. Omit "temperature" (or set null) for appliances where hasTemperature is false.
3. Use "dependencies" for steps that must finish BEFORE this step can start (e.g. prep before cook, turkey roast before rest/carve and gravy).
4. Set "slotsRequired" realistically (e.g. whole turkey uses 2 oven racks; a casserole uses 1 rack).${
    isAdding
      ? '\n5. Return ONLY the NEW steps (do NOT include existing steps), using unique kebab-case IDs that do not collide with existing IDs.\n6. Return ONLY the JSON array.'
      : '\n5. Return ONLY the JSON array.'
  }`;
}

export const GEMINI_SKILL_VERSION = '1.2.0';

export function buildGeminiSkillInstructions(appliances: Appliance[]): string {
  const appSummary = appliances
    .map(
      (a) =>
        `- id: "${a.id}", name: "${a.name}", category: "${a.category ?? ''}"${
          a.supportedModes?.length ? `, supportedModes: [${a.supportedModes.map((m) => `"${m}"`).join(', ')}]` : ''
        }, capacity: ${a.capacity} ${a.slotLabel}(s), hasTemperature: ${a.hasTemperature}${
          a.hasTemperature ? `, tolerance: ±${a.tempTolerance}°F` : ''
        }`
    )
    .join('\n');

  const categories = Array.from(
    new Set(appliances.map((a) => (a.category || '').trim()).filter(Boolean))
  );

  return `<!-- ThymeLine Gemini Skill v${GEMINI_SKILL_VERSION} -->
You are a culinary planning & recipe-structuring assistant for **ThymeLine** (a kitchen timeline scheduler).
Skill Version: **v${GEMINI_SKILL_VERSION}**

## Your Role
Help the user brainstorm menus, extract recipes from photos/screenshots/URLs/notes, scale portions, and structure dishes. Whenever the user asks to export, format, or prepare a dish (or a collection of dishes) for ThymeLine, output a **single valid JSON code block** matching the ThymeLine MealItem schema below.

## User's Current Kitchen Appliances
${appSummary}

Available auto-balance categories (use \`"category:<Name>"\` for multi-unit appliances like Ovens so ThymeLine can automatically balance racks/temps across units, or \`""\` if location should be chosen per event):
${categories.map((c) => `- "category:${c}"`).join('\n') || '- (none)'}

## Output Schema (Return a JSON array of MealItem objects, or a single MealItem object)
\`\`\`json
[
  {
    "name": "Hot Apple Cider",
    "course": "Beverage",
    "servings": "8 servings",
    "sourceUrl": "https://example.com/recipe (optional)",
    "ingredients": [
      "8 cups apple cider",
      "2 tbsp mulling spices",
      "2 apples, thinly sliced"
    ],
    "recipeInstructions": "Clean full method...",
    "rawNotes": "Key reminders or user preferences...",
    "prepAheadNotes": "Optional day-ahead or early-prep summary...",
    "finishConstraint": { "mode": "before_target", "offsetMin": 60 },
    "steps": [
      {
        "id": "bag-spices",
        "title": "Bag spices & fill slow cooker",
        "durationMin": 5,
        "applianceId": "counter",
        "slotsRequired": 1,
        "temperature": null,
        "dependencies": [],
        "readyBeforeIds": [],
        "relativeDeps": [],
        "mustFinishByDinner": true,
        "requiresTimer": false,
        "canPrepEarly": true,
        "earlyPrepMinBefore": 15,
        "earlyPrepMaxBefore": 240,
        "preservationNotes": "Keep covered until ready to heat",
        "notes": "Submerge spice bag in cider"
      },
      {
        "id": "heat-cider",
        "title": "Heat cider in slow cooker",
        "durationMin": 180,
        "applianceId": "slowcooker",
        "applianceMode": "Low",
        "modePreference": "preferred",
        "slotsRequired": 1,
        "temperature": null,
        "dependencies": ["bag-spices"],
        "readyBeforeIds": [],
        "relativeDeps": [],
        "mustFinishByDinner": true,
        "requiresTimer": true,
        "notes": "Low heat for 3 hours"
      },
      {
        "id": "add-apples",
        "title": "Add sliced apples to cider",
        "durationMin": 2,
        "applianceId": "slowcooker",
        "slotsRequired": 1,
        "temperature": null,
        "dependencies": [],
        "readyBeforeIds": [],
        "relativeDeps": [
          { "stepId": "heat-cider", "anchor": "before_end", "offsetMin": 60 }
        ],
        "mustFinishByDinner": false,
        "requiresTimer": false,
        "notes": "Stir in 1 hour before cider finishes so apples soften without overcooking"
      }
    ]
  }
]
\`\`\`

## Strict Formatting Rules
1. **Valid Courses**: \`"Main"\`, \`"Side"\`, \`"Appetizer"\`, \`"Sauce / Gravy"\`, \`"Bread"\`, \`"Dessert"\`, \`"Beverage"\`, \`"Prep / Other"\`.
2. **Finish Constraints (\`finishConstraint\`)**:
   - \`{ "mode": "at_target" }\` — ready right at Serve Time
   - \`{ "mode": "before_target", "offsetMin": 30 }\` — finish X min before Serve Time (resting, appetizers, etc.)
   - \`{ "mode": "window", "windowMinBeforeMin": 20 }\` — flexible window before Serve Time
   - \`{ "mode": "after_target" }\` — after Serve Time (e.g., dessert)
3. **Timed vs. Untimed Prep (\`requiresTimer\`)**:
   - \`false\` for manual prep tasks (peeling, slicing, setting out) that only need a start-time alert.
   - \`true\` for active cooking/baking/simmering steps that need a countdown timer.
4. **Concurrent Mid-Timer Actions (\`relativeDeps\`)**:
   - When a step happens *during* another ongoing timer (e.g., adding apples 60m before cider ends, or basting 30m after roast starts), use \`"relativeDeps": [{ "stepId": "<target-id>", "anchor": "before_end" | "after_start" | "after_end", "offsetMin": 60 }]\` and leave that target OUT of \`"dependencies"\`.
5. **Split Distinct Phases**: Never merge distinct timed phases (e.g., "sauté 7m, stir in thickener, boil 2m") into one step — split them into sequential steps linked via \`"dependencies"\`.
6. **Valid Appliance IDs & Modes**: Use only the appliance IDs listed above, \`"category:<Name>"\`, or \`""\` (unassigned). Omit/null \`temperature\` when \`hasTemperature\` is \`false\`. When a step uses a specific operating mode (e.g., \`"Convection"\`, \`"Broil"\`, \`"Air Fryer"\`), set \`"applianceMode"\` (matching \`supportedModes\` when possible) and \`"modePreference": "required" | "preferred"\`. Note that ThymeLine enforces mode exclusivity (no simultaneous mixed modes on one unit) and automatically inserts preheat/cooldown buffers between sequential uses when temperature changes beyond \`tempTolerance\`.
7. **Standalone Appliance Preheats**: For oven/air-fryer dishes, you may optionally include a separate \`"Prep / Other"\` item (or let the user's **Auto-Generate Preheats** button create them) with \`"stepKind": "preheat"\` and \`"mustFinishByDinner": false\`, and link the cooking step's \`"dependencies"\` to that preheat step ID.
8. When the user says they are ready to import, return **ONLY the JSON code block** with no extra commentary inside the JSON.`;
}

export function parseImportedSteps(rawInput: string, appliances: Appliance[]): MealStep[] {
  let cleaned = rawInput.trim();
  // Strip markdown code fences if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(cleaned);
  const arr = Array.isArray(parsed) ? parsed : parsed?.steps;
  if (!Array.isArray(arr)) {
    throw new Error('Expected a JSON array of steps (or an object with a "steps" array).');
  }

  const validAppIds = new Set(appliances.map((a) => a.id));
  const fallbackAppId = appliances[0]?.id ?? 'counter';

  return arr.map((item, idx) => {
    const durationMin = Math.max(1, Number(item.durationMin) || 15);
    const rawAppId = typeof item.applianceId === 'string' ? item.applianceId.trim() : '';
    const applianceId =
      rawAppId === '' || rawAppId.startsWith('category:') || validAppIds.has(rawAppId)
        ? rawAppId
        : fallbackAppId;
    const temp =
      item.temperature !== null && item.temperature !== undefined && item.temperature !== ''
        ? Number(item.temperature)
        : undefined;

    return {
      id: String(item.id || `step-${idx + 1}`),
      title: String(item.title || `Step ${idx + 1}`),
      dish: String(item.dish || 'General'),
      ...(item.stepKind === 'preheat' ? { stepKind: 'preheat' as const } : {}),
      durationMin,
      applianceId,
      applianceMode: item.applianceMode ? String(item.applianceMode).trim() : undefined,
      modePreference:
        item.modePreference === 'required'
          ? 'required'
          : item.applianceMode
          ? 'preferred'
          : undefined,
      slotsRequired: Math.max(1, Number(item.slotsRequired) || 1),
      temperature: Number.isFinite(temp) ? temp : undefined,
      dependencies: Array.isArray(item.dependencies) ? item.dependencies.map(String) : [],
      readyBeforeIds: Array.isArray(item.readyBeforeIds) ? item.readyBeforeIds.map(String) : [],
      relativeDeps: Array.isArray(item.relativeDeps)
        ? item.relativeDeps
            .filter(
              (
                r: unknown
              ): r is {
                stepId: string;
                anchor: 'after_start' | 'before_end' | 'after_end';
                offsetMin: number;
              } =>
                Boolean(
                  r &&
                    typeof r === 'object' &&
                    typeof (r as { stepId?: unknown }).stepId === 'string'
                )
            )
            .map(
              (r: {
                stepId: string;
                anchor: 'after_start' | 'before_end' | 'after_end';
                offsetMin: number;
              }) => ({
                stepId: String(r.stepId),
                anchor:
                  r.anchor === 'after_start' || r.anchor === 'after_end' ? r.anchor : 'before_end',
                offsetMin: Math.max(0, Number(r.offsetMin) || 0),
              })
            )
        : undefined,
      mustFinishByDinner: item.mustFinishByDinner !== false,
      requiresTimer: item.requiresTimer !== false,
      canPrepEarly: item.canPrepEarly === true ? true : undefined,
      earlyPrepMinBefore:
        item.canPrepEarly === true && item.earlyPrepMinBefore !== undefined
          ? Math.max(0, Number(item.earlyPrepMinBefore) || 0)
          : undefined,
      earlyPrepMaxBefore:
        item.canPrepEarly === true && item.earlyPrepMaxBefore !== undefined
          ? Math.max(0, Number(item.earlyPrepMaxBefore) || 0)
          : undefined,
      preservationNotes: item.preservationNotes ? String(item.preservationNotes) : undefined,
      notes: item.notes ? String(item.notes) : undefined,
      status: 'pending',
      remainingSec: durationMin * 60,
      addedMin: 0,
    };
  });
}

const VALID_COURSES = new Set<DishCourse>([
  'Main',
  'Side',
  'Appetizer',
  'Sauce / Gravy',
  'Bread',
  'Dessert',
  'Beverage',
  'Prep / Other',
]);

function normalizeFinishConstraint(raw: unknown): FinishConstraint {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const mode = obj.mode;
    if (
      mode === 'at_target' ||
      mode === 'before_target' ||
      mode === 'window' ||
      mode === 'after_target'
    ) {
      return {
        mode,
        ...(obj.offsetMin !== undefined ? { offsetMin: Math.max(0, Number(obj.offsetMin) || 0) } : {}),
        ...(obj.windowMinBeforeMin !== undefined
          ? { windowMinBeforeMin: Math.max(0, Number(obj.windowMinBeforeMin) || 0) }
          : {}),
      };
    }
  }
  return { mode: 'at_target' };
}

/**
 * Parses JSON from Gemini in ANY of these formats:
 * - A single MealItem object ({ name, course, ..., steps: [...] })
 * - An array of MealItem objects ([ { name, ..., steps: [...] }, ... ])
 * - An object wrapping { meals: [...] } or { mealItems: [...] }
 * - A legacy flat MealStep[] array ([ { id, title, dish, ... } ]) or { steps: [...] }
 */
export function parseImportedMeals(
  rawInput: string,
  appliances: Appliance[],
  existingSteps: MealStep[] = []
): MealItem[] {
  let cleaned = rawInput.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(cleaned) as unknown;

  // Unwrap { meals } / { mealItems } / single MealItem
  let mealCandidates: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    const looksLikeMealArray =
      parsed.length > 0 &&
      typeof parsed[0] === 'object' &&
      parsed[0] !== null &&
      Array.isArray((parsed[0] as Record<string, unknown>).steps) &&
      typeof (parsed[0] as Record<string, unknown>).name === 'string';
    if (looksLikeMealArray) {
      mealCandidates = parsed;
    }
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.meals)) {
      mealCandidates = obj.meals;
    } else if (Array.isArray(obj.mealItems)) {
      mealCandidates = obj.mealItems;
    } else if (Array.isArray(obj.steps) && typeof obj.name === 'string') {
      mealCandidates = [obj];
    }
  }

  // Fallback to legacy MealStep[] grouping
  if (!mealCandidates) {
    const rawSteps = parseImportedSteps(rawInput, appliances);
    const merged = mergeImportedSteps(existingSteps, rawSteps);
    const newSlice = merged.slice(existingSteps.length);
    return stepsToMealItems(newSlice);
  }

  const now = Date.now();
  const usedStepIds = new Set(existingSteps.map((s) => s.id));
  const result: MealItem[] = [];

  mealCandidates.forEach((rawMeal, idx) => {
    if (!rawMeal || typeof rawMeal !== 'object') return;
    const m = rawMeal as Record<string, unknown>;
    const dishName = String(m.name || `Imported Dish ${idx + 1}`).trim();
    const rawCourse = String(m.course || 'Side') as DishCourse;
    const course: DishCourse = VALID_COURSES.has(rawCourse) ? rawCourse : 'Side';
    const finishConstraint = normalizeFinishConstraint(m.finishConstraint);

    const parsedSteps = parseImportedSteps(JSON.stringify(m.steps ?? []), appliances).map(
      (s) => ({
        ...s,
        dish: dishName,
        finishConstraint: s.finishConstraint ?? finishConstraint,
      })
    );

    // Ensure unique step IDs across existing event steps & other imported meals
    const idRemap = new Map<string, string>();
    for (const s of parsedSteps) {
      let nextId = s.id;
      if (usedStepIds.has(nextId)) {
        let suffix = 2;
        while (usedStepIds.has(`${s.id}-${suffix}`)) suffix++;
        nextId = `${s.id}-${suffix}`;
      }
      idRemap.set(s.id, nextId);
      usedStepIds.add(nextId);
    }

    const remappedSteps: MealStep[] = parsedSteps.map((s) => ({
      ...s,
      id: idRemap.get(s.id) ?? s.id,
      dependencies: s.dependencies.map((d) => idRemap.get(d) ?? d),
      readyBeforeIds: s.readyBeforeIds.map((d) => idRemap.get(d) ?? d),
      relativeDeps: s.relativeDeps?.map((r) => ({
        ...r,
        stepId: idRemap.get(r.stepId) ?? r.stepId,
      })),
    }));

    const ingredients = Array.isArray(m.ingredients)
      ? m.ingredients.map((x) => String(x).trim()).filter(Boolean)
      : undefined;

    result.push({
      id: `item-${now}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      name: dishName,
      course,
      servings: m.servings ? String(m.servings).trim() : undefined,
      portionMultiplier: 1,
      dietaryTags: Array.isArray(m.dietaryTags)
        ? m.dietaryTags.map((x) => String(x).trim()).filter(Boolean)
        : undefined,
      sourceUrl: m.sourceUrl ? String(m.sourceUrl).trim() : undefined,
      ingredients,
      recipeInstructions: m.recipeInstructions ? String(m.recipeInstructions).trim() : undefined,
      rawNotes: String(m.rawNotes ?? m.recipeInstructions ?? '').trim(),
      convertedNotes: String(m.convertedNotes ?? m.rawNotes ?? '').trim(),
      prepAheadNotes: m.prepAheadNotes ? String(m.prepAheadNotes).trim() : undefined,
      finishConstraint,
      steps: remappedSteps,
      manualChangeLog: [],
      updatedAt: now,
    });
  });

  if (result.length === 0) {
    throw new Error('No valid meal items found in the JSON.');
  }
  return result;
}

export const GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
] as const;

const GEMINI_TIMEOUT_MS = 35_000;

async function callGeminiWithFallback(
  apiKey: string,
  body: Record<string, unknown>
): Promise<string> {
  const key = encodeURIComponent(apiKey.trim());
  const maxAttempts = 2;
  let lastError = 'Gemini API request failed.';
  let transientFailures = 0;
  const triedModels = new Set<string>();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }

    for (const model of GEMINI_MODELS) {
      triedModels.add(model);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        window.clearTimeout(timeoutId);
        transientFailures += 1;
        if (err instanceof DOMException && err.name === 'AbortError') {
          lastError = `Request to ${model} timed out after ${GEMINI_TIMEOUT_MS / 1000}s.`;
          continue;
        }
        const msg = err instanceof Error ? err.message : 'Network error';
        lastError = `Network error calling ${model}: ${msg}`;
        continue;
      } finally {
        window.clearTimeout(timeoutId);
      }

      if (res.ok) {
        const data = await res.json();
        const candidate = data?.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;
        if (!text) {
          const reason =
            candidate?.finishReason || data?.promptFeedback?.blockReason || 'UNKNOWN';
          throw new Error(
            `Gemini (${model}) returned an empty response (reason: ${reason}). Try simplifying your notes or regenerating fresh.`
          );
        }
        return text;
      }

      const errText = await res.text();
      lastError = `Gemini API error (${res.status} on ${model}): ${errText.slice(0, 220)}`;

      // Retry with next model on transient overload (503), rate limit (429), or unavailable model (404)
      if (res.status === 503 || res.status === 429 || res.status === 404) {
        if (res.status === 503 || res.status === 429) {
          transientFailures += 1;
        }
        continue;
      }
      throw new Error(lastError);
    }
  }

  if (transientFailures >= GEMINI_MODELS.length) {
    throw new Error(
      `Gemini is temporarily busy across all ${triedModels.size} models we tried (${Array.from(
        triedModels
      ).join(', ')}) — each reported high demand or a temporary timeout. Please wait a few seconds and try again.`
    );
  }

  throw new Error(lastError);
}

export function mergeImportedSteps(
  existing: MealStep[],
  incoming: MealStep[]
): MealStep[] {
  const usedIds = new Set(existing.map((s) => s.id));
  const idRemap = new Map<string, string>();

  for (const step of incoming) {
    let nextId = step.id;
    if (usedIds.has(nextId)) {
      let suffix = 2;
      while (usedIds.has(`${step.id}-${suffix}`)) {
        suffix += 1;
      }
      nextId = `${step.id}-${suffix}`;
      idRemap.set(step.id, nextId);
    }
    usedIds.add(nextId);
  }

  const normalizedIncoming = incoming.map((step) => ({
    ...step,
    id: idRemap.get(step.id) ?? step.id,
    dependencies: step.dependencies.map((d) => idRemap.get(d) ?? d),
    readyBeforeIds: step.readyBeforeIds.map((d) => idRemap.get(d) ?? d),
    relativeDeps: step.relativeDeps?.map((r) => ({
      ...r,
      stepId: idRemap.get(r.stepId) ?? r.stepId,
    })),
  }));

  return [...existing, ...normalizedIncoming];
}

export async function generateScheduleWithGemini(
  apiKey: string,
  menuText: string,
  appliances: Appliance[],
  existingSteps?: MealStep[]
): Promise<MealStep[]> {
  const prompt = buildGeminiChatPrompt(appliances, menuText, existingSteps);
  const text = await callGeminiWithFallback(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });
  return parseImportedSteps(text, appliances);
}

export async function getRecoveryAdviceWithGemini(
  apiKey: string,
  steps: ScheduledStep[],
  appliances: Appliance[],
  targetDinnerMin: number,
  projectedDinnerMin: number
): Promise<string> {
  const delta = projectedDinnerMin - targetDinnerMin;
  const appMap = new Map(appliances.map((a) => [a.id, a]));
  const stepLines = steps
    .map(
      (s) =>
        `- [${s.status.toUpperCase()}] ${s.title} (${s.dish}): ${formatTimeMin(s.startMin)}–${formatTimeMin(
          s.endMin
        )} (${s.durationMin}m) on ${appMap.get(s.applianceId)?.name ?? s.applianceId}${
          s.temperature ? ` @ ${s.temperature}°F` : ''
        }${s.isDelayed ? ` [DELAYED +${s.delayMin}m]` : ''}`
    )
    .join('\n');

  const appLines = appliances
    .map((a) => `- ${a.name} (capacity: ${a.capacity} ${a.slotLabel}s)`)
    .join('\n');

  const prompt = `We are preparing a family/holiday meal. Target serve time is ${formatTimeMin(
    targetDinnerMin
  )}, but our current projected finish time is ${formatTimeMin(projectedDinnerMin)} (${
    delta > 0 ? `+${delta} minutes behind schedule` : 'on time'
  }).

Appliances available:
${appLines}

Current Schedule:
${stepLines}

Give 3 concise, practical, culinary-sound suggestions to recover time or reduce oven/appliance bottlenecks right now (e.g., moving a side to the air fryer/microwave, par-cooking on stovetop, adjusting resting time, or combining compatible temperatures). Keep it under 180 words with bullet points.`;

  return callGeminiWithFallback(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4 },
  });
}

export interface ProcessedMealItemResult {
  convertedNotes: string;
  prepAheadNotes?: string;
  steps: MealStep[];
}

export async function processMealItemWithGemini(
  apiKey: string,
  item: MealItem,
  appliances: Appliance[],
  otherItems: MealItem[] = [],
  options?: { aiGuidance?: string; regenerateFresh?: boolean }
): Promise<ProcessedMealItemResult> {
  const appSummary = appliances
    .map(
      (a) =>
        `- id: "${a.id}", name: "${a.name}", category: "${a.category ?? ''}"${
          a.supportedModes?.length ? `, supportedModes: [${a.supportedModes.map((m) => `"${m}"`).join(', ')}]` : ''
        }, capacity: ${a.capacity} ${a.slotLabel}(s), hasTemperature: ${a.hasTemperature}${
          a.hasTemperature ? `, tolerance: ±${a.tempTolerance}°F` : ''
        }`
    )
    .join('\n');

  const otherStepsSummary = otherItems
    .flatMap((other) =>
      other.steps.map((s) => `- id: "${s.id}", dish: "${other.name}", title: "${s.title}"`)
    )
    .slice(0, 30)
    .join('\n');

  const regenerateFresh = Boolean(options?.regenerateFresh) || item.steps.length === 0;
  const aiGuidance = options?.aiGuidance?.trim();

  const manualLogText =
    !regenerateFresh && item.manualChangeLog.length > 0
      ? `\nManual edits logged since last AI processing (preserve unless overridden by user notes or Gemini instructions):\n${item.manualChangeLog
          .map((m) => `- [${m.field}] ${m.summary}`)
          .join('\n')}\n`
      : '';

  const currentStepsText =
    !regenerateFresh && item.steps.length > 0
      ? `\nCurrent steps on this item (you MUST update, split, reorder, or replace these whenever Primary Notes, Recipe Instructions, or User Instructions for Gemini ask for changes):\n${JSON.stringify(
          item.steps.map((s) => ({
            id: s.id,
            title: s.title,
            durationMin: s.durationMin,
            applianceId: s.applianceId,
            ...(s.applianceMode ? { applianceMode: s.applianceMode } : {}),
            ...(s.modePreference ? { modePreference: s.modePreference } : {}),
            slotsRequired: s.slotsRequired,
            temperature: s.temperature ?? null,
            dependencies: s.dependencies,
            readyBeforeIds: s.readyBeforeIds,
            mustFinishByDinner: s.mustFinishByDinner,
            requiresTimer: s.requiresTimer !== false,
            notes: s.notes ?? '',
          })),
          null,
          2
        )}\n`
      : '';

  const prompt = `You are a culinary scheduling assistant for ThymeLine.
Analyze this single dish/meal item and produce:
1. "convertedNotes": A clean, concise, sanitized kitchen summary of how to prepare and cook this item (stripping fluff, keeping exact temps, times, and key ingredients/cues).
2. "prepAheadNotes": Optional short note on what can be prepped a day ahead or earlier in the day.
3. "steps": A non-empty JSON array of concrete cooking/prep steps for this dish.

${
  aiGuidance
    ? `HIGHEST PRIORITY — DIRECT USER INSTRUCTIONS FOR GEMINI (you MUST follow these instructions and override/split/rewrite existing steps accordingly):
${aiGuidance}

`
    : ''
}CRITICAL STEP-SPLITTING & TIMER RULES:
- Whenever Primary Notes, Recipe Instructions, or Direct User Instructions describe distinct phases with separate timings or actions (for example: "sauté 6-7 minutes, then stir in thickener/spices, then boil and stir 2 more minutes"), you MUST split them into SEPARATE sequential steps linked with "dependencies" (e.g., step-2 depends on step-1, step-3 depends on step-2) instead of merging them into one combined step.
- Even if Current Steps previously had steps merged together, ALWAYS prefer the user's Primary Notes, Recipe Instructions, and Direct User Instructions.
- Set "requiresTimer": false for untimed manual prep tasks (e.g., peeling/chopping apples, setting out ingredients) that only need a start-time alert without a countdown alarm; set "requiresTimer": true for active cooking/baking/simmering/boiling steps that need a countdown timer.
- When a step must happen CONCURRENTLY relative to an ongoing timer (e.g., "add apples 1 hour before a 2-hour cider finishes" or "baste 30 min after roast starts"), do NOT put that timer in "dependencies" (which forces waiting until it ends); instead use "relativeDeps": [{ "stepId": "<target-id>", "anchor": "before_end" | "after_start" | "after_end", "offsetMin": 60 }].
- Use "category:Oven" (or "" if unsure) for oven steps in multi-oven kitchens, and specific IDs like "stovetop" or "counter" for stovetop/counter prep.
- Whenever a step uses a specific operating mode (e.g., "Convection", "Bake", "Broil", "Air Fryer", "Toast") matching an appliance's supportedModes, set "applianceMode" and "modePreference": "preferred" (or "required" if strictly needed).

Dish Name: ${item.name}
Course: ${item.course}
${item.servings ? `Servings: ${item.servings}\n` : ''}${
    item.sourceUrl ? `Source URL: ${item.sourceUrl}\n` : ''
  }
Primary Raw Notes & Recipe Instructions:
${item.rawNotes || '(No raw notes provided yet — infer standard steps from the dish name)'}
${!regenerateFresh && item.convertedNotes ? `\nPrevious Converted Notes:\n${item.convertedNotes}\n` : ''}${currentStepsText}${manualLogText}
Available appliances:
${appSummary}
${otherStepsSummary ? `\nOther steps in this event (you may reference their IDs in dependencies/readyBeforeIds if needed):\n${otherStepsSummary}\n` : ''}
Return ONLY a valid JSON object with this exact shape:
{
  "convertedNotes": "Concise sanitized kitchen instructions...",
  "prepAheadNotes": "Optional make-ahead tip...",
  "steps": [
    {
      "id": "unique-kebab-id",
      "title": "Short action title",
      "dish": "${item.name}",
      "durationMin": 7,
      "applianceId": "stovetop",
      "applianceMode": "optional-mode-name",
      "modePreference": "preferred",
      "slotsRequired": 1,
      "temperature": null,
      "dependencies": [],
      "readyBeforeIds": [],
      "mustFinishByDinner": true,
      "requiresTimer": true,
      "notes": "Key cue"
    }
  ]
}`;

  const rawText = await callGeminiWithFallback(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });

  let cleaned = rawText.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  const parsed = JSON.parse(cleaned) as {
    convertedNotes?: string;
    prepAheadNotes?: string;
    steps?: unknown[];
  };

  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error(
      'Gemini did not return any steps. Try adding a brief note in "Instructions for Gemini" or clicking "Regenerate Fresh".'
    );
  }

  const rawParsedSteps = parseImportedSteps(JSON.stringify(parsed.steps), appliances).map((s) => ({
    ...s,
    dish: item.name,
  }));

  const allKnownSteps = [...rawParsedSteps, ...otherItems.flatMap((o) => o.steps)];
  const knownIds = new Set(allKnownSteps.map((s) => s.id));
  const steps = rawParsedSteps.map((s) => {
    if (!s.relativeDeps?.length) return s;
    const resolvedRels = s.relativeDeps
      .map((rel) => {
        if (knownIds.has(rel.stepId)) return rel;
        const norm = rel.stepId.toLowerCase().trim();
        const match = allKnownSteps.find(
          (cand) =>
            cand.id !== s.id &&
            (cand.title.toLowerCase().includes(norm) || norm.includes(cand.title.toLowerCase()))
        );
        return match ? { ...rel, stepId: match.id } : null;
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    return {
      ...s,
      relativeDeps: resolvedRels.length > 0 ? resolvedRels : undefined,
    };
  });

  return {
    convertedNotes: String(parsed.convertedNotes ?? item.convertedNotes ?? '').trim(),
    prepAheadNotes: parsed.prepAheadNotes ? String(parsed.prepAheadNotes).trim() : item.prepAheadNotes,
    steps,
  };
}

export async function reEvaluateEventWithGemini(
  apiKey: string,
  items: MealItem[],
  appliances: Appliance[],
  targetDinnerMin: number
): Promise<string> {
  const appSummary = appliances
    .map((a) => `- ${a.name} (${a.capacity} ${a.slotLabel}s${a.hasTemperature ? `, ±${a.tempTolerance}°F` : ''})`)
    .join('\n');

  const itemSummary = items
    .map((it) => {
      const changes =
        it.manualChangeLog.length > 0
          ? ` [MANUAL EDITS: ${it.manualChangeLog.map((c) => c.summary).join('; ')}]`
          : '';
      const stepsStr = it.steps
        .map(
          (s) =>
            `  * ${s.title}: ${s.durationMin}m on ${
              s.applianceId || 'UNASSIGNED (recommend best appliance)'
            }${s.temperature ? ` @ ${s.temperature}°F` : ''}`
        )
        .join('\n');
      return `- ${it.name} (${it.course}, finish: ${it.finishConstraint.mode})${changes}\n${stepsStr}`;
    })
    .join('\n');

  const prompt = `We are planning a family/holiday meal targeting ${formatTimeMin(targetDinnerMin)}.
Appliances:
${appSummary}

Meal Items & Steps:
${itemSummary}

Review the full set of dishes and any recent manual edits. Give 3–4 concise, actionable recommendations to optimize appliance sharing, temperature compatibility, or finish windows (e.g., which items can be moved to a flexible finish window or different appliance). Keep under 200 words.`;

  return callGeminiWithFallback(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.35 },
  });
}

function extractJsonObject<T>(rawText: string): T {
  let cleaned = rawText.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned) as T;
}

export interface FetchedRecipeResult {
  name?: string;
  servings?: string;
  ingredients: string[];
  recipeInstructions: string;
  prepAheadNotes?: string;
}

export async function fetchRecipeFromUrlWithGemini(
  apiKey: string,
  url: string
): Promise<FetchedRecipeResult> {
  const prompt = `Read the recipe at this URL and extract its contents cleanly:
${url.trim()}

Return ONLY a valid JSON object (no commentary) with this exact shape:
{
  "name": "Dish title",
  "servings": "e.g., 8 servings",
  "ingredients": [
    "2 tbsp olive oil",
    "1 1/2 lb green beans, trimmed"
  ],
  "recipeInstructions": "Concise numbered or paragraph instructions...",
  "prepAheadNotes": "Optional make-ahead note if mentioned"
}

If the page is blocked or unreadable, return {"error": "Reason why it could not be read"}.`;

  const rawText = await callGeminiWithFallback(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ url_context: {} }],
    generationConfig: { temperature: 0.1 },
  });

  const parsed = extractJsonObject<FetchedRecipeResult & { error?: string }>(rawText);
  if (parsed.error) {
    throw new Error(parsed.error);
  }

  return {
    name: parsed.name ? String(parsed.name).trim() : undefined,
    servings: parsed.servings ? String(parsed.servings).trim() : undefined,
    ingredients: Array.isArray(parsed.ingredients)
      ? parsed.ingredients.map((i) => String(i).trim()).filter(Boolean)
      : [],
    recipeInstructions: String(parsed.recipeInstructions ?? '').trim(),
    prepAheadNotes: parsed.prepAheadNotes ? String(parsed.prepAheadNotes).trim() : undefined,
  };
}

export interface SuggestedStepUpdate {
  stepId?: string;
  title: string;
  durationMin?: number;
  slotsRequired?: number;
  temperature?: number;
  reason: string;
}

export interface ScaledRecipeReviewResult {
  reviewSummary: string;
  issues: string[];
  suggestedStepUpdates: SuggestedStepUpdate[];
}

export async function reviewScaledRecipeWithGemini(
  apiKey: string,
  item: MealItem,
  appliances: Appliance[]
): Promise<ScaledRecipeReviewResult> {
  const multiplier = item.portionMultiplier ?? 1;
  const baseIngredients = item.ingredients ?? [];
  const scaledIngredients = scaleIngredients(baseIngredients, multiplier);

  const appSummary = appliances
    .map((a) => `- id: "${a.id}", name: "${a.name}", capacity: ${a.capacity} ${a.slotLabel}(s)`)
    .join('\n');

  const stepsSummary = item.steps
    .map(
      (s) =>
        `- stepId: "${s.id}", title: "${s.title}", durationMin: ${s.durationMin}, applianceId: "${s.applianceId}", slotsRequired: ${s.slotsRequired}${
          s.temperature ? `, temperature: ${s.temperature}°F` : ''
        }`
    )
    .join('\n');

  const prompt = `You are a culinary expert reviewing a scaled recipe for potential issues.

Dish: ${item.name} (${item.course})
Portion Multiplier: ${multiplier}X (from 1X base${item.servings ? `, base servings: ${item.servings}` : ''})

Base 1X Ingredients:
${baseIngredients.length > 0 ? baseIngredients.join('\n') : '(none listed)'}

Scaled ${multiplier}X Ingredients:
${scaledIngredients.length > 0 ? scaledIngredients.join('\n') : '(none listed)'}

Recipe Instructions (1X):
${item.recipeInstructions || item.rawNotes || '(none)'}

Current Scheduled Steps:
${stepsSummary || '(none)'}

Available Appliances:
${appSummary}

Check for any culinary, equipment, or timing issues caused by scaling to ${multiplier}X (e.g., baking pan size/overflow needing 2 pans and extra oven racks, cook/bake time adjustments, seasoning/leavening/alcohol/thickener ratios that shouldn't scale linearly, or resting time changes).

Return ONLY a valid JSON object:
{
  "reviewSummary": "1-2 sentence overall assessment",
  "issues": [
    "Specific issue or tip #1",
    "Specific issue or tip #2"
  ],
  "suggestedStepUpdates": [
    {
      "stepId": "existing-step-id-if-updating",
      "title": "Step title",
      "durationMin": 45,
      "slotsRequired": 2,
      "temperature": 350,
      "reason": "Why this step needs adjustment at ${multiplier}X"
    }
  ]
}
If no step timing/slot changes are needed, return "suggestedStepUpdates": [].`;

  const rawText = await callGeminiWithFallback(apiKey, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.25,
    },
  });

  const parsed = extractJsonObject<ScaledRecipeReviewResult>(rawText);
  return {
    reviewSummary: String(parsed.reviewSummary ?? '').trim(),
    issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
    suggestedStepUpdates: Array.isArray(parsed.suggestedStepUpdates)
      ? parsed.suggestedStepUpdates
      : [],
  };
}

export interface AutoFillDishResult {
  name: string;
  course: string;
  servings?: string;
  sourceUrl?: string;
  ingredients: string[];
  recipeInstructions: string;
  convertedNotes: string;
  prepAheadNotes?: string;
  steps: MealStep[];
}

export async function autoFillDishWithGemini(
  apiKey: string,
  input: string,
  appliances: Appliance[],
  isLibraryMode = false
): Promise<AutoFillDishResult> {
  const urlMatch = input.match(/https?:\/\/\S+/i);
  const detectedUrl = urlMatch ? urlMatch[0] : undefined;

  const categories = Array.from(
    new Set(appliances.map((a) => (a.category || '').trim()).filter(Boolean))
  );
  const appSummary = appliances
    .map(
      (a) =>
        `- id: "${a.id}", name: "${a.name}", category: "${a.category ?? ''}", capacity: ${a.capacity} ${a.slotLabel}(s), hasTemperature: ${a.hasTemperature}`
    )
    .join('\n');

  const prompt = `You are a culinary planning assistant for ThymeLine.
Convert the following dish description or recipe URL into a complete structured dish record.

User Input:
${input.trim()}

Available Appliances:
${appSummary}
${categories.length > 0 ? `Available Categories (use "category:<Name>" for auto-balancing across units, e.g. "category:Oven"): ${categories.join(', ')}` : ''}

Rules:
1. ${
    isLibraryMode
      ? 'This dish is being saved to the reusable Library: for ovens or multi-unit appliances use "category:Oven" (or "" if unsure), while standard prep/stovetop can use "counter" or "stovetop".'
      : 'Use either a specific appliance id above, "category:<Name>" (e.g. "category:Oven" if multiple ovens exist), or "" if unassigned.'
  }
2. Extract or infer realistic ingredients (1X base, one per line), concise recipe instructions, sanitized kitchen convertedNotes, optional prepAheadNotes, and concrete steps.
3. Return ONLY a valid JSON object (no markdown commentary):
{
  "name": "Dish Name",
  "course": "Main | Side | Appetizer | Sauce / Gravy | Bread | Dessert | Beverage | Prep / Other",
  "servings": "e.g., 8 servings",
  "ingredients": ["1 lb green beans", "2 tbsp butter"],
  "recipeInstructions": "Step-by-step recipe method...",
  "convertedNotes": "Concise kitchen summary...",
  "prepAheadNotes": "Optional day-before prep tip...",
  "steps": [
    {
      "id": "unique-kebab-id",
      "title": "Short step title",
      "dish": "Dish Name",
      "durationMin": 30,
      "applianceId": "category:Oven",
      "slotsRequired": 1,
      "temperature": 350,
      "dependencies": [],
      "readyBeforeIds": [],
      "mustFinishByDinner": true,
      "notes": "Key cue"
    }
  ]
}`;

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2 },
  };
  if (detectedUrl) {
    body.tools = [{ url_context: {} }];
  } else {
    body.generationConfig = { responseMimeType: 'application/json', temperature: 0.2 };
  }

  const rawText = await callGeminiWithFallback(apiKey, body);
  const parsed = extractJsonObject<Partial<AutoFillDishResult>>(rawText);
  const dishName = String(parsed.name || 'New Dish').trim();
  const steps = parseImportedSteps(JSON.stringify(parsed.steps ?? []), appliances).map((s) => ({
    ...s,
    dish: dishName,
  }));

  return {
    name: dishName,
    course: String(parsed.course || 'Side').trim(),
    servings: parsed.servings ? String(parsed.servings).trim() : undefined,
    sourceUrl: detectedUrl,
    ingredients: Array.isArray(parsed.ingredients)
      ? parsed.ingredients.map((i) => String(i).trim()).filter(Boolean)
      : [],
    recipeInstructions: String(parsed.recipeInstructions ?? '').trim(),
    convertedNotes: String(parsed.convertedNotes ?? '').trim(),
    prepAheadNotes: parsed.prepAheadNotes ? String(parsed.prepAheadNotes).trim() : undefined,
    steps,
  };
}

export interface ScheduleAdjustmentProposal {
  stepId: string;
  stepTitle: string;
  applianceId?: string;
  applianceMode?: string;
  modePreference?: 'required' | 'preferred';
  durationMin?: number;
  slotsRequired?: number;
  temperature?: number;
  pinnedStartMin?: number | null;
  dependencies?: string[];
  reason: string;
}

export interface NewPreheatStepProposal {
  id: string;
  title: string;
  applianceId: string;
  applianceMode?: string;
  temperature?: number;
  durationMin: number;
  dependentStepIds: string[];
  reason: string;
}

export interface VerifiedScheduleOutcome {
  passesRun: number;
  dinnerDeltaMin: number;
  projectedDinnerMin: number;
  unassignedCount: number;
  delayedCount: number;
  remainingIssues: string[];
}

export interface ScheduleEvaluationResult {
  reply: string;
  recommendedUpdates: ScheduleAdjustmentProposal[];
  newPreheatSteps?: NewPreheatStepProposal[];
  unresolvedQuestions?: string[];
  verifiedOutcome?: VerifiedScheduleOutcome;
}

export async function evaluateAndAdjustScheduleWithGemini(
  apiKey: string,
  conversation: Array<{ role: 'user' | 'model'; text: string }>,
  items: MealItem[],
  scheduledSteps: ScheduledStep[],
  appliances: Appliance[],
  targetDinnerMin: number,
  projectedDinnerMin: number
): Promise<ScheduleEvaluationResult> {
  const appSummary = appliances
    .map(
      (a) =>
        `- id: "${a.id}", name: "${a.name}", category: "${a.category ?? ''}"${
          a.supportedModes?.length ? `, supportedModes: [${a.supportedModes.map((m) => `"${m}"`).join(', ')}]` : ''
        }, capacity: ${a.capacity} ${a.slotLabel}(s)${
          a.hasTemperature ? `, tempTolerance: ±${a.tempTolerance}°F` : ''
        }`
    )
    .join('\n');

  const stepSummary = scheduledSteps
    .map((s) => {
      const loc = s.applianceId
        ? s.applianceId === s.resolvedApplianceId
          ? s.applianceId
          : `${s.applianceId} -> ${s.resolvedApplianceId}`
        : 'UNASSIGNED';
      const lateTag =
        s.mustFinishByDinner && s.endMin > targetDinnerMin
          ? ` [FINISHES ${s.endMin - targetDinnerMin}m PAST SERVE]`
          : '';
      const modeTag = s.applianceMode
        ? `, requestedMode: ${s.applianceMode} (${s.modePreference ?? 'preferred'})${
            s.effectiveMode && s.effectiveMode !== s.applianceMode
              ? ` -> effectiveMode: ${s.effectiveMode}`
              : ''
          }`
        : '';
      const decisionTag = s.modeDecisionNote ? ` [MODE FALLBACK: ${s.modeDecisionNote}]` : '';
      const kindTag = s.stepKind === 'preheat' ? ' [PREHEAT]' : '';
      const depsTag = s.dependencies.length > 0 ? `, deps: [${s.dependencies.join(', ')}]` : '';
      const notesSnippet = s.notes ? `, notes: "${s.notes.slice(0, 140)}"` : '';
      return `- stepId: "${s.id}"${kindTag}, dish: "${s.dish}", title: "${s.title}", status: ${s.status}, time: ${formatTimeMin(
        s.startMin
      )}–${formatTimeMin(s.endMin)} (${s.durationMin}m), location: ${loc}${modeTag}${decisionTag}, slots: ${s.slotsRequired}${
        s.temperature ? `, temp: ${s.temperature}°F` : ''
      }${depsTag}${s.isDelayed ? ` [DELAYED +${s.delayMin}m]` : ''}${lateTag}${
        s.canPrepEarly ? ` [CAN PREP EARLY]` : ''
      }${notesSnippet}`;
    })
    .join('\n');

  const itemSummary = items
    .map((it) => {
      const noteHint = (it.rawNotes || it.convertedNotes || '').trim().slice(0, 160);
      return `- ${it.name} (${it.course}, finish: ${it.finishConstraint.mode}${
        it.manualChangeLog.length > 0 ? `, ${it.manualChangeLog.length} manual edit(s)` : ''
      })${noteHint ? ` — notes: "${noteHint}"` : ''}`;
    })
    .join('\n');

  const systemContext = `You are ThymeLine's interactive culinary schedule optimizer.
Target Serve Time: ${formatTimeMin(targetDinnerMin)}
Current Projected Finish: ${formatTimeMin(projectedDinnerMin)}

Available Appliances:
${appSummary}

Dishes in Event:
${itemSummary}

Current Scheduled Steps:
${stepSummary}

Evaluate the current schedule for:
1. Any UNASSIGNED steps that need an appliance (or "category:<Name>") assigned.
2. Appliance modes & exclusivity: an appliance can only run ONE mode at a time (e.g., Air Fryer vs Toaster on a Toaster Oven, or Convection vs Bake on an Oven). Check each step's notes and dish notes: if a step mentions a mode (like Convection, Bake, Broil, Air Fryer) and doesn't yet have "applianceMode" set, set "applianceMode" (matching an appliance's supportedModes) and "modePreference" ("preferred" or "required"), and assign it to an appliance supporting that mode.
3. Mode trade-off & decision transparency: whenever you choose one mode over another supported/preferred mode (e.g., keeping Convection on Bottom Oven vs. falling back to Bake on Top Oven, or adjusting temperature for Convection vs. Conventional), explicitly explain HOW and WHY in both "reply" and each update's "reason".
4. Standalone Appliance Preheats ([PREHEAT]): if a temperature-controlled appliance (hasTemperature: true) has a cooking step without an existing [PREHEAT] step preceding it (or needs a preheat for a temperature jump), you may propose entries in "newPreheatSteps" (with unique kebab-case "id" like "preheat-oven-375", "applianceId", "applianceMode", "temperature", "durationMin", and "dependentStepIds" listing the cooking step IDs that depend on it), or adjust existing [PREHEAT] steps and "dependencies" in "recommendedUpdates".
5. Oven/appliance rack bottlenecks, temperature conflicts (including preheat/cooldown gaps), or steps that can be spread across multiple appliances in the same category.
6. Steps finishing past Target Serve Time, excessive delays, or dishes that could be prepped early / moved to an earlier slot (use pinnedStartMin in minutes from midnight, or null to unpin).
7. Any specific corrections or preferences the user asks for in the conversation.

IMPORTANT: If there is a conflict you CANNOT resolve automatically without a user decision (e.g., two dishes require incompatible oven temperatures or modes at the exact same time with no free oven, or total prep/cook exceeds available time), list concise questions in "unresolvedQuestions" so the user can choose.

Return ONLY a valid JSON object:
{
  "reply": "Clear, concise summary of conflicts, mode decisions (how & why one mode was chosen over another), preheat recommendations, unassigned steps, and your recommended plan (under 250 words).",
  "recommendedUpdates": [
    {
      "stepId": "exact-step-id-from-above",
      "stepTitle": "Step title",
      "applianceId": "optional-new-appliance-id-or-category:Oven",
      "applianceMode": "optional-mode-name",
      "modePreference": "preferred",
      "durationMin": 30,
      "slotsRequired": 1,
      "temperature": 350,
      "pinnedStartMin": null,
      "dependencies": ["optional-updated-dependency-ids"],
      "reason": "Brief reason for this change, including why this mode/appliance was chosen"
    }
  ],
  "newPreheatSteps": [
    {
      "id": "preheat-oven-375",
      "title": "Preheat Bottom Oven to 375°F",
      "applianceId": "oven",
      "applianceMode": "Convection",
      "temperature": 375,
      "durationMin": 15,
      "dependentStepIds": ["roast-turkey-covered"],
      "reason": "Initial preheat before roasting turkey"
    }
  ],
  "unresolvedQuestions": ["Optional question if a trade-off requires user input"]
}
Only include fields in each update object that actually need to change, and omit or leave "newPreheatSteps" empty if no new preheat steps are needed.`;

  const contents = [
    { role: 'user', parts: [{ text: systemContext }] },
    ...conversation.map((turn) => ({
      role: turn.role,
      parts: [{ text: turn.text }],
    })),
  ];

  const rawText = await callGeminiWithFallback(apiKey, {
    contents,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.25,
    },
  });

  const parsed = extractJsonObject<Partial<ScheduleEvaluationResult>>(rawText);
  return {
    reply: String(parsed.reply ?? '').trim(),
    recommendedUpdates: Array.isArray(parsed.recommendedUpdates)
      ? parsed.recommendedUpdates
      : [],
    newPreheatSteps: Array.isArray(parsed.newPreheatSteps)
      ? parsed.newPreheatSteps
          .filter((p) => p && typeof p.id === 'string' && typeof p.applianceId === 'string')
          .map((p) => ({
            id: String(p.id).trim(),
            title: String(p.title || 'Preheat Appliance').trim(),
            applianceId: String(p.applianceId).trim(),
            applianceMode: p.applianceMode ? String(p.applianceMode).trim() : undefined,
            temperature:
              p.temperature !== undefined && p.temperature !== null
                ? Number(p.temperature)
                : undefined,
            durationMin: Math.max(5, Math.round(Number(p.durationMin) || 15)),
            dependentStepIds: Array.isArray(p.dependentStepIds)
              ? p.dependentStepIds.map(String)
              : [],
            reason: String(p.reason || 'Appliance preheat').trim(),
          }))
      : [],
    unresolvedQuestions: Array.isArray(parsed.unresolvedQuestions)
      ? parsed.unresolvedQuestions.map((q) => String(q).trim()).filter(Boolean)
      : [],
  };
}

function applyScheduleUpdatesToSteps(
  steps: MealStep[],
  updates: ScheduleAdjustmentProposal[],
  newPreheats: NewPreheatStepProposal[] = [],
  appliances: Appliance[] = []
): MealStep[] {
  const appMap = new Map(appliances.map((a) => [a.id, a]));
  const existingIds = new Set(steps.map((s) => s.id));
  const extraSteps: MealStep[] = newPreheats
    .filter((p) => !existingIds.has(p.id))
    .map((p) => {
      const app = appMap.get(p.applianceId);
      return {
        id: p.id,
        title: p.title,
        dish: 'Appliance Preheats',
        stepKind: 'preheat',
        durationMin: Math.max(5, Math.round(p.durationMin)),
        applianceId: p.applianceId,
        applianceMode: p.applianceMode,
        modePreference: p.applianceMode ? 'preferred' : undefined,
        slotsRequired: app?.capacity ?? 1,
        temperature: p.temperature,
        dependencies: [],
        readyBeforeIds: [],
        mustFinishByDinner: false,
        requiresTimer: true,
        notes: p.reason,
        status: 'pending',
        remainingSec: Math.max(5, Math.round(p.durationMin)) * 60,
        addedMin: 0,
      };
    });

  const extraDepsForStep = new Map<string, string[]>();
  for (const p of newPreheats) {
    for (const depTargetId of p.dependentStepIds) {
      const list = extraDepsForStep.get(depTargetId) ?? [];
      if (!list.includes(p.id)) list.push(p.id);
      extraDepsForStep.set(depTargetId, list);
    }
  }

  const updateMap = new Map(updates.map((u) => [u.stepId, u]));
  const updatedExisting = steps.map((s) => {
    const u = updateMap.get(s.id);
    const addedDeps = extraDepsForStep.get(s.id) ?? [];
    if (!u && addedDeps.length === 0) return s;
    const baseDeps = u?.dependencies ?? s.dependencies;
    const mergedDeps = Array.from(new Set([...baseDeps, ...addedDeps]));
    return {
      ...s,
      ...(u?.applianceId !== undefined ? { applianceId: u.applianceId } : {}),
      ...(u?.applianceMode !== undefined ? { applianceMode: u.applianceMode || undefined } : {}),
      ...(u?.modePreference !== undefined ? { modePreference: u.modePreference } : {}),
      ...(u?.pinnedStartMin !== undefined
        ? { pinnedStartMin: u.pinnedStartMin === null ? undefined : u.pinnedStartMin }
        : {}),
      ...(u?.durationMin !== undefined ? { durationMin: Math.max(1, Math.round(u.durationMin)) } : {}),
      ...(u?.slotsRequired !== undefined
        ? { slotsRequired: Math.max(1, Math.round(u.slotsRequired)) }
        : {}),
      ...(u?.temperature !== undefined
        ? { temperature: u.temperature === null ? undefined : u.temperature }
        : {}),
      dependencies: mergedDeps,
    };
  });

  return [...updatedExisting, ...extraSteps];
}

function collectRemainingScheduleIssues(
  sim: ReturnType<typeof computeSchedule>,
  targetDinnerMin: number
): string[] {
  const issues: string[] = [];
  if (sim.cycleError) {
    issues.push(sim.cycleError);
  }
  if (sim.dinnerDeltaMin > 0) {
    issues.push(
      `Projected finish is ${formatTimeMin(sim.projectedDinnerMin)} (${sim.dinnerDeltaMin}m past target ${formatTimeMin(targetDinnerMin)}).`
    );
  }
  const unassigned = sim.steps.filter((s) => !s.resolvedApplianceId);
  if (unassigned.length > 0) {
    issues.push(
      `${unassigned.length} step(s) still unassigned: ${unassigned.map((s) => s.title).join(', ')}.`
    );
  }
  const lateSteps = sim.steps.filter((s) => s.mustFinishByDinner && s.endMin > targetDinnerMin);
  if (lateSteps.length > 0 && sim.dinnerDeltaMin <= 0) {
    issues.push(
      `${lateSteps.length} step(s) finish past serve time: ${lateSteps.map((s) => s.title).join(', ')}.`
    );
  }
  const delayed = sim.steps.filter((s) => s.delayMin >= 15);
  if (delayed.length > 0) {
    issues.push(
      `${delayed.length} step(s) delayed ≥15m: ${delayed
        .map((s) => `${s.title} (+${s.delayMin}m)`)
        .join(', ')}.`
    );
  }
  return issues;
}

const MAX_VERIFY_PASSES = 3;

/**
 * Evaluates the schedule with Gemini, then simulates the proposed updates locally
 * using ThymeLine's deterministic scheduler. If the updates introduce new delays,
 * late finishes, or conflicts, automatically feeds the simulated result back to
 * Gemini (up to MAX_VERIFY_PASSES) until resolved or surfaced to the user.
 */
export async function evaluateAndVerifyScheduleWithGemini(
  apiKey: string,
  conversation: Array<{ role: 'user' | 'model'; text: string }>,
  items: MealItem[],
  baseSteps: MealStep[],
  appliances: Appliance[],
  targetDinnerMin: number,
  nowMin?: number,
  onProgress?: (statusText: string) => void
): Promise<ScheduleEvaluationResult> {
  let workingSteps = baseSteps.map((s) => ({ ...s }));
  const mergedUpdates = new Map<string, ScheduleAdjustmentProposal>();
  const mergedPreheats = new Map<string, NewPreheatStepProposal>();
  let workingConversation = [...conversation];
  let latestReply = '';
  let latestQuestions: string[] = [];
  let passesRun = 0;
  let latestSim = computeSchedule(workingSteps, appliances, targetDinnerMin, nowMin);

  for (let pass = 1; pass <= MAX_VERIFY_PASSES; pass++) {
    passesRun = pass;
    onProgress?.(
      pass === 1
        ? 'Evaluating schedule with Gemini (pass 1/3)...'
        : `Re-checking simulated schedule (pass ${pass}/${MAX_VERIFY_PASSES})...`
    );

    const res = await evaluateAndAdjustScheduleWithGemini(
      apiKey,
      workingConversation,
      items,
      latestSim.steps,
      appliances,
      targetDinnerMin,
      latestSim.projectedDinnerMin
    );

    latestReply = res.reply;
    if (res.unresolvedQuestions?.length) {
      latestQuestions = res.unresolvedQuestions;
    }

    for (const u of res.recommendedUpdates) {
      const prev = mergedUpdates.get(u.stepId);
      mergedUpdates.set(u.stepId, prev ? { ...prev, ...u } : u);
    }
    for (const p of res.newPreheatSteps ?? []) {
      const prev = mergedPreheats.get(p.id);
      mergedPreheats.set(p.id, prev ? { ...prev, ...p } : p);
    }

    workingSteps = applyScheduleUpdatesToSteps(
      baseSteps,
      Array.from(mergedUpdates.values()),
      Array.from(mergedPreheats.values()),
      appliances
    );
    latestSim = computeSchedule(workingSteps, appliances, targetDinnerMin, nowMin);
    const remainingIssues = collectRemainingScheduleIssues(latestSim, targetDinnerMin);

    if (
      remainingIssues.length === 0 ||
      (res.recommendedUpdates.length === 0 && (res.newPreheatSteps?.length ?? 0) === 0)
    ) {
      break;
    }

    if (pass < MAX_VERIFY_PASSES) {
      workingConversation = [
        ...workingConversation,
        { role: 'model', text: res.reply },
        {
          role: 'user',
          text: `I simulated your proposed updates in ThymeLine's deterministic scheduler, and these issues STILL remain:\n${remainingIssues
            .map((i) => `- ${i}`)
            .join('\n')}\nPlease provide follow-up adjustments to resolve these remaining issues (without breaking earlier fixes), or explain the trade-off in "unresolvedQuestions" if it requires my decision.`,
        },
      ];
    }
  }

  const finalIssues = collectRemainingScheduleIssues(latestSim, targetDinnerMin);
  return {
    reply: latestReply,
    recommendedUpdates: Array.from(mergedUpdates.values()),
    newPreheatSteps: Array.from(mergedPreheats.values()),
    unresolvedQuestions: latestQuestions,
    verifiedOutcome: {
      passesRun,
      dinnerDeltaMin: latestSim.dinnerDeltaMin,
      projectedDinnerMin: latestSim.projectedDinnerMin,
      unassignedCount: latestSim.steps.filter((s) => !s.resolvedApplianceId).length,
      delayedCount: latestSim.steps.filter((s) => s.isDelayed).length,
      remainingIssues: finalIssues,
    },
  };
}
