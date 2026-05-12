import type { Metadata } from "next";
import Link from "next/link";
import { AuthPageShell } from "@/src/components/auth/auth-page-shell";
import { RegisterForm } from "@/src/components/auth/register-form";

export const metadata: Metadata = {
  title: "Create account · GTLNAV",
  description: "Join GTLNAV and provision infrastructure in minutes.",
};

export default function RegisterPage() {
  return (
    <AuthPageShell
      title="Create account"
      subtitle="Join the beta and start building on global edge infrastructure."
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
      <RegisterForm />
    </AuthPageShell>
  );
}
