import type { Metadata } from "next";
import { AdminAuditClient } from "@/src/components/admin/admin-audit-client";

export const metadata: Metadata = {
  title: "Audit · Admin · GTLNAV",
  description: "Global audit stream of GTLNAV infrastructure events.",
  robots: { index: false, follow: false },
};

export default function AdminAuditPage() {
  return <AdminAuditClient />;
}
