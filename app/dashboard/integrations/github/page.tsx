import type { Metadata } from "next";
import { Suspense } from "react";
import GitHubIntegrationClient from "@/src/components/integrations/github-integration-client";

export const metadata: Metadata = {
  title: "GitHub OAuth · GTLNAV",
  description:
    "Real GitHub OAuth integration — token exchange, encrypted storage, and repository sync run server-side on GTLNAV.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function GitHubIntegrationPage() {
  return (
    <Suspense fallback={null}>
      <GitHubIntegrationClient />
    </Suspense>
  );
}
