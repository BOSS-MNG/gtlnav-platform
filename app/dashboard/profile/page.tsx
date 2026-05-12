import type { Metadata } from "next";
import { ProfileClient } from "@/src/components/profile/profile-client";

export const metadata: Metadata = {
  title: "Profile · GTLNAV",
  description:
    "Manage your GTLNAV profile, contact details, preferred language, timezone, and default workspace.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  return <ProfileClient />;
}
