import type { Metadata } from "next";
import { DeploymentsClient } from "@/src/components/deployments/deployments-client";

export const metadata: Metadata = {
  title: "Deployments · GTLNAV",
  description:
    "GTLNAV deployments control center — builds, releases, edge propagation, and rollbacks.",
  robots: { index: false, follow: false },
};

export default function DeploymentsPage() {
  return <DeploymentsClient />;
}
