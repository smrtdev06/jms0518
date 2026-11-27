import { googleConfigured } from "./google";
import { syncGmail } from "./sync";

// On a long-running server (npm run dev, npm run start:all) there is no Vercel Cron, so the server runs the daily
// Gmail check itself: shortly after it starts, then every hour, each time checking only the inboxes not fully
// checked in the last 23 hours. That keeps every inbox on a 24-hour cycle even when the server was off for a while.

declare global {
  var __jmsGmailScheduler: NodeJS.Timeout | undefined;
}

const FIRST_RUN_MS = 2 * 60_000;
const EVERY_MS = 60 * 60_000;

export function startGmailScheduler() {
  if (process.env.VERCEL || globalThis.__jmsGmailScheduler) return;
  if (process.env.GMAIL_SCHEDULER?.trim().toLowerCase() === "off" || !googleConfigured()) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await syncGmail({ deadline: Date.now() + 15 * 60_000, onlyDue: true, trigger: "scheduler" });
      const checked = result.accounts.filter((a) => a.checked || a.error);
      if (checked.length) {
        console.log("[jms] Gmail check:", checked.map((a) => `${a.email || a.memberId}: ${a.status}, ${a.checked} analyzed, ${a.matched} interview requests${a.error ? ` (${a.error})` : ""}`).join("; "));
      }
    } catch (error) {
      console.error("[jms] Gmail check failed:", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, FIRST_RUN_MS).unref();
  globalThis.__jmsGmailScheduler = setInterval(tick, EVERY_MS);
  globalThis.__jmsGmailScheduler.unref();
}
