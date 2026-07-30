import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/components/auth/auth-context";

export const metadata: Metadata = {
  title: "locaul science",
  description: "Chat with an LLM grounded in your own locally-indexed paper library.",
};

// Root layout is shared by every route, including (auth)'s bare login/signup
// pages — so it only holds truly global concerns (fonts, theme, auth state).
// The app chrome (sidebar/header) and the RequireAuth gate live in
// (app)/layout.tsx instead, so login/signup can render without either.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
