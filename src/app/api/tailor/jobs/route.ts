import { after, NextResponse } from "next/server";
import { can, requireApiUser } from "@/lib/auth";
import { HttpError } from "@/lib/errors";
import { route } from "@/lib/http";
import { serverless } from "@/lib/tailor/hosting";
import { deleteFailedJobs, failTimedOutJobs, listJobs, recoverInterruptedJobs } from "@/lib/tailor/jobs";
import { withUserLock } from "@/lib/tailor/user-lock";
import { loadProfile } from "@/lib/tailor/profile";
import { clearGeneration, pumpQueue } from "@/lib/tailor/runner";

// Serverless: a progress check may go on to process queued jobs after it answers (see pumpQueue).
export const maxDuration = 300;

// The signed-in member's board.
export const GET = route(async () => {
  const user = await requireApiUser(can.tailor);
  if (serverless) await failTimedOutJobs(user.id);
  else await recoverInterruptedJobs();
  const jobs = await listJobs(user.id);
  // Serverless hosts keep no background work between requests, so each progress check keeps the batch moving.
  if (serverless && jobs.some((job) => job.status === "queued")) {
    const profile = await loadProfile(user.id);
    if (profile) after(() => pumpQueue(user.id, profile).catch((error) => console.error("Could not continue the batch", error)));
  }
  return NextResponse.json({ ok: true, jobs });
});

// Clear: stops the running batch and empties the board. Finished packages stay in Applying Management.
// ?failed=1 instead deletes only the failed cards (asked when the member leaves the page).
export const DELETE = route(async (request) => {
  const user = await requireApiUser(can.tailor);
  if (new URL(request.url).searchParams.get("failed") === "1") {
    const removed = await withUserLock(user.id, () => deleteFailedJobs(user.id));
    return NextResponse.json({ ok: true, removed: removed.length, jobs: await listJobs(user.id) });
  }
  try {
    await clearGeneration(user.id);
  } catch (error) {
    throw new HttpError(500, "Could not clear the board. Try again.", { cause: error });
  }
  return NextResponse.json({ ok: true, jobs: [] });
});
