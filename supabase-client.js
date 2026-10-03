import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://sxmbnlgufqhcwxcpcsvb.supabase.co/rest/v1/ ";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_TE62_J3d3fxN8v-PK3CX6w_prxfHJwC";

export const taleForgeSupabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
