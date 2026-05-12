import type { ComponentType, SVGProps } from "react";
import {
  ChipIcon,
  EdgeIcon,
  DnsIcon,
  AiIcon,
  StorageIcon,
  NetworkIcon,
} from "@/src/components/marketing/marketing-icons";

export type InfrastructureItem = {
  title: string;
  desc: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const INFRASTRUCTURE: InfrastructureItem[] = [
  {
    title: "Cloud Compute",
    desc: "Elastic compute fabric with autoscaling pods, GPU acceleration and microsecond cold starts.",
    icon: ChipIcon,
  },
  {
    title: "Edge Deployments",
    desc: "Push code to 240+ PoPs in seconds. Run logic where your users are — not where your servers are.",
    icon: EdgeIcon,
  },
  {
    title: "Secure DNS",
    desc: "Anycast DNS with DNSSEC, threat intelligence and instant failover routing for zero downtime.",
    icon: DnsIcon,
  },
  {
    title: "AI Routing",
    desc: "Adaptive ML traffic routing — learns load, latency and intent in real time, then steers each request to the optimal PoP.",
    icon: AiIcon,
  },
  {
    title: "Storage Clusters",
    desc: "Globally replicated, erasure-coded object stores with sub-10ms reads from any continent.",
    icon: StorageIcon,
  },
  {
    title: "Distributed Networking",
    desc: "Private overlay mesh with WireGuard tunnels, smart shaping and automatic peering.",
    icon: NetworkIcon,
  },
];
