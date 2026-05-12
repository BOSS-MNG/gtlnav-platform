import type { Metadata } from "next";
import { AdminDeploymentsClient } from "@/src/components/admin/admin-deployments-client";

export const metadata: Metadata = {
  title: "Deployments · Admin · GTLNAV",
  description: "Inspect and intervene on every GTLNAV deployment.",
  robots: { index: false, follow: false },
};

export default function AdminDeploymentsPage() {
  return <AdminDeploymentsClient />;
}
