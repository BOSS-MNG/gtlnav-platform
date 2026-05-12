import type { Metadata } from "next";
import { WebhooksClient } from "@/src/components/webhooks/webhooks-client";

export const metadata: Metadata = {
  title: "Webhooks · GTLNAV",
  description:
    "Deploy hooks for GitHub, GitLab, and Bitbucket — trigger GTLNAV deployments from any push.",
  robots: { index: false, follow: false },
};

export default function WebhooksPage() {
  return <WebhooksClient />;
}
