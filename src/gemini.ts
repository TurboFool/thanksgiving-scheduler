import type { Appliance, MealStep, ScheduledStep } from './types';
import { formatTimeMin } from './scheduler';

export function buildGeminiChatPrompt(appliances: Appliance[], menuText: string): string {
  const appSummary = appliances
    .map(
      (a) =>
        `- id: "${a.id}", name: "${a.name}", capacity: ${a.capacity} ${a.slotLabel}(s), hasTemperature: ${a.hasTemperature}${
          a.hasTemperature ? `, tolerance: ±${a.tempTolerance}°F` : ''
        }`
    )
    .join('\n');

  return `You are a Thanksgiving culinary scheduling assistant. Convert the following menu into a structured JSON array of cooking steps.

Available appliances:
${appSummary}

Menu / Notes:
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
4. Set "slotsRequired" realistically (e.g. whole turkey uses 2 oven racks; a casserole uses 1 rack).
5. Return ONLY the JSON array.`;
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

export async function generateScheduleWithGemini(
  apiKey: string,
  menuText: string,
  appliances: Appliance[]
): Promise<MealStep[]> {
  const prompt = buildGeminiChatPrompt(appliances, menuText);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
    apiKey.trim()
  )}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }
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

  const prompt = `We are preparing Thanksgiving dinner. Target dinner time is ${formatTimeMin(
    targetDinnerMin
  )}, but our current projected finish time is ${formatTimeMin(projectedDinnerMin)} (${
    delta > 0 ? `+${delta} minutes behind schedule` : 'on time'
  }).

Appliances available:
${appLines}

Current Schedule:
${stepLines}

Give 3 concise, practical, culinary-sound suggestions to recover time or reduce oven/appliance bottlenecks right now (e.g., moving a side to the air fryer/microwave, par-cooking on stovetop, adjusting resting time, or combining compatible temperatures). Keep it under 180 words with bullet points.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
    apiKey.trim()
  )}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'No suggestions returned.';
}
