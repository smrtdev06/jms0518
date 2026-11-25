// Called once each time the Next.js server starts (next dev, next start, npm run dev).
// Next also compiles this file for the Edge runtime. The database import has to stay inside the
// Node.js branch so that build does not try to bundle `pg`, which needs Node's `fs` module.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureAdmin } = await import("./lib/ensure-admin");
    try {
      await ensureAdmin();
    } catch (error) {
      // The database may be down; the app still starts and reports database errors per request.
      console.error("[jms] Could not check the administrator:", error instanceof Error ? error.message : error);
    }
  }
}
