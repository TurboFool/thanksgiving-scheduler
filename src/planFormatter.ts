import type { Appliance, MealEvent, MealItem, ScheduledStep } from './types';
import { formatDuration, formatTimeMin } from './scheduler';
import { scaleIngredients, scaleServingsLabel } from './recipeScaler';

export type PlanViewMode = 'chronological' | 'per_dish' | 'combined';

export interface PlanFormatOptions {
  mode: PlanViewMode;
  includeCheckboxes: boolean;
  includeRecipesAndNotes: boolean;
  includeCompleted: boolean;
}

function getApplianceLabel(step: ScheduledStep, appMap: Map<string, Appliance>): string {
  const resolved = step.resolvedApplianceId || step.applianceId;
  if (!resolved) return 'Needs Location';
  if (resolved.startsWith('category:')) return `Any ${resolved.slice('category:'.length)}`;
  return appMap.get(resolved)?.name ?? resolved;
}

function formatStepLine(
  s: ScheduledStep,
  appMap: Map<string, Appliance>,
  stepById: Map<string, ScheduledStep>,
  options: PlanFormatOptions
): string[] {
  const lines: string[] = [];
  const box = options.includeCheckboxes ? (s.status === 'done' ? '[x] ' : '[ ] ') : '';
  const timeRange = `${formatTimeMin(s.startMin)} – ${formatTimeMin(s.endMin)}`;
  const dur = formatDuration(s.endMin - s.startMin);
  const appLabel = getApplianceLabel(s, appMap);
  const temp = s.temperature !== undefined ? ` @ ${s.temperature}°F` : '';
  const timerTag = s.requiresTimer === false ? ' [Start Alert]' : '';
  const dishTag = options.mode !== 'per_dish' && s.dish ? ` (${s.dish})` : '';

  lines.push(`${box}${timeRange} (${dur}) — ${s.title}${dishTag} · ${appLabel}${temp}${timerTag}`);

  if (options.includeRecipesAndNotes) {
    if (s.relativeDeps && s.relativeDeps.length > 0) {
      const relStr = s.relativeDeps
        .map((r) => {
          const target = stepById.get(r.stepId)?.title ?? r.stepId;
          const anchorLabel =
            r.anchor === 'before_end'
              ? 'before end of'
              : r.anchor === 'after_start'
              ? 'after start of'
              : 'after end of';
          return `${r.offsetMin}m ${anchorLabel} "${target}"`;
        })
        .join('; ');
      lines.push(`    Timing: Start ${relStr}`);
    }
    if (s.canPrepEarly) {
      const windowStr =
        s.earlyPrepMaxBefore !== undefined && s.earlyPrepMinBefore !== undefined
          ? `${formatDuration(s.earlyPrepMinBefore)}–${formatDuration(s.earlyPrepMaxBefore)} early`
          : 'Can be prepped early';
      lines.push(
        `    Early Prep: ${windowStr}${s.preservationNotes ? ` — ${s.preservationNotes}` : ''}`
      );
    }
    if (s.notes) {
      lines.push(`    Note: ${s.notes}`);
    }
  }

  return lines;
}

function formatDishSection(
  item: MealItem,
  dishSteps: ScheduledStep[],
  appMap: Map<string, Appliance>,
  stepById: Map<string, ScheduledStep>,
  options: PlanFormatOptions
): string[] {
  const lines: string[] = [];
  const mult = item.portionMultiplier && item.portionMultiplier > 0 ? item.portionMultiplier : 1;
  const scaledServings = item.servings
    ? scaleServingsLabel(item.servings, mult)
    : undefined;
  const headerMeta = [
    item.course,
    scaledServings,
    mult !== 1 ? `${mult}X portions` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  lines.push(`--- ${item.name.toUpperCase()}${headerMeta ? ` (${headerMeta})` : ''} ---`);

  if (options.includeRecipesAndNotes) {
    if (item.sourceUrl) {
      lines.push(`Source: ${item.sourceUrl}`);
    }
    if (item.ingredients && item.ingredients.length > 0) {
      const scaled = scaleIngredients(item.ingredients, mult);
      lines.push(`Ingredients${mult !== 1 ? ` (${mult}X)` : ''}:`);
      for (const ing of scaled) {
        lines.push(`  • ${ing}`);
      }
    }
    const instructions =
      item.recipeInstructions?.trim() || item.convertedNotes?.trim() || item.rawNotes?.trim();
    if (instructions) {
      lines.push('Instructions / Notes:');
      for (const l of instructions.split('\n')) {
        if (l.trim()) lines.push(`  ${l.trim()}`);
      }
    }
    if (item.prepAheadNotes?.trim()) {
      lines.push(`Prep-Ahead: ${item.prepAheadNotes.trim()}`);
    }
  }

  lines.push('Scheduled Steps:');
  if (dishSteps.length === 0) {
    lines.push('  (No active steps)');
  } else {
    for (const s of dishSteps) {
      for (const l of formatStepLine(s, appMap, stepById, options)) {
        lines.push(`  ${l}`);
      }
    }
  }

  return lines;
}

export function buildPlainTextPlan(
  event: MealEvent,
  scheduledSteps: ScheduledStep[],
  appliances: Appliance[],
  options: PlanFormatOptions
): string {
  const appMap = new Map(appliances.map((a) => [a.id, a]));
  const stepById = new Map(scheduledSteps.map((s) => [s.id, s]));

  const visibleSteps = options.includeCompleted
    ? scheduledSteps
    : scheduledSteps.filter((s) => s.status !== 'done');
  const sortedChrono = [...visibleSteps].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.title.localeCompare(b.title)
  );

  const lines: string[] = [];
  lines.push(`THYMELINE KITCHEN PLAN — ${event.name.toUpperCase()}`);
  lines.push(`Target Serve Time: ${formatTimeMin(event.targetDinnerMin)}`);
  if (sortedChrono.length > 0) {
    lines.push(`First Step Starts: ${formatTimeMin(sortedChrono[0].startMin)}`);
  }
  lines.push(`Dishes: ${event.mealItems.length} · Steps Shown: ${sortedChrono.length}`);
  lines.push('='.repeat(64));

  if (options.mode === 'chronological' || options.mode === 'combined') {
    lines.push('');
    lines.push('CHRONOLOGICAL TIMELINE');
    lines.push('-'.repeat(22));
    if (sortedChrono.length === 0) {
      lines.push('(No steps to display)');
    } else {
      for (const s of sortedChrono) {
        lines.push(...formatStepLine(s, appMap, stepById, options));
      }
    }
  }

  if (options.mode === 'per_dish' || options.mode === 'combined') {
    lines.push('');
    lines.push('PER-DISH RECIPES & STEPS');
    lines.push('-'.repeat(24));
    if (event.mealItems.length === 0) {
      lines.push('(No dishes in this event)');
    } else {
      const stepsByDish = new Map<string, ScheduledStep[]>();
      for (const s of sortedChrono) {
        const arr = stepsByDish.get(s.dish) ?? [];
        arr.push(s);
        stepsByDish.set(s.dish, arr);
      }
      for (const item of event.mealItems) {
        lines.push('');
        const dishSteps = stepsByDish.get(item.name) ?? [];
        lines.push(...formatDishSection(item, dishSteps, appMap, stepById, options));
      }
    }
  }

  return lines.join('\n');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPrintableHtmlPlan(
  event: MealEvent,
  scheduledSteps: ScheduledStep[],
  appliances: Appliance[],
  options: PlanFormatOptions
): string {
  const plainText = buildPlainTextPlan(event, scheduledSteps, appliances, options);
  const appMap = new Map(appliances.map((a) => [a.id, a]));
  const stepById = new Map(scheduledSteps.map((s) => [s.id, s]));

  const visibleSteps = options.includeCompleted
    ? scheduledSteps
    : scheduledSteps.filter((s) => s.status !== 'done');
  const sortedChrono = [...visibleSteps].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin || a.title.localeCompare(b.title)
  );

  const renderStepHtml = (s: ScheduledStep, showDish: boolean) => {
    const appLabel = getApplianceLabel(s, appMap);
    const temp = s.temperature !== undefined ? ` · ${s.temperature}°F` : '';
    const timerTag = s.requiresTimer === false ? ' · Start Alert' : '';
    const checkHtml = options.includeCheckboxes
      ? `<span class="box">${s.status === 'done' ? '☑' : '☐'}</span>`
      : '';
    const notesParts: string[] = [];
    if (options.includeRecipesAndNotes) {
      if (s.relativeDeps?.length) {
        const relStr = s.relativeDeps
          .map((r) => {
            const target = stepById.get(r.stepId)?.title ?? r.stepId;
            const anchorLabel =
              r.anchor === 'before_end'
                ? 'before end of'
                : r.anchor === 'after_start'
                ? 'after start of'
                : 'after end of';
            return `${r.offsetMin}m ${anchorLabel} "${target}"`;
          })
          .join('; ');
        notesParts.push(`<div><strong>Timing:</strong> Start ${escapeHtml(relStr)}</div>`);
      }
      if (s.canPrepEarly) {
        notesParts.push(
          `<div><strong>Early Prep:</strong> ${escapeHtml(
            s.preservationNotes || 'Can be prepped early & held'
          )}</div>`
        );
      }
      if (s.notes) {
        notesParts.push(`<div><strong>Note:</strong> ${escapeHtml(s.notes)}</div>`);
      }
    }

    return `<li class="step-row ${s.status === 'done' ? 'done' : ''}">
      <div class="step-main">
        ${checkHtml}
        <span class="time">${escapeHtml(formatTimeMin(s.startMin))} – ${escapeHtml(
      formatTimeMin(s.endMin)
    )}</span>
        <span class="dur">(${escapeHtml(formatDuration(s.endMin - s.startMin))})</span>
        <strong class="title">${escapeHtml(s.title)}</strong>
        ${showDish && s.dish ? `<span class="dish-tag">${escapeHtml(s.dish)}</span>` : ''}
        <span class="meta">${escapeHtml(appLabel + temp + timerTag)}</span>
      </div>
      ${notesParts.length > 0 ? `<div class="step-notes">${notesParts.join('')}</div>` : ''}
    </li>`;
  };

  const chronoHtml =
    options.mode === 'chronological' || options.mode === 'combined'
      ? `<section>
          <h2>Chronological Timeline</h2>
          ${
            sortedChrono.length === 0
              ? '<p class="muted">No steps to display.</p>'
              : `<ul class="step-list">${sortedChrono
                  .map((s) => renderStepHtml(s, true))
                  .join('')}</ul>`
          }
        </section>`
      : '';

  let dishesHtml = '';
  if (options.mode === 'per_dish' || options.mode === 'combined') {
    const stepsByDish = new Map<string, ScheduledStep[]>();
    for (const s of sortedChrono) {
      const arr = stepsByDish.get(s.dish) ?? [];
      arr.push(s);
      stepsByDish.set(s.dish, arr);
    }

    dishesHtml = `<section>
      <h2>Per-Dish Recipes &amp; Steps</h2>
      ${event.mealItems
        .map((item) => {
          const mult =
            item.portionMultiplier && item.portionMultiplier > 0 ? item.portionMultiplier : 1;
          const scaledServings = item.servings
            ? scaleServingsLabel(item.servings, mult)
            : undefined;
          const meta = [item.course, scaledServings, mult !== 1 ? `${mult}X` : undefined]
            .filter(Boolean)
            .join(' · ');
          const dishSteps = stepsByDish.get(item.name) ?? [];
          const scaledIngs =
            options.includeRecipesAndNotes && item.ingredients?.length
              ? scaleIngredients(item.ingredients, mult)
              : [];
          const instr = options.includeRecipesAndNotes
            ? item.recipeInstructions?.trim() || item.convertedNotes?.trim() || item.rawNotes?.trim()
            : '';

          return `<article class="dish-card">
            <h3>${escapeHtml(item.name)} <span class="dish-meta">${escapeHtml(meta)}</span></h3>
            ${
              scaledIngs.length > 0
                ? `<div class="dish-block"><strong>Ingredients${
                    mult !== 1 ? ` (${mult}X)` : ''
                  }:</strong><ul>${scaledIngs
                    .map((i) => `<li>${escapeHtml(i)}</li>`)
                    .join('')}</ul></div>`
                : ''
            }
            ${
              instr
                ? `<div class="dish-block"><strong>Instructions / Notes:</strong><p class="pre-wrap">${escapeHtml(
                    instr
                  )}</p></div>`
                : ''
            }
            ${
              options.includeRecipesAndNotes && item.prepAheadNotes?.trim()
                ? `<div class="dish-block"><strong>Prep-Ahead:</strong> ${escapeHtml(
                    item.prepAheadNotes.trim()
                  )}</div>`
                : ''
            }
            <div class="dish-block">
              <strong>Scheduled Steps:</strong>
              ${
                dishSteps.length === 0
                  ? '<p class="muted">No active steps.</p>'
                  : `<ul class="step-list">${dishSteps
                      .map((s) => renderStepHtml(s, false))
                      .join('')}</ul>`
              }
            </div>
          </article>`;
        })
        .join('')}
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(event.name)} — ThymeLine Plan</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #1f241f; margin: 24px auto; max-width: 860px; padding: 0 16px; line-height: 1.45; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #2f4f3e; padding-bottom: 12px; margin-bottom: 18px; }
  h1 { margin: 0 0 4px; font-size: 1.4rem; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid #d5dcd5; padding-bottom: 4px; margin: 22px 0 10px; }
  h3 { margin: 0 0 8px; font-size: 1.02rem; }
  .dish-meta { font-weight: 400; font-size: 0.85rem; color: #5b665b; margin-left: 6px; }
  .header-meta { font-size: 0.9rem; color: #4a554a; }
  .actions { display: flex; gap: 8px; }
  button { padding: 7px 12px; border-radius: 6px; border: 1px solid #2f4f3e; background: #2f4f3e; color: #fff; font-weight: 600; cursor: pointer; font-size: 0.85rem; }
  button.sec { background: #fff; color: #2f4f3e; }
  .step-list { list-style: none; padding: 0; margin: 6px 0 0; }
  .step-row { padding: 6px 8px; border-bottom: 1px solid #ecefe9; }
  .step-row.done { opacity: 0.6; text-decoration: line-through; }
  .step-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
  .box { font-size: 1rem; margin-right: 2px; }
  .time { font-family: ui-monospace, monospace; font-weight: 600; font-size: 0.88rem; }
  .dur { color: #5b665b; font-size: 0.84rem; }
  .dish-tag { background: #eef3ee; padding: 1px 6px; border-radius: 4px; font-size: 0.8rem; }
  .meta { color: #4a554a; font-size: 0.86rem; }
  .step-notes { margin: 4px 0 0 24px; font-size: 0.84rem; color: #4a554a; }
  .dish-card { border: 1px solid #d5dcd5; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; page-break-inside: avoid; }
  .dish-block { margin-top: 8px; font-size: 0.9rem; }
  .dish-block ul { margin: 4px 0 0 18px; padding: 0; }
  .pre-wrap { white-space: pre-wrap; margin: 4px 0 0; }
  .muted { color: #6b746b; font-size: 0.88rem; }
  @media print {
    .actions { display: none; }
    body { margin: 0; max-width: none; }
  }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(event.name)}</h1>
      <div class="header-meta">
        Serve Time: <strong>${escapeHtml(formatTimeMin(event.targetDinnerMin))}</strong>
        ${
          sortedChrono.length > 0
            ? ` · First Step: <strong>${escapeHtml(formatTimeMin(sortedChrono[0].startMin))}</strong>`
            : ''
        }
        · ${event.mealItems.length} Dish(es) · ${sortedChrono.length} Step(s)
      </div>
    </div>
    <div class="actions">
      <button type="button" class="sec" onclick="navigator.clipboard.writeText(document.getElementById('plain-text').textContent).then(() => { this.textContent = 'Copied!'; setTimeout(() => this.textContent = 'Copy Plain Text', 2000); })">Copy Plain Text</button>
      <button type="button" onclick="window.print()">Print</button>
    </div>
  </header>
  ${chronoHtml}
  ${dishesHtml}
  <pre id="plain-text" style="display:none;">${escapeHtml(plainText)}</pre>
</body>
</html>`;
}
