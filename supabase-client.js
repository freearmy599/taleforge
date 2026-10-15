import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://sxmbnlgufqhcwxcpcsvb.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_TE62_J3d3fxN8v-PK3CX6w_prxfHJwC";

export const taleForgeSupabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

window.taleForgeSupabase = taleForgeSupabase;
// Public configuration only; never expose the service-role credential to browser code.
window.taleForgeSupabaseConfig = {
  url: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
};
// Keep the compatibility path until the intake endpoint is deployed and verified.
window.taleForgeReaderEventIntakeEnabled = false;
