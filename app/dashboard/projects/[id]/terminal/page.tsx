import type { Metadata } from "next";
import { ProjectTerminalClient } from "@/src/components/project-detail/project-terminal-client";

export const metadata: Metadata = {
  title: "Project terminal · GTLNAV",
  description: "Read-only project terminal streaming infrastructure logs.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ProjectTerminalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectTerminalClient projectId={id} />;
}
