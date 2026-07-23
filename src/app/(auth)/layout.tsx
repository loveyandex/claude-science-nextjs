"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/auth-context";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (status === "authenticated") {
      const next = searchParams.get("next");
      router.replace(next && next.startsWith("/") ? next : "/chat");
    }
  }, [status, router, searchParams]);

  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4">
      {children}
    </div>
  );
}
