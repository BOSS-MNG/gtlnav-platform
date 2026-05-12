import { supabase } from "@/src/lib/supabase";

export type AdminLogSeverity = "info" | "success" | "warning" | "error";

/**
 * Insert an admin audit entry into infrastructure_logs.
 * Schema-tolerant: tries the full payload, falls back to a slimmer shape.
 */
export async function logAdminEvent(
  actorId: string,
  eventType: string,
  message: string,
  severity: AdminLogSeverity = "info",
  metadata?: Record<string, unknown>,
) {
  const full = {
    user_id: actorId,
    project_id: (metadata?.project_id as string | undefined) ?? null,
    event_type: eventType,
    level: severity,
    severity,
    message,
    source: "admin_console",
    metadata: { actor_id: actorId, admin: true, ...(metadata ?? {}) },
  };
  const { error } = await supabase.from("infrastructure_logs").insert(full);
  if (!error) return;
  await supabase.from("infrastructure_logs").insert({
    user_id: actorId,
    project_id: (metadata?.project_id as string | undefined) ?? null,
    event_type: eventType,
    severity,
    message,
  });
}
