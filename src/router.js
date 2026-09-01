import { state } from './state.js';

function parseHash() {
  let hash = window.location.hash.replace(/^#/, '');
  if (!hash) hash = 'dashboard';
  const [head, ...rest] = hash.split('/');
  if (head === 'project' && rest[0]) {
    return { name: 'project', params: { id: rest[0], tab: rest[1] || 'overview' } };
  }
  return { name: head, params: {} };
}

let onChange = null;
export function initRouter(handler) {
  onChange = handler;
  window.addEventListener('hashchange', () => {
    state.route = parseHash();
    onChange(state.route);
  });
  state.route = parseHash();
  onChange(state.route);
}

export function navigate(hash) {
  if (window.location.hash === '#' + hash) {
    // same hash — force a re-render since hashchange won't fire
    state.route = parseHash();
    onChange && onChange(state.route);
  } else {
    window.location.hash = hash;
  }
}

export function projectHash(id, tab) {
  return `project/${id}` + (tab ? `/${tab}` : '');
}
