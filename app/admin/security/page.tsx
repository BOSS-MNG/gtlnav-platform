import type { Metadata } from "next";
import SecurityAdminClient from "@/src/components/security/security-admin-client";

export const metadata: Metadata = {
  title: "Security · Admin · GTLNAV",
  description:
    "GTLNAV operator threat dashboard — global security events, abuse detection, operator action audit, tenant threat board.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminSecurityPage() {
  return <SecurityAdminClient />;
}
