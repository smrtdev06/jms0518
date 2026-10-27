export const ROLES = ["admin", "boss", "member", "bidder", "caller"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  boss: "Boss",
  member: "Member",
  bidder: "Bidder",
  caller: "Caller",
};

// Administrators only see the Administrator area and bosses only the Dashboard (all members).
// A member owns one profile and a team of bidders and callers; the team works on that profile only.
export const can = {
  tailor: (role: Role) => role === "member",
  apply: (role: Role) => role === "member" || role === "bidder",
  viewInterviews: (role: Role) => role === "member" || role === "caller",
  editInterviews: (role: Role) => role === "member",
  viewDashboard: (role: Role) => role === "member" || role === "boss",
  manageTeam: (role: Role) => role === "member",
  administer: (role: Role) => role === "admin",
  // Every member's data (administrators manage it, bosses analyse it). Everyone else sees one profile.
  seeAllProfiles: (role: Role) => role === "admin" || role === "boss",
};

export function homePath(role: Role) {
  if (role === "admin") return "/admin";
  if (role === "boss") return "/dashboard";
  if (role === "member") return "/tailor";
  return role === "caller" ? "/interviews" : "/applying";
}
