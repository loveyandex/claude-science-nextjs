"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkle, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignupPage() {
  const { signup } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signup(email, password);
    setSubmitting(false);
    if (error) setError(error);
  };

  return (
    <div className="w-full max-w-sm animate-slide-up">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-foreground">
          <Sparkle size={16} className="text-accent" strokeWidth={2.2} />
        </div>
        <h1 className="font-display text-xl font-semibold text-foreground">Create an account</h1>
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="font-mono text-[10px] text-muted-foreground">at least 8 characters</p>
        </div>

        {error && <p className="text-[13px] text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Sign up
        </Button>
      </form>

      <p className="mt-4 text-center text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
