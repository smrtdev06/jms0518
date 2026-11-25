// One command for local development: checks the PostgreSQL in .env is reachable, prepares the
// database (npm run db:init), then runs the Next.js server.
//
//   npm run dev            -> database check + app (next dev)
//   npm run dev -- --prod  -> database check + production build (next build && next start)
import "dotenv/config";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { databaseUrl } from "./db-url.mjs";

const root = process.cwd();
const url = new URL(databaseUrl());
const host = url.hostname;
const port = Number(url.port || 5432);
const prod = process.argv.includes("--prod");

const log = (msg) => console.log(`\x1b[36m[dev]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[dev]\x1b[0m ${msg}`);
  process.exit(1);
};

function portOpen(p, h) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: p, host: h === "localhost" ? "127.0.0.1" : h });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
    socket.setTimeout(2000, () => (socket.destroy(), resolve(false)));
  });
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) fail(`${path.basename(cmd)} ${args.join(" ")} failed`);
}

if (!(await portOpen(port, host))) {
  fail(
    `PostgreSQL is not reachable at ${host}:${port}.\n` +
      "      Start the PostgreSQL service (Windows: services.msc → postgresql-x64-…) or fix DB_HOST / DB_PORT in .env.",
  );
}

log("Preparing database (schema and administrator)...");
run(process.execPath, [path.join(root, "scripts", "db-init.mjs")]);

const next = path.join(root, "node_modules", "next", "dist", "bin", "next");
if (prod) {
  log("Building production bundle...");
  run(process.execPath, [next, "build"]);
}
log(`Starting app (${prod ? "production" : "development"}) — http://localhost:${process.env.PORT || 3000}`);
// Turbopack's watcher on Windows follows missing paths under node_modules (next/node_modules/@swc,
// @opentelemetry) and then either hangs on "waiting for the filesystem to settle" or crashes.
const app = spawn(process.execPath, [next, prod ? "start" : "dev", ...(prod ? [] : ["--webpack"])], {
  stdio: "inherit",
});

const shutdown = () => {
  app.kill("SIGINT");
  setTimeout(() => process.exit(0), 500);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
app.on("exit", (code) => process.exit(code ?? 0));
