// Where the site runs. On a serverless host (Vercel) every request may run on a different short-lived machine:
// nothing written to disk survives, memory is not shared, and a request has a time limit. There, generated
// files live in the database and batches are processed in pieces (see runner.ts).
// HOSTING=serverless forces this mode elsewhere, for testing.
export const serverless = Boolean(process.env.VERCEL) || process.env.HOSTING?.trim().toLowerCase() === "serverless";
