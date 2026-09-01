// Central app state. Vanilla JS, no framework: state + render().
export const state = {
  authReady: false, // has the initial session check completed?
  session: null, // supabase auth session (or null)
  profile: null, // siteops.team_members row for the signed-in user (or null)
  authScreen: 'login', // 'login' | 'bootstrap'
  authError: '',
  authBusy: false,
  route: { name: 'dashboard', params: {} },
  mobileNavOpen: false,

  // caches, refetched per-page as needed
  projects: [],
  teamMembers: [],
};

export function isApprover() {
  return state.profile && (state.profile.role === 'owner' || state.profile.role === 'admin');
}

export function currentUserId() {
  return state.session?.user?.id || null;
}

export function findProject(id) {
  return state.projects.find((p) => String(p.id) === String(id));
}
