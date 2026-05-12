import type { Metadata } from "next";
import Link from "next/link";
import { AuthPageShell } from "@/src/components/auth/auth-page-shell";
import { LoginForm } from "@/src/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in · GTLNAV",
  description: "Sign in to the GTLNAV cloud control plane.",
};

export default function LoginPage() {
  return (
    <AuthPageShell
      title="Sign in"
      subtitle="Access your GTLNAV cloud control plane."
      footer={
        <>
          <Link
            href="/"
            className="text-basil-300 transition-colors hover:text-basil-200"
          >
            ← Back to home
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthPageShell>
  );
}
