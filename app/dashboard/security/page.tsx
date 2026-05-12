import type { Metadata } from "next";
import SecurityClient from "@/src/components/security/security-client";

export const metadata: Metadata = {
  title: "Security · GTLNAV",
  description:
    "GTLNAV enterprise security center — MFA, SSO/SAML, sessions, devices, IP allowlists, audit, and threat scoring.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function SecurityPage() {
  return <SecurityClient />;
}
