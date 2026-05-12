import type { Metadata } from "next";
import { DashboardClient } from "@/src/components/dashboard/dashboard-client";

export const metadata: Metadata = {
  title: "Dashboard · GTLNAV",
  description: "GTLNAV control plane dashboard.",
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return <DashboardClient />;
}
