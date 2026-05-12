import type { Metadata } from "next";
import FunctionsClient from "@/src/components/functions/functions-client";

export const metadata: Metadata = {
  title: "Functions · GTLNAV",
  description:
    "GTLNAV edge runtime and functions — deploy, invoke, inspect requests, bindings, regions, and logs across edge, worker, and serverless runtimes.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function FunctionsPage() {
  return <FunctionsClient />;
}
