import { db, supabase } from './supabase.js';

function must(result, what) {
  if (result.error) {
    console.error(what, result.error);
    // PGRST116 ("Cannot coerce the result to a single JSON object") from a
    // .single() write almost always means an RLS policy silently blocked
    // the row (0 rows matched) rather than a real data problem -- most
    // often because this tab's session no longer matches the account the
    // UI thinks is signed in (see the cross-tab guard in main.js). Surface
    // a message that actually points at the fix instead of the raw
    // PostgREST wording.
    if (result.error.code === 'PGRST116') {
      throw new Error('Your session may be out of date. Please refresh the page and try again.');
    }
    throw new Error(result.error.message || `Failed: ${what}`);
  }
  return result.data;
}

/* ---------------- projects ---------------- */
export async function fetchProjects() {
  return must(await db.from('projects').select('*').order('created_at', { ascending: false }), 'fetchProjects');
}
export async function createProject(fields) {
  return must(await db.from('projects').insert(fields).select().single(), 'createProject');
}
export async function updateProject(id, patch) {
  return must(await db.from('projects').update(patch).eq('id', id).select().single(), 'updateProject');
}

/* ---------------- team ---------------- */
export async function fetchTeamMembers() {
  return must(await db.from('team_members').select('*').order('full_name', { ascending: true }), 'fetchTeamMembers');
}

/* ---------------- manpower (company-wide registry, Owner/Admin managed) ---------------- */
export async function fetchManpower(filter = {}) {
  let q = db.from('manpower').select('*').order('full_name', { ascending: true });
  if (filter.activeOnly) q = q.eq('active', true);
  return must(await q, 'fetchManpower');
}
export async function createManpower(fields) {
  return must(await db.from('manpower').insert(fields).select().single(), 'createManpower');
}
export async function updateManpower(id, patch) {
  return must(await db.from('manpower').update(patch).eq('id', id).select().single(), 'updateManpower');
}
// Centralized cross-project bale totals, one row per manpower person
// ({ manpower_id, outstanding }). Backed by a SECURITY DEFINER RPC so a Site
// account gets an accurate figure without exposing other projects' raw
// advance rows to it.
export async function fetchManpowerBaleTotals() {
  return must(await db.rpc('manpower_bale_totals'), 'fetchManpowerBaleTotals');
}
// Ledger of individual settle actions (one row per confirmation), so the
// weekly payroll table can show what's already been confirmed for the week
// being viewed without re-deriving it from a running cumulative total.
export async function fetchBaleSettlements(manpowerIds) {
  let q = db.from('bale_settlements').select('*').order('settled_at', { ascending: false });
  if (manpowerIds && manpowerIds.length) q = q.in('manpower_id', manpowerIds);
  return must(await q, 'fetchBaleSettlements');
}
export async function createBaleSettlement(fields) {
  return must(await db.from('bale_settlements').insert(fields).select().single(), 'createBaleSettlement');
}

/* ---------------- payroll runs (submit -> approve -> print workflow) ---------------- */
export async function fetchPayrollRun(projectId, weekStart) {
  return must(
    await db.from('payroll_runs').select('*').eq('project_id', projectId).eq('week_start', weekStart).maybeSingle(),
    'fetchPayrollRun'
  );
}
export async function createPayrollRun(fields) {
  return must(await db.from('payroll_runs').insert(fields).select().single(), 'createPayrollRun');
}
export async function updatePayrollRun(id, patch) {
  return must(await db.from('payroll_runs').update(patch).eq('id', id).select().single(), 'updatePayrollRun');
}
export async function deletePayrollRun(id) {
  return must(await db.from('payroll_runs').delete().eq('id', id), 'deletePayrollRun');
}
// All payroll runs awaiting approval, across every project this account can
// see — feeds the Owner/Admin dashboard's "Needs your approval" queue.
export async function fetchPendingPayrollRuns() {
  return must(
    await db.from('payroll_runs').select('*').eq('status', 'submitted').order('created_at', { ascending: true }),
    'fetchPendingPayrollRuns'
  );
}

/* ---------------- material requests ---------------- */
export async function fetchMaterialRequests(filter = {}) {
  let q = db.from('material_requests').select('*').order('created_at', { ascending: false });
  if (filter.projectId) q = q.eq('project_id', filter.projectId);
  return must(await q, 'fetchMaterialRequests');
}
export async function createMaterialRequest(fields) {
  return must(await db.from('material_requests').insert(fields).select().single(), 'createMaterialRequest');
}
export async function decideMaterialRequest(id, patch) {
  return must(await db.from('material_requests').update(patch).eq('id', id).select().single(), 'decideMaterialRequest');
}
// Site-side confirmation that an approved request's materials actually
// arrived — a separate step from decideMaterialRequest (the admin's
// approve/reject), gated by its own RLS policy (material_requests_receive)
// so any account with project access can confirm receipt, not just an admin.
export async function receiveMaterialRequest(id, receivedBy) {
  return must(
    await db
      .from('material_requests')
      .update({ status: 'received', received_by: receivedBy, received_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single(),
    'receiveMaterialRequest'
  );
}

/* ---------------- petty cash requests ---------------- */
export async function fetchPettyCashRequests(filter = {}) {
  let q = db.from('petty_cash_requests').select('*').order('created_at', { ascending: false });
  if (filter.projectId) q = q.eq('project_id', filter.projectId);
  return must(await q, 'fetchPettyCashRequests');
}
export async function createPettyCashRequest(fields) {
  return must(await db.from('petty_cash_requests').insert(fields).select().single(), 'createPettyCashRequest');
}
export async function decidePettyCashRequest(id, patch) {
  return must(await db.from('petty_cash_requests').update(patch).eq('id', id).select().single(), 'decidePettyCashRequest');
}

/* ---------------- daily logs ---------------- */
export async function fetchDailyLogs(filter = {}) {
  let q = db.from('daily_logs').select('*').order('log_date', { ascending: false }).order('created_at', { ascending: false });
  if (filter.projectId) q = q.eq('project_id', filter.projectId);
  return must(await q, 'fetchDailyLogs');
}
export async function fetchDailyLogMaterials(logIds) {
  if (!logIds || logIds.length === 0) return [];
  return must(await db.from('daily_log_materials').select('*').in('log_id', logIds), 'fetchDailyLogMaterials');
}
export async function createDailyLog(fields) {
  return must(await db.from('daily_logs').insert(fields).select().single(), 'createDailyLog');
}
export async function createDailyLogMaterials(logId, rows) {
  if (!rows || rows.length === 0) return [];
  const payload = rows.map((r) => ({ ...r, log_id: logId }));
  return must(await db.from('daily_log_materials').insert(payload).select(), 'createDailyLogMaterials');
}

/* ---------------- workers ---------------- */
export async function fetchWorkers(projectId) {
  let q = db.from('workers').select('*').order('full_name', { ascending: true });
  if (projectId) q = q.eq('project_id', projectId);
  return must(await q, 'fetchWorkers');
}
export async function createWorker(fields) {
  return must(await db.from('workers').insert(fields).select().single(), 'createWorker');
}
export async function updateWorker(id, patch) {
  return must(await db.from('workers').update(patch).eq('id', id).select().single(), 'updateWorker');
}

/* ---------------- attendance ---------------- */
export async function fetchAttendance(projectId) {
  let q = db.from('attendance').select('*');
  if (projectId) q = q.eq('project_id', projectId);
  return must(await q, 'fetchAttendance');
}
export async function upsertAttendance(rows) {
  if (!rows || rows.length === 0) return [];
  return must(
    await db.from('attendance').upsert(rows, { onConflict: 'worker_id,work_date' }).select(),
    'upsertAttendance'
  );
}

/* ---------------- advances ---------------- */
export async function fetchAdvances(projectId) {
  let q = db.from('advances').select('*').order('given_at', { ascending: false });
  if (projectId) q = q.eq('project_id', projectId);
  return must(await q, 'fetchAdvances');
}
export async function createAdvance(fields) {
  return must(await db.from('advances').insert(fields).select().single(), 'createAdvance');
}
export async function updateAdvance(id, patch) {
  return must(await db.from('advances').update(patch).eq('id', id).select().single(), 'updateAdvance');
}

/* ---------------- direct materials ---------------- */
export async function fetchDirectMaterials(projectId) {
  let q = db.from('direct_materials').select('*').order('logged_at', { ascending: false });
  if (projectId) q = q.eq('project_id', projectId);
  return must(await q, 'fetchDirectMaterials');
}
export async function createDirectMaterial(fields) {
  return must(await db.from('direct_materials').insert(fields).select().single(), 'createDirectMaterial');
}

/* ---------------- direct expenses ---------------- */
export async function fetchDirectExpenses(projectId) {
  let q = db.from('direct_expenses').select('*').order('logged_at', { ascending: false });
  if (projectId) q = q.eq('project_id', projectId);
  return must(await q, 'fetchDirectExpenses');
}
export async function createDirectExpense(fields) {
  return must(await db.from('direct_expenses').insert(fields).select().single(), 'createDirectExpense');
}

/* ---------------- project assignments (site-role scoping) ---------------- */
export async function fetchProjectAssignments(projectId) {
  let q = db.from('project_assignments').select('*');
  if (projectId) q = q.eq('project_id', projectId);
  return must(await q, 'fetchProjectAssignments');
}
export async function assignMemberToProject(projectId, memberId, assignedBy) {
  return must(
    await db
      .from('project_assignments')
      .upsert({ project_id: projectId, member_id: memberId, assigned_by: assignedBy }, { onConflict: 'project_id,member_id', ignoreDuplicates: true }),
    'assignMemberToProject'
  );
}
export async function unassignMemberFromProject(projectId, memberId) {
  return must(
    await db.from('project_assignments').delete().eq('project_id', projectId).eq('member_id', memberId),
    'unassignMemberFromProject'
  );
}

/* ---------------- accomplishment (% progress) updates ---------------- */
export async function fetchProgressUpdates(projectId) {
  let q = db.from('progress_updates').select('*').order('update_date', { ascending: true });
  if (projectId) q = q.eq('project_id', projectId);
  return must(await q, 'fetchProgressUpdates');
}
export async function createProgressUpdate(fields) {
  return must(await db.from('progress_updates').insert(fields).select().single(), 'createProgressUpdate');
}
export async function deleteProgressUpdate(id) {
  return must(await db.from('progress_updates').delete().eq('id', id), 'deleteProgressUpdate');
}

/* ---------------- storage (site photos) ---------------- */
const PHOTO_BUCKET = 'siteops-photos';

export async function uploadLogPhoto(projectId, file) {
  const path = `${projectId}/${Date.now()}-${file.name}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file);
  if (error) throw new Error(error.message || 'Photo upload failed');
  return path;
}

export async function getPhotoSignedUrl(path) {
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error) {
    console.error('getPhotoSignedUrl', error);
    return null;
  }
  return data?.signedUrl || null;
}
