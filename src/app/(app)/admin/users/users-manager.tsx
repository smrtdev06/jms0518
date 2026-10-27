"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/roles";
import { Field, FormError, Modal, Pill, Table, Td, Th, Toggle, useApi } from "@/components/admin-ui";
import { formatDateTime } from "@/lib/format";

type User = {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  member_id: number | null;
  member_name: string | null;
  profile_label: string;
  full_name: string | null;
  team_size: number;
  generated: number;
  applied: number;
};
type Member = { id: number; name: string; username: string };

const ROLE_HINT: Record<Role, string> = {
  admin: "The Administrator area only.",
  boss: "The Dashboard only, with analytics for every member, bidder and caller.",
  member: "Owns one profile: Resume Tailor, Applying Management, Interview Schedule, Dashboard and Team (their bidders and callers).",
  bidder: "Applying Management only, on the profile of the member below.",
  caller: "Interview Schedule only, on the profile of the member below.",
};

export function UsersManager({ users, members, currentUserId }: { users: User[]; members: Member[]; currentUserId: number }) {
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [show, setShow] = useState("all");
  const { call, error } = useApi();

  // "all", or one member's team: the member and their bidders and callers.
  const visible = show === "all" ? users : users.filter((u) => String(u.id) === show || String(u.member_id) === show);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select className="input w-64" value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show">
            <option value="all">All users ({users.length})</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                Team of {m.name}
              </option>
            ))}
          </select>
          {show !== "all" && <span className="text-xs text-muted">{visible.length} users</span>}
        </div>
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          <Plus className="size-3.5" /> Add user
        </button>
      </div>
      <FormError error={error} />
      <Table minWidth={960}>
        <thead>
          <tr>
            <Th>User ID</Th>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th>Member / team</Th>
            <Th>Status</Th>
            <Th>Activity</Th>
            <Th>Last login</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {visible.map((u) => (
            <tr key={u.id} className="hover:bg-surface-2/40">
              <Td className="font-medium">{u.username}</Td>
              <Td className="text-muted">{u.display_name || "—"}</Td>
              <Td>
                <Pill tone={u.role === "admin" || u.role === "boss" ? "accent" : "neutral"}>{ROLE_LABELS[u.role]}</Pill>
              </Td>
              <Td className="max-w-72 text-xs text-muted">
                {u.role === "member" ? (
                  <div>
                    {u.full_name ? (
                      <span className="text-fg">
                        {u.full_name}
                        {u.profile_label && <span className="text-faint"> ({u.profile_label})</span>}
                      </span>
                    ) : (
                      <span className="text-faint">Profile not set up yet</span>
                    )}
                    <button type="button" className="mt-0.5 flex items-center gap-1 text-[11px] text-accent hover:underline" onClick={() => setShow(String(u.id))}>
                      <Users className="size-3" />
                      {u.team_size} in team
                    </button>
                  </div>
                ) : u.role === "bidder" || u.role === "caller" ? (
                  u.member_name ? <span className="text-fg">{u.member_name}</span> : <span className="text-amber-300">No member</span>
                ) : (
                  "—"
                )}
              </Td>
              <Td>{u.is_active ? <Pill tone="good">Active</Pill> : <Pill tone="bad">Disabled</Pill>}</Td>
              <Td className="text-xs tabular-nums text-muted">
                {u.role === "member" ? `${u.generated} generated` : u.role === "bidder" ? `${u.applied} applied` : "—"}
              </Td>
              <Td className="text-xs text-muted">{formatDateTime(u.last_login_at)}</Td>
              <Td className="text-right">
                <div className="flex justify-end gap-1">
                  <button className="btn btn-ghost px-2" onClick={() => setEditing(u)} aria-label="Edit">
                    <Pencil className="size-3.5" />
                  </button>
                  {u.id !== currentUserId && (
                    <button
                      className="btn btn-ghost px-2 hover:text-rose-300"
                      aria-label="Delete"
                      onClick={() =>
                        window.confirm(
                          u.role === "member"
                            ? `Delete member "${u.username}"? Their profile and ${u.generated} generated job(s) are deleted too; their ${u.team_size} bidder(s)/caller(s) stay without a member.`
                            : `Delete user "${u.username}"?`,
                        ) && call(`/api/admin/users/${u.id}`, "DELETE")
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {editing && (
        <UserForm
          user={editing === "new" ? null : editing}
          members={members}
          defaultMember={show !== "all" ? Number(show) : null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function UserForm({ user, members, defaultMember, onClose }: { user: User | null; members: Member[]; defaultMember: number | null; onClose: () => void }) {
  const { call, pending, error } = useApi();
  const [form, setForm] = useState({
    username: user?.username ?? "",
    display_name: user?.display_name ?? "",
    role: user?.role ?? ((defaultMember ? "bidder" : "member") as Role),
    password: "",
    is_active: user?.is_active ?? true,
    member_id: user?.member_id ?? defaultMember ?? members[0]?.id ?? null,
    profile_label: user?.profile_label ?? "",
  });
  const team = form.role === "bidder" || form.role === "caller";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...form, member_id: team ? form.member_id : null };
    const ok = user ? await call(`/api/admin/users/${user.id}`, "PATCH", body) : await call("/api/admin/users", "POST", body);
    if (ok) onClose();
  }

  return (
    <Modal title={user ? `Edit ${user.username}` : "Add user"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="User ID (login)">
            <input className="input" value={form.username} disabled={Boolean(user)} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoFocus={!user} />
          </Field>
          <Field label="Display name">
            <input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          </Field>
          <Field label="Role" hint={ROLE_HINT[form.role]} className="sm:col-span-2">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
          {team && (
            <Field label="Member (client)" hint="This bidder or caller works only on this member's profile." className="sm:col-span-2">
              {members.length ? (
                <select className="input" value={form.member_id ?? ""} onChange={(e) => setForm({ ...form, member_id: Number(e.target.value) })} required>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.username})
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-amber-300">Create a member first.</p>
              )}
            </Field>
          )}
          {form.role === "member" && (
            <Field
              label="Profile label"
              hint={`Shown next to the profile name, e.g. ${user?.full_name || "Kevin Oyler"} (monster). The member fills in the profile itself in Resume Tailor.`}
              className="sm:col-span-2"
            >
              <input className="input" value={form.profile_label} onChange={(e) => setForm({ ...form, profile_label: e.target.value })} placeholder="monster" />
            </Field>
          )}
          <Field label={user ? "New password" : "Password"} hint={user ? "Leave empty to keep the current password." : "At least 6 characters."} className="sm:col-span-2">
            <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!user} />
          </Field>
        </div>
        <Toggle checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Account active" />
        <FormError error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={pending || (team && !members.length)}>
            {user ? "Save changes" : "Create user"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
