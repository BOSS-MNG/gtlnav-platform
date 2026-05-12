"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/src/lib/supabase";

const inputClass =
  "w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3.5 text-sm text-white placeholder:text-white/35 outline-none transition-all focus:border-basil-400/50 focus:ring-2 focus:ring-basil-400/20";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error: signError } = await supabase.auth.signInWithPassword(
        { email: email.trim(), password },
      );
      if (signError) {
        setError(signError.message);
        return;
      }
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      ) : null}

      <div>
        <label
          htmlFor="login-email"
          className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-basil-300/90"
        >
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
          placeholder="you@company.com"
        />
      </div>

      <div>
        <label
          htmlFor="login-password"
          className="mb-2 block text-xs font-medium uppercase tracking-[0.2em] text-basil-300/90"
        >
          Password
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          placeholder="••••••••"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="group relative mt-2 w-full overflow-hidden rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-6 py-3.5 text-sm font-semibold text-black shadow-[0_0_40px_-8px_rgba(111,232,154,0.75)] transition-all hover:shadow-[0_0_50px_-5px_rgba(111,232,154,0.95)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          aria-hidden
          className="absolute inset-0 -z-10 opacity-0 transition-opacity group-hover:opacity-100 group-hover:animate-shimmer bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.5)_50%,transparent_70%)] bg-[length:200%_100%]"
        />
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-white/50">
        No account?{" "}
        <Link
          href="/register"
          className="font-medium text-basil-300 underline-offset-4 transition-colors hover:text-basil-200 hover:underline"
        >
          Join beta
        </Link>
      </p>
    </form>
  );
}
