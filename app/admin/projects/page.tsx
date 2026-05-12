import type { Metadata } from "next";
import { AdminProjectsClient } from "@/src/components/admin/admin-projects-client";

export const metadata: Metadata = {
  title: "Projects · Admin · GTLNAV",
  description: "Suspend, reactivate or archive GTLNAV projects platform-wide.",
  robots: { index: false, follow: false },
};

export default function AdminProjectsPage() {
  return <AdminProjectsClient />;
}
