import type { Metadata } from "next";
import { AdminInfrastructureClient } from "@/src/components/admin/admin-infrastructure-client";

export const metadata: Metadata = {
  title: "Infrastructure · Admin · GTLNAV",
  description: "Operator-grade infrastructure health and incident simulation.",
  robots: { index: false, follow: false },
};

export default function AdminInfrastructurePage() {
  return <AdminInfrastructureClient />;
}
