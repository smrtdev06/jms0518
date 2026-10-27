import { HttpError } from "./auth";
import { str } from "./http";
import { ROLES, type Role } from "./roles";

export function validateUserBody(body: Record<string, unknown>, creating: boolean, allowedRoles: readonly Role[] = ROLES) {
  const username = str(body.username, 100);
  const role = str(body.role, 20) as Role;
  const password = String(body.password ?? "");
  if (creating && !/^[A-Za-z0-9._@-]{3,100}$/.test(username)) {
    throw new HttpError(400, "User ID must be 3+ characters: letters, numbers, . _ @ -");
  }
  if (!allowedRoles.includes(role)) throw new HttpError(400, "Choose a valid role");
  if ((creating || password) && password.length < 6) throw new HttpError(400, "Password must be at least 6 characters");
  const team = role === "bidder" || role === "caller";
  const memberId = team ? Number(body.member_id) : null;
  if (team && (!Number.isInteger(memberId) || memberId! <= 0)) throw new HttpError(400, "Choose the member this bidder or caller works for");
  return {
    username,
    role,
    password,
    displayName: str(body.display_name, 100),
    isActive: body.is_active !== false,
    // Bidders and callers belong to one member; a member's profile label is shown next to their name.
    memberId,
    profileLabel: role === "member" ? str(body.profile_label, 60) : "",
  };
}
