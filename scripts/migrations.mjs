// Shared by the db scripts: the one-time migrations in db/migrations (NNN_name.sql), applied in name order.
// db/schema.sql creates the current tables; a migration changes existing data or schema exactly once per database
// and is then recorded in schema_migrations. Write migrations so that running one twice would do no harm.
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "db", "migrations");

export function migrationFiles() {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => /^\d+_[\w-]+\.sql$/.test(file))
    .sort()
    .map((file) => ({ name: file.replace(/\.sql$/, ""), sql: fs.readFileSync(path.join(dir, file), "utf8") }));
}

/** Applies the migrations this database has not had yet, each in its own transaction. Returns their names. */
export async function applyMigrations(client) {
  const { rows } = await client.query("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((row) => row.name));
  const applied = [];
  for (const migration of migrationFiles()) {
    if (done.has(migration.name)) continue;
    await client.query("BEGIN");
    try {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [migration.name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${migration.name} failed: ${error.message}`);
    }
    applied.push(migration.name);
  }
  return applied;
}
