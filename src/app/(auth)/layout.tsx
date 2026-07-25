"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-context";

// useSearchParams() opts a component out of static prerendering unless it's
// wrapped in Suspense (Next.js requirement) — split into its own component
// so only this part is dynamic, not the whole layout shell.
function RedirectIfAuthenticated() {
  const { status } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status === "authenticated") {
      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/") ? next : "/chat");
    }
  }, [status, router, searchParams]);

  return null;
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4">
      <Suspense fallback={null}>
        <RedirectIfAuthenticated />
      </Suspense>
      {children}
    </div>
  );
}
