import type { Metadata } from "next";
import { AdminOverviewClient } from "@/src/components/admin/admin-overview-client";

export const metadata: Metadata = {
  title: "Admin · GTLNAV",
  description: "GTLNAV super admin operator console.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminOverviewClient />;
}
