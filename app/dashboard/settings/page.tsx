import type { Metadata } from "next";
import { AccountSettingsClient } from "@/src/components/account-settings/account-settings-client";

export const metadata: Metadata = {
  title: "Developer Settings · GTLNAV",
  description:
    "GTLNAV API keys, deployment tokens, and CLI foundation for the developer platform.",
  robots: { index: false, follow: false },
};

export default function AccountSettingsPage() {
  return <AccountSettingsClient />;
}
