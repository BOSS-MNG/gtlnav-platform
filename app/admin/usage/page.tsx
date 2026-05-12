import type { Metadata } from "next";
import UsageAdminClient from "@/src/components/usage/usage-admin-client";

export const metadata: Metadata = {
  title: "Usage · GTLNAV operator",
  description:
    "Operator-grade global usage wall — every workspace's bandwidth, requests, deployments, and quota pressure on a single screen.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminUsagePage() {
  return <UsageAdminClient />;
}
