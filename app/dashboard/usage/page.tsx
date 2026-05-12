import type { Metadata } from "next";
import UsageClient from "@/src/components/usage/usage-client";

export const metadata: Metadata = {
  title: "Usage · GTLNAV",
  description:
    "Realtime usage metering for bandwidth, requests, deployments, build minutes, storage, edge, and more across your GTLNAV workspace.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function UsagePage() {
  return <UsageClient />;
}
