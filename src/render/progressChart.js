// Planned-vs-actual accomplishment S-curve. Hand-rolled SVG (no chart lib
// needed for two lines) — themed entirely off the app's existing CSS custom
// properties so it follows light/dark automatically.
import { esc, fmtDate, todayISO } from '../utils.js';
import { plannedPercentAt } from '../progress.js';
import { ICONS } from '../icons.js';

const W = 720;
const H = 260;
const PAD = { top: 20, right: 20, bottom: 34, left: 42 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function domain(project, updates) {
  const start = new Date(project.start_date + 'T00:00:00').getTime();
  const target = new Date(project.target_end_date + 'T00:00:00').getTime();
  const today = new Date(todayISO() + 'T00:00:00').getTime();
  const lastUpdateT = updates.length
    ? Math.max(...updates.map((u) => new Date(u.update_date + 'T00:00:00').getTime()))
    : start;
  return { minT: start, maxT: Math.max(target, today, lastUpdateT), start, target, today };
}

function xOf(t, minT, maxT) {
  if (maxT <= minT) return PAD.left;
  return PAD.left + ((t - minT) / (maxT - minT)) * PLOT_W;
}
function yOf(pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  return PAD.top + PLOT_H - (clamped / 100) * PLOT_H;
}

// Returns {html, wire(container)} — wire() attaches the hover crosshair/tooltip
// after the HTML has been inserted into the DOM.
export function buildProgressChart(project, updates) {
  if (!project.start_date || !project.target_end_date) {
    return {
      html: `<div class="card empty">${ICONS.trend}<div class="lead">Set a start and target completion date</div>Planned-vs-actual accomplishment needs both — edit the project to add them.</div>`,
      wire: () => {},
    };
  }

  const sorted = [...updates].sort((a, b) => (a.update_date < b.update_date ? -1 : 1));
  const { minT, maxT, start, target } = domain(project, sorted);

  const plannedRawPts = [[start, 0], [target, 100]];
  if (maxT > target) plannedRawPts.push([maxT, 100]);
  const plannedPath = plannedRawPts.map(([t, p]) => `${xOf(t, minT, maxT)},${yOf(p)}`).join(' ');

  const actualRawPts = sorted.map((u) => [new Date(u.update_date + 'T00:00:00').getTime(), Number(u.percent_complete)]);
  const actualPath = actualRawPts.map(([t, p]) => `${xOf(t, minT, maxT)},${yOf(p)}`).join(' ');

  const gridY = [0, 25, 50, 75, 100];
  const todayT = new Date(todayISO() + 'T00:00:00').getTime();
  const todayX = xOf(todayT, minT, maxT);
  const lastActual = actualRawPts[actualRawPts.length - 1];

  const html = `
    <div class="progress-chart-wrap" data-progress-chart>
      <svg viewBox="0 0 ${W} ${H}" class="progress-chart" role="img" aria-label="Planned versus actual percent accomplishment over time" preserveAspectRatio="xMidYMid meet">
        ${gridY
          .map(
            (p) =>
              `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yOf(p)}" y2="${yOf(p)}" class="pc-grid"/>
               <text x="${PAD.left - 8}" y="${yOf(p) + 4}" class="pc-axis-label" text-anchor="end">${p}%</text>`
          )
          .join('')}
        <line x1="${PAD.left}" x2="${PAD.left}" y1="${PAD.top}" y2="${H - PAD.bottom}" class="pc-axis"/>
        <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${H - PAD.bottom}" y2="${H - PAD.bottom}" class="pc-axis"/>
        <line x1="${todayX}" x2="${todayX}" y1="${PAD.top}" y2="${H - PAD.bottom}" class="pc-today"/>
        <text x="${todayX}" y="${PAD.top - 6}" class="pc-axis-label" text-anchor="middle">Today</text>
        <polyline points="${plannedPath}" class="pc-planned"/>
        ${actualRawPts.length > 1 ? `<polyline points="${actualPath}" class="pc-actual"/>` : ''}
        ${actualRawPts.map(([t, p]) => `<circle cx="${xOf(t, minT, maxT)}" cy="${yOf(p)}" r="4" class="pc-actual-dot"/>`).join('')}
        ${
          lastActual
            ? `<text x="${xOf(lastActual[0], minT, maxT)}" y="${yOf(lastActual[1]) - 12}" class="pc-end-label pc-end-actual" text-anchor="middle">${Math.round(lastActual[1])}%</text>`
            : ''
        }
        <text x="${xOf(target, minT, maxT) - 6}" y="${yOf(100) - 10}" class="pc-end-label pc-end-planned" text-anchor="end">Target 100%</text>
        <text x="${PAD.left}" y="${H - PAD.bottom + 20}" class="pc-axis-label" text-anchor="start">${esc(fmtDate(project.start_date))}</text>
        <text x="${W - PAD.right}" y="${H - PAD.bottom + 20}" class="pc-axis-label" text-anchor="end">${esc(fmtDate(project.target_end_date))}</text>
        <g class="pc-hover" hidden>
          <line x1="0" x2="0" y1="${PAD.top}" y2="${H - PAD.bottom}" class="pc-crosshair"/>
          <circle r="4.5" class="pc-hover-dot pc-hover-planned"/>
          <circle r="4.5" class="pc-hover-dot pc-hover-actual"/>
        </g>
      </svg>
      <div class="pc-tooltip" hidden></div>
      <div class="chart-legend">
        <span class="legend-item"><span class="legend-swatch planned"></span>Planned</span>
        <span class="legend-item"><span class="legend-swatch actual"></span>Actual</span>
      </div>
    </div>
  `;

  const wire = (root) => {
    const wrap = root.querySelector('[data-progress-chart]');
    if (!wrap) return;
    const svg = wrap.querySelector('svg');
    const hoverG = wrap.querySelector('.pc-hover');
    const crosshair = wrap.querySelector('.pc-crosshair');
    const hoverPlanned = wrap.querySelector('.pc-hover-planned');
    const hoverActual = wrap.querySelector('.pc-hover-actual');
    const tooltip = wrap.querySelector('.pc-tooltip');

    function pointerToSvgX(clientX) {
      const rect = svg.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return PAD.left + Math.max(0, Math.min(1, ratio)) * PLOT_W;
    }

    function handleMove(clientX, clientY) {
      const svgX = pointerToSvgX(clientX);
      const t = minT + ((svgX - PAD.left) / PLOT_W) * (maxT - minT);
      const isoDate = new Date(t).toISOString().slice(0, 10);
      const plannedPct = plannedPercentAt(project, isoDate);

      // nearest actual update at-or-before this date, for the tooltip
      let nearestActual = null;
      for (const u of sorted) {
        if (u.update_date <= isoDate) nearestActual = u;
      }

      hoverG.hidden = false;
      crosshair.setAttribute('x1', svgX);
      crosshair.setAttribute('x2', svgX);
      if (plannedPct !== null) {
        hoverPlanned.hidden = false;
        hoverPlanned.setAttribute('cx', svgX);
        hoverPlanned.setAttribute('cy', yOf(plannedPct));
      } else {
        hoverPlanned.hidden = true;
      }
      if (nearestActual) {
        hoverActual.hidden = false;
        hoverActual.setAttribute('cx', xOf(new Date(nearestActual.update_date + 'T00:00:00').getTime(), minT, maxT));
        hoverActual.setAttribute('cy', yOf(Number(nearestActual.percent_complete)));
      } else {
        hoverActual.hidden = true;
      }

      tooltip.hidden = false;
      tooltip.innerHTML = `
        <div class="pc-tooltip-date">${esc(fmtDate(isoDate))}</div>
        <div class="pc-tooltip-row"><span class="legend-swatch planned"></span>Planned: ${plannedPct === null ? '—' : Math.round(plannedPct) + '%'}</div>
        <div class="pc-tooltip-row"><span class="legend-swatch actual"></span>Actual: ${nearestActual ? Math.round(Number(nearestActual.percent_complete)) + '% (as of ' + esc(fmtDate(nearestActual.update_date)) + ')' : 'no update yet'}</div>
      `;
      const wrapRect = wrap.getBoundingClientRect();
      const left = Math.max(4, Math.min(wrapRect.width - 180, clientX - wrapRect.left + 12));
      tooltip.style.left = left + 'px';
      tooltip.style.top = Math.max(4, clientY - wrapRect.top - 50) + 'px';
    }

    svg.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
    svg.addEventListener('mouseleave', () => {
      hoverG.hidden = true;
      tooltip.hidden = true;
    });
    svg.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches[0]) handleMove(e.touches[0].clientX, e.touches[0].clientY);
      },
      { passive: true }
    );
  };

  return { html, wire };
}
