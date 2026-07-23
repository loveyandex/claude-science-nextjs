"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkle, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await login(email, password);
    setSubmitting(false);
    if (error) setError(error);
    // On success, the (auth) layout's redirect effect takes it from here.
  };

  return (
    <div className="w-full max-w-sm animate-slide-up">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-foreground">
          <Sparkle size={16} className="text-accent" strokeWidth={2.2} />
        </div>
        <h1 className="font-display text-xl font-semibold text-foreground">Welcome back</h1>
        <p className="font-mono text-[11px] text-muted-foreground">locaul science</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-border/70 bg-card p-5">
        <div className="space-y-1.5">
          <label className="font-mono text-[11px] text-muted-foreground" htmlFor="email">
            email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="font-mono text-[11px] text-muted-foreground" htmlFor="password">
            password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-[13px] text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Log in
        </Button>
      </form>

      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        No account?{" "}
        <Link href="/signup" className="text-accent hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
