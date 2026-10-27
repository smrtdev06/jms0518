// Shared by the db scripts: DATABASE_URL, or one built from the DB_* variables.
export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { DB_HOST, DB_PORT = "5432", DB_NAME, DB_USER, DB_PASSWORD = "" } = process.env;
  if (!DB_HOST || !DB_NAME || !DB_USER) {
    console.error("Set DATABASE_URL or DB_HOST, DB_NAME and DB_USER in .env");
    process.exit(1);
  }
  return `postgres://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}
