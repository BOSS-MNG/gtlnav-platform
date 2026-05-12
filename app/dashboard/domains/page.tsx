import type { Metadata } from "next";
import { DomainsClient } from "@/src/components/domains/domains-client";

export const metadata: Metadata = {
  title: "Domains · GTLNAV",
  description: "Manage custom domains, DNS, and SSL across your GTLNAV projects.",
  robots: { index: false, follow: false },
};

export default function DomainsPage() {
  return <DomainsClient />;
}
