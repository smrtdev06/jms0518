// Builds the daily "Gmail check" notice from the checks of one day. No I/O, so it is unit tested.

/** One inbox in one check (the same shape as sync.ts AccountReport). */
export type CheckReport = {
  memberId: number;
  email: string;
  status: "done" | "partial" | "skipped" | "error";
  checked: number;
  requests: number;
  matched: number;
  unmatched: number;
  left: number;
  failed: number;
  error?: string;
  at: string;
};

export type CheckRun = { finished_at: string | Date; reports: CheckReport[] };

export type NoticeAccount = CheckReport & { profile: string };

/** The day (UTC, YYYY-MM-DD) a check finished on. */
function runDay(run: CheckRun) {
  return new Date(run.finished_at).toISOString().slice(0, 10);
}

/**
 * The latest day with a check of an inbox in `scope` (null = every inbox), and per inbox the sum of that day's checks:
 * counts add up (each check counts only the emails it read), the status and error are the last check's.
 */
export function mergeDay(runs: CheckRun[], scope: number[] | null) {
  const inScope = (r: CheckReport) => scope === null || scope.includes(r.memberId);
  const sorted = [...runs].sort((a, b) => new Date(a.finished_at).getTime() - new Date(b.finished_at).getTime());
  const latest = [...sorted].reverse().find((run) => run.reports.some(inScope));
  if (!latest) return null;
  const day = runDay(latest);
  const byMember = new Map<number, CheckReport>();
  let finishedAt = latest.finished_at;
  for (const run of sorted) {
    if (runDay(run) !== day) continue;
    for (const report of run.reports.filter(inScope)) {
      finishedAt = run.finished_at;
      const before = byMember.get(report.memberId);
      byMember.set(
        report.memberId,
        before
          ? {
              ...report,
              email: report.email || before.email,
              checked: before.checked + report.checked,
              requests: before.requests + report.requests,
              matched: before.matched + report.matched,
              unmatched: before.unmatched + report.unmatched,
              failed: before.failed + report.failed,
            }
          : { ...report },
      );
    }
  }
  const accounts = [...byMember.values()];
  const sum = (key: "checked" | "requests" | "matched" | "unmatched" | "failed") => accounts.reduce((total, a) => total + (a[key] || 0), 0);
  return {
    day,
    finishedAt: new Date(finishedAt).toISOString(),
    accounts,
    totals: {
      inboxes: accounts.length,
      checked: sum("checked"),
      requests: sum("requests"),
      matched: sum("matched"),
      unmatched: sum("unmatched"),
      problems: accounts.filter((a) => a.status === "error" || a.status === "skipped").length,
    },
  };
}
