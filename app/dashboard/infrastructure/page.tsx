import type { Metadata } from "next";
import { InfrastructureClient } from "@/src/components/infrastructure/infrastructure-client";

export const metadata: Metadata = {
  title: "Infrastructure · GTLNAV",
  description:
    "Real-time GTLNAV infrastructure console — regions, nodes, metrics, incidents, and system logs.",
  robots: { index: false, follow: false },
};

export default function InfrastructurePage() {
  return <InfrastructureClient />;
}
