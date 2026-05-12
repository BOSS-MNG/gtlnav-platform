import type { Metadata } from "next";
import { AnalyticsClient } from "@/src/components/analytics/analytics-client";

export const metadata: Metadata = {
  title: "Analytics · GTLNAV",
  description: "Real-time monitoring and analytics for GTLNAV projects.",
  robots: { index: false, follow: false },
};

export default function DashboardAnalyticsPage() {
  return <AnalyticsClient />;
}
