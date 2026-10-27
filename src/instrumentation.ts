// Called once each time the Next.js server starts (next dev, next start, npm run dev).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureAdmin } = await import("./lib/ensure-admin");
  try {
    await ensureAdmin();
  } catch (error) {
    // The database may be down; the app still starts and reports database errors per request.
    console.error("[jms] Could not check the administrator:", error instanceof Error ? error.message : error);
  }
}
