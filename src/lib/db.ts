import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var __jmsPool: Pool | undefined;
}

/** DATABASE_URL, or one built from DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { DB_HOST, DB_PORT = "5432", DB_NAME, DB_USER, DB_PASSWORD = "" } = process.env;
  if (!DB_HOST || !DB_NAME || !DB_USER) throw new Error("Set DATABASE_URL or DB_HOST, DB_NAME and DB_USER in .env");
  return `postgres://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

function createPool() {
  const connectionString = databaseUrl();
  const useSsl =
    process.env.DATABASE_SSL === "true" ||
    (process.env.DATABASE_SSL !== "false" && /sslmode=require/.test(connectionString));
  // On Vercel many short-lived instances run at once, each with its own pool: keep each one small and let idle
  // connections go quickly so the database's connection limit is not used up (use the provider's pooled URL).
  const serverless = Boolean(process.env.VERCEL);
  return new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: serverless ? 3 : 10,
    idleTimeoutMillis: serverless ? 5_000 : 10_000,
  });
}

// Reuse one pool across hot reloads in development.
function pool(): Pool {
  if (!globalThis.__jmsPool) globalThis.__jmsPool = createPool();
  return globalThis.__jmsPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  try {
    const result = await pool().query<T>(text, params);
    return result.rows;
  } catch (error) {
    // 42703 undefined column, 42P01 undefined table: the code is newer than the database schema (e.g. the dev server
    // reloaded new code without being restarted). Say how to fix it instead of only naming the column.
    const code = (error as { code?: string }).code;
    if ((code === "42703" || code === "42P01") && error instanceof Error && !error.message.includes("npm run db:init")) {
      error.message += " (the database is older than the code: restart npm run dev, or run npm run db:init, to upgrade it)";
    }
    throw error;
  }
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function audit(
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: Record<string, unknown> = {},
) {
  await query(
    "INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)",
    [userId, action, entity, entityId === null ? null : String(entityId), JSON.stringify(details)],
  );
}
