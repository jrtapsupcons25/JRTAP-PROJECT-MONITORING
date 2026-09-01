import { supabase, db, callManageTeam } from './supabase.js';
import { state } from './state.js';

/**
 * Loads the signed-in user's siteops.team_members row.
 * Returns null if no row exists or the row is inactive.
 */
export async function loadProfile(userId) {
  if (!userId) return null;
  const { data, error } = await db.from('team_members').select('*').eq('id', userId).maybeSingle();
  if (error) {
    console.error('loadProfile error', error);
    return null;
  }
  if (!data || data.active === false) return null;
  return data;
}

export async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

/**
 * Best-effort check for whether siteops.team_members has zero rows, used to
 * decide whether to surface the first-run "set up the Owner account" flow.
 * Because RLS only lets active members SELECT, an unauthenticated read
 * legitimately comes back empty either way — this is just a UI hint. The
 * edge function is the real authority: it refuses a bootstrap create once a
 * team member exists.
 */
export async function looksLikeNoTeamYet() {
  try {
    const { data, error } = await db.from('team_members').select('id').limit(1);
    if (error) return true; // unauthenticated select likely blocked by RLS -> can't tell, offer the option
    return !data || data.length === 0;
  } catch {
    return true;
  }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
}

export async function bootstrapCreateOwner({ email, password, full_name }) {
  return callManageTeam({ action: 'create', email, password, full_name, role: 'owner' });
}

export async function createTeamMember({ email, password, full_name, role }) {
  const token = await getAccessToken();
  return callManageTeam({ action: 'create', email, password, full_name, role }, token);
}

export async function resetMemberPassword(member_id, password) {
  const token = await getAccessToken();
  return callManageTeam({ action: 'reset_password', member_id, password }, token);
}

export async function setMemberActive(member_id, active) {
  const token = await getAccessToken();
  return callManageTeam({ action: 'set_active', member_id, active }, token);
}

export async function deleteMember(member_id) {
  const token = await getAccessToken();
  return callManageTeam({ action: 'delete', member_id }, token);
}
