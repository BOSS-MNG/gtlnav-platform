import type { ComponentType, SVGProps } from "react";
import {
  EdgeIcon,
  AiIcon,
  DnsIcon,
  ChipIcon,
  StorageIcon,
} from "@/src/components/marketing/marketing-icons";

export type ArchitectureLayer = {
  n: string;
  title: string;
  meta: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  fill: number;
  accent: string;
};

export const ARCHITECTURE_LAYERS: ArchitectureLayer[] = [
  {
    n: "01",
    title: "Edge Network",
    meta: "240+ PoPs · 4 ms p95",
    Icon: EdgeIcon,
    fill: 92,
    accent: "from-basil-300 to-basil-500",
  },
  {
    n: "02",
    title: "AI Traffic Routing",
    meta: "ML steering · 0.4 ms",
    Icon: AiIcon,
    fill: 78,
    accent: "from-basil-300 to-basil-500",
  },
  {
    n: "03",
    title: "Secure DNS",
    meta: "Anycast · DNSSEC · BGP",
    Icon: DnsIcon,
    fill: 84,
    accent: "from-basil-300 to-basil-500",
  },
  {
    n: "04",
    title: "VPS Compute",
    meta: "NVMe · GPU · Live migrate",
    Icon: ChipIcon,
    fill: 71,
    accent: "from-basil-300 to-basil-500",
  },
  {
    n: "05",
    title: "Distributed Storage",
    meta: "Erasure-coded · Multi-region",
    Icon: StorageIcon,
    fill: 88,
    accent: "from-basil-300 to-basil-500",
  },
];
