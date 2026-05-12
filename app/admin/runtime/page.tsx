import type { Metadata } from "next";
import { RuntimeAdminClient } from "@/src/components/runtime/runtime-admin-client";

export const metadata: Metadata = {
  title: "Runtime · Admin · GTLNAV",
  description: "Global deployment runtime and worker fleet observability.",
  robots: { index: false, follow: false },
};

export default function AdminRuntimePage() {
  return <RuntimeAdminClient />;
}
