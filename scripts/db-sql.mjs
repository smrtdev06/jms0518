// Writes db/job_management.sql: the schema (db/schema.sql), the migrations (db/migrations) and the administrator,
// as one plain SQL file for importing with psql where `npm run db:init` cannot run. The administrator's password is ADMIN_PASSWORD from .env,
// hashed when the file is written, so no password hash is kept in the repository.
// Usage: npm run db:sql
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { migrationFiles } from "./migrations.mjs";

const username = process.env.ADMIN_USERNAME || "admin";
const password = process.env.ADMIN_PASSWORD;
if (!password) {
  console.error("Set ADMIN_PASSWORD in .env first: it becomes the administrator's password in the SQL file.");
  process.exit(1);
}

const root = process.cwd();
const schema = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8").replace(/\r\n/g, "\n").trimEnd();
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const hash = await bcrypt.hash(password, 10);
// The migrations are included and recorded, so npm run db:init later does not apply them a second time.
const migrations = migrationFiles()
  .map(({ name, sql }) => {
    const body = sql.replace(/\r\n/g, "\n").trimEnd();
    return `-- Migration ${name}\n${body}\nINSERT INTO schema_migrations (name) VALUES (${quote(name)}) ON CONFLICT DO NOTHING;`;
  })
  .join("\n\n");

const sql = `-- Job Management System (with Resume Tailor): schema and the administrator account.
-- Generated ${new Date().toISOString().slice(0, 10)} by npm run db:sql from db/schema.sql. Import into an empty database:
--   psql -U postgres -c "CREATE DATABASE job_management;"
--   psql -U postgres -d job_management -f db/job_management.sql
-- (npm run db:init does the same and is safe to re-run; npm run db:demo adds one demo user per role.)
-- Administrator password = ADMIN_PASSWORD in .env when this file was generated. Keep the file private.

SET client_encoding = 'UTF8';

BEGIN;

${schema}

${migrations}

INSERT INTO users (username, password_hash, display_name, role)
VALUES (${quote(username)}, ${quote(hash)}, 'Administrator', 'admin')
ON CONFLICT (username) DO NOTHING;

COMMIT;
`;

const out = path.join(root, "db", "job_management.sql");
fs.writeFileSync(out, sql);
console.log(`Wrote ${path.relative(root, out)} (administrator "${username}").`);
