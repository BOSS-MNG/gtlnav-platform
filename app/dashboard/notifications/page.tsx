import type { Metadata } from "next";
import NotificationsClient from "@/src/components/notifications/notifications-client";

export const metadata: Metadata = {
  title: "Notifications · GTLNAV",
  description:
    "GTLNAV notification center — deployment, SSL, DNS, webhook, usage, billing, infrastructure, and operator alerts with realtime feed and per-channel preferences.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function NotificationsPage() {
  return <NotificationsClient />;
}
