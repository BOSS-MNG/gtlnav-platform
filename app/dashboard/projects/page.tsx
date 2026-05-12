import type { Metadata } from "next";
import { ProjectsClient } from "@/src/components/dashboard/projects-client";

export const metadata: Metadata = {
  title: "Projects · GTLNAV",
  description: "All projects deployed on GTLNAV — search, filter, deploy, archive.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  return <ProjectsClient />;
}
