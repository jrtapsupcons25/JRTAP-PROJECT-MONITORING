import { createClient } from '@supabase/supabase-js';

// Defaults let the app run out of the box with zero config; override via
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see .env.example) to point
// at a different Supabase project without editing source.
const DEFAULT_URL = 'https://ttsptqmozwtahribqdvi.supabase.co';
const DEFAULT_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0c3B0cW1vend0YWhyaWJxZHZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MjI4NTQsImV4cCI6MjEwMjE5ODg1NH0.9FIVSdSiLbwoAefAWMjuYsKgFsd4KrmhSssWqxoL6B0';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Every table in this app lives in the non-default `siteops` schema.
// Always query through `db`, never through `supabase.from(...)` directly.
export const db = supabase.schema('siteops');

export const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/siteops-manage-team`;

/**
 * Calls the siteops-manage-team edge function.
 * Pass no access token only for the true bootstrap create call (zero team
 * members exist yet) — every other call should include the caller's token.
 */
export async function callManageTeam(body, accessToken) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON_KEY,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = { error: `Unexpected response (${res.status})` };
  }
  if (!res.ok || json.error) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}
