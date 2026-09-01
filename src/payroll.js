import { addDaysISO } from './utils.js';

function dateOnly(ts) {
  if (!ts) return '';
  return String(ts).slice(0, 10);
}

/**
 * Computes weekly payroll rows for a set of workers, given the full
 * attendance and advances arrays (already filtered to relevant project(s)).
 * Returns { rows: [{worker, daysPresent, gross, advancesTotal, net}], totals }
 */
export function weeklyPayrollForWorkers(workers, attendance, advances, mondayISO) {
  const sunday = addDaysISO(mondayISO, 6);
  const rows = workers.map((w) => {
    const daysPresent = attendance.filter(
      (a) => a.worker_id === w.id && a.present !== false && a.work_date >= mondayISO && a.work_date <= sunday
    ).length;
    const gross = daysPresent * (Number(w.daily_rate) || 0);
    const advancesTotal = advances
      .filter((a) => a.worker_id === w.id && dateOnly(a.given_at) >= mondayISO && dateOnly(a.given_at) <= sunday)
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return { worker: w, daysPresent, gross, advancesTotal, net: gross - advancesTotal };
  });
  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + r.gross,
      advancesTotal: acc.advancesTotal + r.advancesTotal,
      net: acc.net + r.net,
    }),
    { gross: 0, advancesTotal: 0, net: 0 }
  );
  return { rows, totals };
}

/**
 * Company-wide payroll rollup: groups workers by project, computes weekly
 * payroll per project, and sums a grand total.
 */
export function companyWidePayroll(projects, workers, attendance, advances, mondayISO) {
  const byProject = projects.map((p) => {
    const projWorkers = workers.filter((w) => w.project_id === p.id && w.active !== false);
    const projAttendance = attendance.filter((a) => a.project_id === p.id);
    const projAdvances = advances.filter((a) => a.project_id === p.id);
    const { rows, totals } = weeklyPayrollForWorkers(projWorkers, projAttendance, projAdvances, mondayISO);
    return { project: p, rows, totals };
  });
  const grand = byProject.reduce(
    (acc, pp) => ({
      gross: acc.gross + pp.totals.gross,
      advancesTotal: acc.advancesTotal + pp.totals.advancesTotal,
      net: acc.net + pp.totals.net,
    }),
    { gross: 0, advancesTotal: 0, net: 0 }
  );
  return { byProject: byProject.filter((pp) => pp.rows.length > 0), grand };
}
