import type { Metadata } from "next";
import { AdminSettingsClient } from "@/src/components/admin/admin-settings-client";

export const metadata: Metadata = {
  title: "Settings · Admin · GTLNAV",
  description: "GTLNAV operator settings — profile, platform preferences, notifications, security, branding, maintenance.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  return <AdminSettingsClient />;
}
