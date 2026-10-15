import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createReaderEventIntakeHandler } from "./handler.ts";

Deno.serve(createReaderEventIntakeHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
}));
