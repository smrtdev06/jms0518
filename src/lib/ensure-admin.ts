import bcrypt from "bcryptjs";
import { queryOne, query } from "./db";

/**
 * Runs on every server start: when the users table has no active administrator, the administrator from
 * .env (ADMIN_USERNAME / ADMIN_PASSWORD) is inserted. If that username is already taken by another account,
 * the account is turned back into the administrator with the .env password.
 */
export async function ensureAdmin() {
  const existing = await queryOne("SELECT 1 FROM users WHERE role = 'admin' AND is_active LIMIT 1");
  if (existing) return;

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn("[jms] No administrator in the users table and ADMIN_PASSWORD is not set; none created.");
    return;
  }
  await query(
    `INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, 'Administrator', 'admin')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', is_active = TRUE,
       member_id = NULL`,
    [username, await bcrypt.hash(password, 10)],
  );
  console.log(`[jms] Administrator "${username}" created (the users table had none).`);
}
