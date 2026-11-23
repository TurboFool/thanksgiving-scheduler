import type { Appliance, MealItem, MealStep, ScheduledStep } from './types';
import { formatTimeMin } from './scheduler';
import { scaleIngredients } from './recipeScaler';

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
    const applianceId = validAppIds.has(item.applianceId) ? item.applianceId : fallbackAppId;
    const temp =
      item.temperature !== null && item.temperature !== undefined && item.temperature !== ''
        ? Number(item.temperature)
        : undefined;

    return {
      id: String(item.id || `step-${idx + 1}`),
      title: String(item.title || `Step ${idx + 1}`),
      dish: String(item.dish || 'General'),
      durationMin,
      applianceId,
      slotsRequired: Math.max(1, Number(item.slotsRequired) || 1),
      temperature: Number.isFinite(temp) ? temp : undefined,
      dependencies: Array.isArray(item.dependencies) ? item.dependencies.map(String) : [],
      readyBeforeIds: Array.isArray(item.readyBeforeIds) ? item.readyBeforeIds.map(String) : [],
      mustFinishByDinner: item.mustFinishByDinner !== false,
      notes: item.notes ? String(item.notes) : undefined,
      status: 'pending',
      remainingSec: durationMin * 60,
      addedMin: 0,
    };
  });
}

export const GEMINI_MODELS = [
  'gemini-4-hydrogen',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
] as const;

async function callGeminiWithFallback(
  apiKey: string,
  body: Record<string, unknown>
): Promise<string> {
  const key = encodeURIComponent(apiKey.trim());
  let lastError = 'Gemini API request failed.';

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned an empty response.');
      }
      return text;
    }

    const errText = await res.text();
    lastError = `Gemini API error (${res.status} on ${model}): ${errText.slice(0, 200)}`;

    // Retry with next model on transient overload (503), rate limit (429), or unavailable model (404)
    if (res.status === 503 || res.status === 429 || res.status === 404) {
      continue;
    }
    throw new Error(lastError);
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
  otherItems: MealItem[] = []
): Promise<ProcessedMealItemResult> {
  const appSummary = appliances
    .map(
      (a) =>
        `- id: "${a.id}", name: "${a.name}", capacity: ${a.capacity} ${a.slotLabel}(s), hasTemperature: ${a.hasTemperature}${
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

  const manualLogText =
    item.manualChangeLog.length > 0
      ? `\nManual edits logged since last AI processing (MUST be respected/preserved):\n${item.manualChangeLog
          .map((m) => `- [${m.field}] ${m.summary}`)
          .join('\n')}\n`
      : '';

  const currentStepsText =
    item.steps.length > 0
      ? `\nCurrent steps on this item:\n${JSON.stringify(
          item.steps.map((s) => ({
            id: s.id,
            title: s.title,
            durationMin: s.durationMin,
            applianceId: s.applianceId,
            slotsRequired: s.slotsRequired,
            temperature: s.temperature ?? null,
            dependencies: s.dependencies,
            readyBeforeIds: s.readyBeforeIds,
            mustFinishByDinner: s.mustFinishByDinner,
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
3. "steps": A JSON array of concrete cooking/prep steps for this dish.

Dish Name: ${item.name}
Course: ${item.course}
${item.servings ? `Servings: ${item.servings}\n` : ''}${
    item.sourceUrl ? `Source URL: ${item.sourceUrl}\n` : ''
  }
Primary Raw Notes / Recipe:
${item.rawNotes || '(No raw notes provided yet — infer standard steps from the dish name)'}
${item.convertedNotes ? `\nPrevious Converted Notes:\n${item.convertedNotes}\n` : ''}${currentStepsText}${manualLogText}
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
      "durationMin": 30,
      "applianceId": "oven",
      "slotsRequired": 1,
      "temperature": 350,
      "dependencies": [],
      "readyBeforeIds": [],
      "mustFinishByDinner": true,
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

  const steps = parseImportedSteps(JSON.stringify(parsed.steps ?? []), appliances).map((s) => ({
    ...s,
    dish: item.name,
  }));

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
