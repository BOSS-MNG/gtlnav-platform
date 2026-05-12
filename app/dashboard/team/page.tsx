import type { Metadata } from "next";
import { TeamClient } from "@/src/components/team/team-client";

export const metadata: Metadata = {
  title: "Team · GTLNAV",
  description: "Team workspaces, roles, invitations, and access management.",
  robots: { index: false, follow: false },
};

export default function DashboardTeamPage() {
  return <TeamClient />;
}
