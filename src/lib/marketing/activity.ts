export type ActivityEventType = "ok" | "info" | "warn" | "secure" | "deploy";

export type ActivityEvent = {
  type: ActivityEventType;
  title: string;
  meta: string;
};

export const ACTIVITY_EVENTS: ActivityEvent[] = [
  { type: "ok", title: "Edge node synchronized", meta: "fra-3 · 0.8 ms drift" },
  {
    type: "deploy",
    title: "Deployment completed",
    meta: "gtlnav-core@v2.6.1 · 4 regions",
  },
  {
    type: "secure",
    title: "SSL certificate generated",
    meta: "*.gtlnav.app · valid 90d",
  },
  { type: "info", title: "Cloud region online", meta: "sao-1 · 6 zones · ready" },
  {
    type: "ok",
    title: "Storage cluster optimized",
    meta: "vault-east · -38% latency",
  },
  {
    type: "deploy",
    title: "Atomic rollout shipped",
    meta: "edge-router · 12k req/s",
  },
  {
    type: "secure",
    title: "Zero-trust handshake verified",
    meta: "mesh-link · mTLS 1.3",
  },
  {
    type: "info",
    title: "Anycast route propagated",
    meta: "240 PoPs · BGP green",
  },
  { type: "ok", title: "GPU pool warm-started", meta: "h100x4 · 92% headroom" },
  { type: "warn", title: "Auto-scaler engaged", meta: "drive-ingest · +6 nodes" },
];
