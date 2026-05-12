import type { Metadata } from "next";
import { IntegrationsClient } from "@/src/components/integrations/integrations-client";

export const metadata: Metadata = {
  title: "Integrations · GTLNAV",
  description:
    "Connect GitHub, GitLab, and Bitbucket to GTLNAV — import repositories, branch deploys, and PR previews.",
  robots: { index: false, follow: false },
};

export default function IntegrationsPage() {
  return <IntegrationsClient />;
}
