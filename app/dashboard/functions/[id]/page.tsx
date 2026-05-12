import type { Metadata } from "next";
import { FunctionDetailClient } from "@/src/components/functions/function-detail-client";

export const metadata: Metadata = {
  title: "Function · GTLNAV",
  description: "GTLNAV edge function detail — metrics, invoke simulation, logs, deployments, and bindings.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function FunctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FunctionDetailClient functionId={id} />;
}
