import type { Metadata } from "next";
import { ProjectSettingsClient } from "@/src/components/project-settings/project-settings-client";

export const metadata: Metadata = {
  title: "Project Settings · GTLNAV",
  description:
    "Configure your GTLNAV project, environment variables, deployment defaults, and lifecycle.",
  robots: { index: false, follow: false },
};

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectSettingsClient projectId={id} />;
}
