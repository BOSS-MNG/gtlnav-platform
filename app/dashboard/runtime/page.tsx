import type { Metadata } from "next";
import { RuntimeDashboardClient } from "@/src/components/runtime/runtime-dashboard-client";

export const metadata: Metadata = {
  title: "Runtime · GTLNAV",
  description: "Deployment runtime engine, workers, queue, and lifecycle.",
  robots: { index: false, follow: false },
};

export default function DashboardRuntimePage() {
  return <RuntimeDashboardClient />;
}
