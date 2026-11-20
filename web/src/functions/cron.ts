// Vercel serverless function (bundled to api/cron.mjs by `npm run build:functions`).
// Runs daily via the cron in vercel.json; can also be called by hand to sync immediately.
import type { IncomingMessage, ServerResponse } from "node:http";
import schemaSql from "../../migrations/001_init.sql";
import { supabaseAdmin, syncSupabase } from "./sync.ts";

const MIN_MINUTES_BETWEEN_RUNS = 10;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return send(res, 500, { error: "SUPABASE_URL and SUPABASE_SECRET_KEY must be set in Vercel." });

  // Vercel sends CRON_SECRET as a bearer token when it's configured; without it, rely on the
  // rate limit below (a run only refreshes public data, so an extra trigger is harmless).
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "Unauthorized" });

  const sb = supabaseAdmin(url, key);
  const last = await sb.select("ingestion_runs", "select=finished_at&source=eq.supabase-sync&status=eq.succeeded&order=finished_at.desc&limit=1");
  const lastAt = last[0]?.finished_at ? Date.parse(String(last[0].finished_at)) : 0;
  if (Date.now() - lastAt < MIN_MINUTES_BETWEEN_RUNS * 60_000) {
    return send(res, 429, { skipped: `Last sync finished ${Math.round((Date.now() - lastAt) / 60_000)} min ago.` });
  }

  try {
    const result = await syncSupabase(sb, schemaSql, { log: (m) => console.log(m) });
    return send(res, 200, {
      ok: true,
      sources: result.report.sources,
      eligibility: result.report.eligibility,
      listing: result.report.listing,
      digestProcessed: result.digestProcessed,
      counts: result.counts,
    });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
