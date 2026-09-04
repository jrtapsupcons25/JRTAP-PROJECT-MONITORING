// Bale (cash advance) settlement UI — shared between a project's own Cash
// advances list (projectDetail.js) and the cross-project "Manpower with
// remaining bale" view (dashboard.js), since a manpower person's outstanding
// bale can be spread across more than one project once they've been logged
// against advances tied to different sites.
import { esc, fmtMoney, fmtDate, toast, openModal, closeModal } from '../utils.js';
import {
  fetchAdvances,
  fetchProjects,
  fetchManpower,
  updateAdvance,
  updateManpower,
  createBaleSettlement,
  fetchBaleSettlementsForRun,
  deleteBaleSettlement,
  deletePayrollRun,
} from '../data.js';
import { remainingBale } from '../payroll.js';
import { currentUserId } from '../state.js';
import { ICONS } from '../icons.js';

// Records a full or partial repayment/deduction against one bale (advance).
// The office doesn't always deduct it all in one payroll run — whatever isn't
// settled here just stays as that worker's remaining bale for next time.
export function openSettleAdvanceModal(advance, workerLabel, onSaved) {
  const remaining = remainingBale(advance);
  openModal(`
    <div class="modal-overlay" id="modal-settle-advance">
      <div class="modal">
        <div class="modal-head"><h2>Settle bale &mdash; ${esc(workerLabel)}</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-settle-advance">
          <div class="modal-body">
            <div class="hint" style="margin-bottom:10px;">Remaining on this bale: <b>${fmtMoney(remaining)}</b> of ${fmtMoney(advance.amount)} given. Enter how much is being paid back / deducted now &mdash; the rest will carry over as remaining bale.</div>
            <div class="field"><label for="sa-amount">Amount being settled now (&#8369;)</label><input type="number" id="sa-amount" min="0" max="${remaining}" step="0.01" required value="${remaining}"></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Save</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-settle-advance').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amountNow = Number(document.getElementById('sa-amount').value);
    if (amountNow <= 0 || amountNow > remaining) return toast(`Enter an amount between 0 and ${fmtMoney(remaining)}.`, 'error');
    try {
      await updateAdvance(advance.id, { settled_amount: Number(advance.settled_amount || 0) + amountNow });
      // Log the confirmation to the ledger so a payroll week can show what's
      // already been settled without re-deriving it from the running total.
      // Only advances linked to the manpower registry participate — a
      // pre-registry (legacy) advance has no manpower_id to log against.
      if (advance.manpower_id != null) {
        await createBaleSettlement({
          manpower_id: advance.manpower_id,
          advance_id: advance.id,
          amount: amountNow,
          settled_by: currentUserId(),
        });
      }
      toast('Bale updated.', 'ok');
      closeModal();
      await onSaved();
    } catch (err) {
      toast(err.message || 'Could not update bale.', 'error');
    }
  });
}

// Settles (fully or partially) bale a manpower person already owed BEFORE
// being registered here — not tied to any project/advance, since a
// not-yet-deployed registrant has no project worker row to log an advance
// against. Mirrors openSettleAdvanceModal above, but writes to
// manpower.starting_bale_settled instead of an advances row, and logs a
// bale_settlements row with advance_id left null (still shows up in the
// ledger, just not attributable to a specific project advance).
export function openSettleStartingBaleModal(manpowerEntry, onSaved) {
  const remaining = Math.max(0, (Number(manpowerEntry.starting_bale) || 0) - (Number(manpowerEntry.starting_bale_settled) || 0));
  openModal(`
    <div class="modal-overlay" id="modal-settle-starting-bale">
      <div class="modal">
        <div class="modal-head"><h2>Settle starting bale &mdash; ${esc(manpowerEntry.full_name)}</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <form id="form-settle-starting-bale">
          <div class="modal-body">
            <div class="hint" style="margin-bottom:10px;">Bale ${esc(manpowerEntry.full_name)} already owed before being registered here (not tied to a project). Remaining: <b>${fmtMoney(remaining)}</b> of ${fmtMoney(manpowerEntry.starting_bale)}.</div>
            <div class="field"><label for="ssb-amount">Amount being settled now (&#8369;)</label><input type="number" id="ssb-amount" min="0" max="${remaining}" step="0.01" required value="${remaining}"></div>
          </div>
          <div class="modal-foot"><button type="button" class="btn" data-close-modal>Cancel</button><button type="submit" class="btn primary">Save</button></div>
        </form>
      </div>
    </div>
  `);
  document.getElementById('form-settle-starting-bale').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amountNow = Number(document.getElementById('ssb-amount').value);
    if (amountNow <= 0 || amountNow > remaining) return toast(`Enter an amount between 0 and ${fmtMoney(remaining)}.`, 'error');
    try {
      await updateManpower(manpowerEntry.id, { starting_bale_settled: Number(manpowerEntry.starting_bale_settled || 0) + amountNow });
      await createBaleSettlement({
        manpower_id: manpowerEntry.id,
        advance_id: null,
        amount: amountNow,
        settled_by: currentUserId(),
        note: 'Starting bale (before registration)',
      });
      toast('Starting bale updated.', 'ok');
      closeModal();
      await onSaved();
    } catch (err) {
      toast(err.message || 'Could not update starting bale.', 'error');
    }
  });
}

// Cross-project view of one manpower person's outstanding bale — since bale
// is now centralized per person rather than per project, this is where the
// office settles it "wherever it was actually given," regardless of which
// project the viewer opened this from. Only shows advances the signed-in
// account can actually see/act on (RLS) — Owner/Admin always sees everything;
// a Site account sees whatever's under its own assigned projects.
/**
 * Applies one lump-sum bale deduction against a manpower person's
 * outstanding advances, oldest first, spreading across more than one
 * advance/project if the amount requires it. This backs the weekly payroll
 * table's inline "Deduct bale" field, where the site engineer enters a
 * single number for the person at payday rather than picking one specific
 * advance to settle.
 *
 * Only advances this account's RLS lets it see/update are actually touched
 * — for a Site account, that can be less than the person's full company-wide
 * outstanding total (some of it may sit under a project this account isn't
 * assigned to). Returns the amount actually applied, so the caller can warn
 * if it's less than what was requested.
 *
 * `payrollRunId` (optional) tags each settlement row this call creates with
 * the payroll_runs row that triggered it, when called from the "Approve
 * payroll" flow — that's what lets a later "Reopen" on that same run find
 * and reverse exactly this deduction, and nothing else. A manual "Settle"
 * click (bale.js's own modal, not payroll approval) omits it.
 */
export async function settleManpowerBaleAmount(manpowerId, amount, settledBy, payrollRunId) {
  let left = Math.max(0, Number(amount) || 0);
  if (left <= 0) return 0;
  const advances = await fetchAdvances();
  const rows = advances
    .filter((a) => a.manpower_id === manpowerId)
    .map((a) => ({ ...a, remaining: remainingBale(a) }))
    .filter((r) => r.remaining > 0)
    .sort((a, b) => new Date(a.given_at) - new Date(b.given_at));

  let applied = 0;
  for (const r of rows) {
    if (left <= 0) break;
    const chunk = Math.min(left, r.remaining);
    await updateAdvance(r.id, { settled_amount: Number(r.settled_amount || 0) + chunk });
    await createBaleSettlement({
      manpower_id: manpowerId,
      advance_id: r.id,
      amount: chunk,
      settled_by: settledBy,
      payroll_run_id: payrollRunId ?? null,
    });
    left -= chunk;
    applied += chunk;
  }
  return applied;
}

/**
 * Undoes exactly one payroll run's approval: reverses every bale deduction
 * that run's "Approve" click applied (found via each settlement's
 * payroll_run_id, so nothing settled before or since is touched), then
 * deletes the payroll_runs row itself -- same as "Send back to draft" on a
 * submitted run, landing back at the live table that recomputes straight
 * from current attendance/advances. Used when a payroll was approved too
 * early (e.g. before that week's attendance was finished) and needs to
 * recompute against what's actually on record now.
 *
 * A settlement can be spread across more than one advance (FIFO, oldest
 * first, same as settleManpowerBaleAmount above), so this walks all of that
 * run's settlement rows and, for each, subtracts its amount back off the
 * matching advance's settled_amount -- accumulating locally in case more
 * than one settlement from this run touched the same advance -- before
 * deleting the settlement row.
 */
export async function reopenApprovedPayrollRun(run) {
  const settlements = await fetchBaleSettlementsForRun(run.id);
  if (settlements.length > 0) {
    const advances = await fetchAdvances();
    const settledAmountById = new Map(advances.map((a) => [a.id, Number(a.settled_amount) || 0]));
    for (const s of settlements) {
      if (settledAmountById.has(s.advance_id)) {
        const current = settledAmountById.get(s.advance_id);
        const restored = Math.max(0, current - (Number(s.amount) || 0));
        await updateAdvance(s.advance_id, { settled_amount: restored });
        settledAmountById.set(s.advance_id, restored);
      }
      await deleteBaleSettlement(s.id);
    }
  }
  await deletePayrollRun(run.id);
}

export async function openManpowerBaleModal(manpowerId, displayName, onSaved) {
  const [advances, projects, manpowerList] = await Promise.all([fetchAdvances(), fetchProjects(), fetchManpower()]);
  const projectName = (id) => projects.find((p) => p.id === id)?.name || `#${id}`;
  const manpowerEntry = manpowerList.find((m) => m.id === manpowerId);
  const startingRemaining = manpowerEntry
    ? Math.max(0, (Number(manpowerEntry.starting_bale) || 0) - (Number(manpowerEntry.starting_bale_settled) || 0))
    : 0;
  const rows = advances
    .filter((a) => a.manpower_id === manpowerId)
    .map((a) => ({ advance: a, remaining: remainingBale(a) }))
    .filter((r) => r.remaining > 0)
    .sort((a, b) => new Date(b.advance.given_at) - new Date(a.advance.given_at));

  openModal(`
    <div class="modal-overlay" id="modal-manpower-bale">
      <div class="modal">
        <div class="modal-head"><h2>Outstanding bale &mdash; ${esc(displayName)}</h2><button class="btn ghost" data-close-modal>${ICONS.close}</button></div>
        <div class="modal-body">
          ${
            rows.length === 0 && startingRemaining <= 0
              ? `<div class="hint">No outstanding bale visible from here. It may be logged under a project this account doesn't have access to &mdash; an Owner/Admin can settle it from that project's Cash advances list.</div>`
              : `<div class="table-wrap"><table><thead><tr><th>Project</th><th>Date given</th><th>Remaining</th><th></th></tr></thead><tbody>
                  ${
                    startingRemaining > 0
                      ? `<tr>
                        <td><i>Before registration</i></td>
                        <td>&mdash;</td>
                        <td class="num"><b>${fmtMoney(startingRemaining)}</b></td>
                        <td><button class="btn sm" data-settle-starting>Settle</button></td>
                      </tr>`
                      : ''
                  }
                  ${rows
                    .map(
                      ({ advance, remaining }) => `<tr>
                        <td>${esc(projectName(advance.project_id))}</td>
                        <td>${fmtDate(advance.given_at)}</td>
                        <td class="num"><b>${fmtMoney(remaining)}</b></td>
                        <td><button class="btn sm" data-settle-row="${advance.id}">Settle</button></td>
                      </tr>`
                    )
                    .join('')}
                </tbody></table></div>`
          }
        </div>
        <div class="modal-foot"><button type="button" class="btn" data-close-modal>Close</button></div>
      </div>
    </div>
  `);

  document.querySelectorAll('[data-settle-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = rows.find((r) => String(r.advance.id) === btn.dataset.settleRow);
      if (!row) return;
      openSettleAdvanceModal(row.advance, displayName, async () => {
        await onSaved();
        await openManpowerBaleModal(manpowerId, displayName, onSaved);
      });
    });
  });
  const settleStartingBtn = document.querySelector('[data-settle-starting]');
  if (settleStartingBtn && manpowerEntry) {
    settleStartingBtn.addEventListener('click', () => {
      openSettleStartingBaleModal(manpowerEntry, async () => {
        await onSaved();
        await openManpowerBaleModal(manpowerId, displayName, onSaved);
      });
    });
  }
}
