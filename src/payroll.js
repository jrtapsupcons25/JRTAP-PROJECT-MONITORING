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

/**
 * How much of one cash advance (bale) is still unpaid. The office doesn't
 * always deduct the full amount from a single payroll run, so a bale can
 * carry a balance into the next one — this is that balance.
 */
export function remainingBale(advance) {
  return Math.max(0, (Number(advance.amount) || 0) - (Number(advance.settled_amount) || 0));
}

/**
 * Groups outstanding bale balances by worker (one row per project-worker,
 * matching how advances are logged), for a "who still owes bale" list.
 * Returns rows sorted by remaining amount, largest first.
 */
export function remainingBaleByWorker(workers, advances) {
  const byWorker = new Map();
  advances.forEach((a) => {
    const remaining = remainingBale(a);
    if (remaining <= 0) return;
    byWorker.set(a.worker_id, (byWorker.get(a.worker_id) || 0) + remaining);
  });
  return [...byWorker.entries()]
    .map(([workerId, remaining]) => ({ worker: workers.find((w) => w.id === workerId), remaining }))
    .filter((r) => r.worker)
    .sort((a, b) => b.remaining - a.remaining);
}

/**
 * Cross-project, per-PERSON outstanding bale list — the centralized view.
 * Combines the manpower_bale_totals() RPC (which already sees every project
 * the signed-in account is allowed to, and sums correctly across all of them)
 * with the manpower registry, so each row can show a name/position instead of
 * a bare id. A manpower person's row exposes `manpowerId` so the caller can
 * open the cross-project settle modal for it.
 *
 * Any advance that predates the manpower registry (no manpower_id link) isn't
 * covered by the RPC, so those fall back to the old per-project-worker
 * grouping — each such row exposes `workerId`/`projectId` instead, so the
 * caller can route back to that one project's own Cash advances list.
 */
export function centralizedBaleRows(manpowerTotals, manpowerList, workers, advances) {
  const centralized = (manpowerTotals || [])
    .map((t) => {
      const person = (manpowerList || []).find((m) => m.id === t.manpower_id);
      return {
        manpowerId: t.manpower_id,
        name: person?.full_name || `#${t.manpower_id}`,
        position: person?.job_position || '—',
        remaining: Number(t.outstanding) || 0,
      };
    })
    .filter((r) => r.remaining > 0);

  const legacyAdvances = (advances || []).filter((a) => a.manpower_id == null);
  const legacyWorkers = (workers || []).filter((w) => w.manpower_id == null);
  const legacy = remainingBaleByWorker(legacyWorkers, legacyAdvances).map((r) => ({
    workerId: r.worker.id,
    projectId: r.worker.project_id,
    name: r.worker.full_name,
    position: r.worker.trade || '—',
    remaining: r.remaining,
  }));

  return [...centralized, ...legacy].sort((a, b) => b.remaining - a.remaining);
}

/**
 * How much bale has already been confirmed/deducted for one manpower person
 * during a given payroll week (Monday–Sunday), from the settlement ledger.
 * Bucketed by calendar date the same way advancesTotal is, so "this week"
 * means the same thing everywhere in payroll.
 */
export function settledThisWeek(manpowerId, settlements, mondayISO) {
  const sunday = addDaysISO(mondayISO, 6);
  return (settlements || [])
    .filter((s) => s.manpower_id === manpowerId && dateOnly(s.settled_at) >= mondayISO && dateOnly(s.settled_at) <= sunday)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
}
