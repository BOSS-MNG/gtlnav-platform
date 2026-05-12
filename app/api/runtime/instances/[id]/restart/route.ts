import type { NextRequest } from "next/server";
import { handleRuntimeActionRequest } from "../_action-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRuntimeActionRequest(request, params, "restart");
}
