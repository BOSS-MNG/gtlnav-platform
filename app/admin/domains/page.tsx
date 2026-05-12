import type { Metadata } from "next";
import { AdminDomainsClient } from "@/src/components/admin/admin-domains-client";

export const metadata: Metadata = {
  title: "Domains · Admin · GTLNAV",
  description: "Verify, fail or issue SSL across every GTLNAV domain.",
  robots: { index: false, follow: false },
};

export default function AdminDomainsPage() {
  return <AdminDomainsClient />;
}
