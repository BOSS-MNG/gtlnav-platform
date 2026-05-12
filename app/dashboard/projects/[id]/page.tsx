import type { Metadata } from "next";
import { ProjectDetailClient } from "@/src/components/project-detail/project-detail-client";

export const metadata: Metadata = {
  title: "Project · GTLNAV",
  description: "GTLNAV project detail and deployment console.",
  robots: { index: false, follow: false },
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectDetailClient projectId={id} />;
}
