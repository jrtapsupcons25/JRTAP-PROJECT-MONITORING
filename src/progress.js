// Planned-vs-actual "% accomplishment" math (construction S-curve).
// Planned accomplishment is a straight line from 0% at start_date to 100% at
// target_end_date — the site engineer enters the *actual* % by hand (their own
// on-the-ground computation), logged over time in siteops.progress_updates.
import { todayISO } from './utils.js';

function toTime(isoDate) {
  return new Date(isoDate + 'T00:00:00').getTime();
}

// Planned % complete at a given ISO date, clamped to [0, 100]. Returns null
// if the project has no start/target dates to plan against.
export function plannedPercentAt(project, isoDate) {
  if (!project.start_date || !project.target_end_date) return null;
  const start = toTime(project.start_date);
  const end = toTime(project.target_end_date);
  if (end <= start) return null;
  const pct = ((toTime(isoDate) - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, pct));
}

export function latestUpdate(updates) {
  if (!updates || !updates.length) return null;
  return [...updates].sort((a, b) => (a.update_date < b.update_date ? 1 : -1))[0];
}

// Compares the most recently logged actual % against where the plan says the
// project should be *as of that same date* (not today) — so a two-week-old
// update is judged against the plan for two weeks ago, not against today's plan.
export function scheduleStatus(project, updates) {
  const latest = latestUpdate(updates);
  const plannedToday = plannedPercentAt(project, todayISO());
  if (!latest) {
    return { status: 'no_data', plannedToday, actualPct: null, plannedAsOf: null, diff: null, asOfDate: null };
  }
  const plannedAsOf = plannedPercentAt(project, latest.update_date);
  const actualPct = Number(latest.percent_complete);
  if (plannedAsOf === null) {
    return { status: 'no_plan', plannedToday: null, actualPct, plannedAsOf: null, diff: null, asOfDate: latest.update_date };
  }
  const diff = actualPct - plannedAsOf;
  const THRESHOLD = 2; // percentage points — avoids flip-flopping on noise
  const status = diff > THRESHOLD ? 'ahead' : diff < -THRESHOLD ? 'behind' : 'on_track';
  return { status, plannedToday, actualPct, plannedAsOf, diff, asOfDate: latest.update_date };
}
