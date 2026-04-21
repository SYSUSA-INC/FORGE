"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        setLoading(false);
        return;
      }
      router.push("/forgot-password?sent=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Try again.");
      setLoading(false);
    }
  }

  return (
    <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
      <div>
        <label className="aur-label">Email</label>
        <input
          className="aur-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="aur-btn aur-btn-primary mt-2 flex items-center justify-center py-3 text-sm disabled:opacity-60"
      >
        {loading ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
