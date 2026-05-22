import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "[MemoriX] Supabase environment variables are missing.\n" +
      "Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are defined in your .env file."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Extension is local-first — no auth sessions needed for the waitlist
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * Inserts an email into the waitlist table.
 *
 * @param {string} email - A validated email address.
 * @returns {{ data: object|null, error: object|null }}
 */
export async function joinWaitlist(email) {
  const { data, error } = await supabase
    .from("waitlist")
    .insert([{ email: email.trim().toLowerCase() }])
    .select()
    .single();

  return { data, error };
}
