"use client";

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), password: form.get("password") }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setError(data.error ?? "Could not reach the server");
      setPending(false);
      return;
    }
    window.location.href = data.redirect ?? "/";
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="username" className="label">
          User ID
        </label>
        <input id="username" name="username" className="input" autoComplete="username" autoFocus required />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="label">
          Password
        </label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      <button type="submit" className="btn btn-primary h-10 w-full text-sm" disabled={pending}>
        {pending && <LoaderCircle className="size-4 animate-spin" />}
        Sign in
      </button>
    </form>
  );
}
