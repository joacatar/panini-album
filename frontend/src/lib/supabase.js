import { createClient } from "@supabase/supabase-js";

const env = import.meta.env ?? {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured
  ? createClient(url, key, {
      auth: {
        // SPA sin servidor: implicit encaja mejor con magic links por defecto de Supabase
        flowType: "implicit",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getAccessToken() {
  const session = await getSession();
  return session?.access_token ?? null;
}
