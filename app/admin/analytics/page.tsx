import type { Metadata } from "next";
import { AdminAnalyticsClient } from "@/src/components/admin/admin-analytics-client";

export const metadata: Metadata = {
  title: "Analytics Center · Admin · GTLNAV",
  description:
    "Platform-wide GTLNAV observability and tenant analytics for operators.",
  robots: { index: false, follow: false },
};

export default function AdminAnalyticsPage() {
  return <AdminAnalyticsClient />;
}
