// Creates the database and schema (when missing) and the administrator.
// Usage: npm run db:init   (reads the DB_* / DATABASE_URL, ADMIN_USERNAME and ADMIN_PASSWORD values from .env)
// On Vercel it runs before every build (npm run vercel-build), so the hosted database is always up to date.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import bcrypt from "bcryptjs";
import { databaseUrl } from "./db-url.mjs";

// Neon (on Vercel) also provides a direct, non-pooled URL, which suits the schema statements best.
const url = process.env.DATABASE_URL_UNPOOLED || databaseUrl();
// A hosted database (Vercel build) already exists; only a local server may need it created.
if (!process.env.VERCEL) await ensureDatabase(url);

const client = new pg.Client({ connectionString: url, ssl: sslOption(url) });
await client.connect();

try {
  const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  await client.query(schema);
  console.log("Schema applied.");

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;
  const admin = await client.query("SELECT id, password_hash FROM users WHERE username = $1", [username]);
  if (admin.rowCount && password && !(await bcrypt.compare(password, admin.rows[0].password_hash))) {
    // ADMIN_PASSWORD in .env is the administrator's password; a changed value takes effect here.
    await client.query("UPDATE users SET password_hash = $2, role = 'admin', is_active = TRUE WHERE id = $1", [
      admin.rows[0].id,
      await bcrypt.hash(password, 10),
    ]);
    console.log(`Administrator "${username}" password updated from .env.`);
  }
  // The users table must always have an administrator (the app checks this again on every server start).
  const anyAdmin = await client.query("SELECT 1 FROM users WHERE role = 'admin' AND is_active LIMIT 1");
  if (admin.rowCount === 0 || anyAdmin.rowCount === 0) {
    if (!password) {
      console.warn("ADMIN_PASSWORD is not set; skipping administrator creation.");
    } else {
      await client.query(
        `INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, 'admin')
         ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = TRUE,
           member_id = NULL`,
        [username, await bcrypt.hash(password, 10), "Administrator"],
      );
      console.log(`Administrator "${username}" created.`);
    }
  }
} finally {
  await client.end();
}

// Creates the target database (e.g. job_management) when it does not exist yet.
async function ensureDatabase(connectionString) {
  const target = new URL(connectionString);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!name || name === "postgres") return;
  const admin = new URL(connectionString);
  admin.pathname = "/postgres";
  const c = new pg.Client({ connectionString: admin.toString(), ssl: sslOption(connectionString) });
  try {
    await c.connect();
    const { rowCount } = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) {
      await c.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`Database "${name}" created.`);
    }
  } catch (error) {
    console.warn(`Could not check/create database "${name}" (${error.message}); continuing.`);
  } finally {
    await c.end().catch(() => undefined);
  }
}

function sslOption(connectionString) {
  if (process.env.DATABASE_SSL === "false") return undefined;
  if (process.env.DATABASE_SSL === "true" || /sslmode=require/.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}
