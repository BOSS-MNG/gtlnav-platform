import type { Metadata } from "next";
import { SupportClient } from "@/src/components/support/support-client";

export const metadata: Metadata = {
  title: "Support · GTLNAV",
  description:
    "Open a GTLNAV support ticket, track responses, and reach the platform team.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function SupportPage() {
  return <SupportClient />;
}
