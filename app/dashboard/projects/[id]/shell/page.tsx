import type { Metadata } from "next";
import { ProjectShellClient } from "@/src/components/project-detail/project-shell-client";

export const metadata: Metadata = {
  title: "Project shell · GTLNAV",
  description:
    "Reserved interactive shell architecture preview. Shell sessions are not enabled in this build.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ProjectShellPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectShellClient projectId={id} />;
}
