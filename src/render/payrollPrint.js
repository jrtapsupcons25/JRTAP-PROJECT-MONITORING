// Builds a hidden, print-only payroll sheet and opens the browser's print
// dialog so the office can file a hard copy — used only for an APPROVED
// payroll_runs row, so the figures shown are the final, locked numbers from
// that approval (not a live recomputation from attendance/advances).
import { LOGO_DATA_URI } from '../logo.js';
import { esc, fmtMoney, fmtDateTime, weekRangeLabel } from '../utils.js';

const SHEET_ID = 'print-payroll-sheet';

function ensureSheetEl() {
  let el = document.getElementById(SHEET_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = SHEET_ID;
    document.body.appendChild(el);
  }
  return el;
}

export function printPayrollRun(run, project, memberName) {
  const el = ensureSheetEl();
  const rows = run.rows || [];
  const totals = rows.reduce(
    (acc, r) => ({
      gross: acc.gross + (Number(r.gross) || 0),
      advances: acc.advances + (Number(r.advances_given) || 0),
      deducted: acc.deducted + (Number(r.bale_deducted) || 0),
      net: acc.net + (Number(r.net) || 0),
    }),
    { gross: 0, advances: 0, deducted: 0, net: 0 }
  );

  el.innerHTML = `
    <div class="print-header">
      <img src="${LOGO_DATA_URI}" alt="JR.TAP Supplies and Construction Services">
      <div>
        <h1>JR.TAP Supplies and Construction Services</h1>
        <div class="print-sub">Weekly Payroll &mdash; ${esc(project.name)}</div>
        <div class="print-sub">${weekRangeLabel(run.week_start)}</div>
      </div>
    </div>
    <table class="print-table">
      <thead><tr><th>Worker</th><th class="num">Days present</th><th class="num">Gross</th><th class="num">Advances (this wk)</th><th class="num">Bale deducted</th><th class="num">Net</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>
              <td>${esc(r.full_name)}</td>
              <td class="num">${r.days_present}</td>
              <td class="num">${fmtMoney(r.gross)}</td>
              <td class="num">${fmtMoney(r.advances_given)}</td>
              <td class="num">${fmtMoney(r.bale_deducted)}</td>
              <td class="num">${fmtMoney(r.net)}</td>
            </tr>`
          )
          .join('')}
        <tr class="print-total">
          <td>Total</td><td></td>
          <td class="num">${fmtMoney(totals.gross)}</td>
          <td class="num">${fmtMoney(totals.advances)}</td>
          <td class="num">${fmtMoney(totals.deducted)}</td>
          <td class="num">${fmtMoney(totals.net)}</td>
        </tr>
      </tbody>
    </table>
    <div class="print-meta">
      <div>Submitted by: ${esc(memberName(run.submitted_by))} &mdash; ${fmtDateTime(run.created_at)}</div>
      <div>Approved by: ${esc(memberName(run.decided_by))} &mdash; ${fmtDateTime(run.decided_at)}</div>
    </div>
    <div class="print-signatures">
      <div class="sig"><span>Prepared by</span></div>
      <div class="sig"><span>Approved by</span></div>
      <div class="sig"><span>Received by</span></div>
    </div>
  `;
  window.print();
}
