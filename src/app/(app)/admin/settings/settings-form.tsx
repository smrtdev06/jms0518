"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { Settings } from "@/lib/settings";
import { Field, FormError, useApi } from "@/components/admin-ui";

export function SettingsForm({ settings }: { settings: Settings }) {
  const { call, pending, error } = useApi();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    if (await call("/api/admin/settings", "PUT", form)) setSaved(true);
  }

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-5">
      <div>
        <h2 className="text-sm font-semibold">Duplicate rules for the Resume Tailor</h2>
        <p className="mt-1 text-xs text-muted">
          When a member generates packages, a link is skipped (before any AI tokens are spent) when it is already registered, or when a job
          from the same company was registered within the cooldown period.
        </p>
      </div>
      <Field label="Same-company cooldown (days)" hint="0 turns the company check off. Default: 30.">
        <input
          type="number"
          min={0}
          max={365}
          className="input w-32"
          value={form.company_cooldown_days}
          onChange={(e) => setForm({ ...form, company_cooldown_days: Number(e.target.value) })}
        />
      </Field>
      <Field
        label="Duplicate scope"
        hint="Per profile: different profiles may apply to the same job/company. All profiles: a link or company counts once across the whole system."
      >
        <select
          className="input w-64"
          value={form.duplicate_scope}
          onChange={(e) => setForm({ ...form, duplicate_scope: e.target.value as Settings["duplicate_scope"] })}
        >
          <option value="profile">Per profile</option>
          <option value="global">All profiles</option>
        </select>
      </Field>
      <FormError error={error} />
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          Save settings
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <Check className="size-3.5" /> Saved
          </span>
        )}
      </div>
    </form>
  );
}
