import type { ComponentType, SVGProps } from "react";
import {
  CloudIcon,
  RocketIcon,
  GlobeIcon,
  ShieldIcon,
  ServerIcon,
  StorageIcon,
} from "@/src/components/marketing/marketing-icons";

export type ServiceItem = {
  title: string;
  desc: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const SERVICES: ServiceItem[] = [
  {
    title: "Cloud Hosting",
    desc: "High-availability hosting on a global edge network engineered for sub-second cold starts and zero-downtime releases.",
    icon: CloudIcon,
  },
  {
    title: "App Deployment",
    desc: "Push to deploy with atomic rollouts, preview environments and instant rollback. From repo to production in seconds.",
    icon: RocketIcon,
  },
  {
    title: "Domains",
    desc: "Register, transfer and orchestrate domains with automatic DNS, anycast routing and one-click HTTPS for every subdomain.",
    icon: GlobeIcon,
  },
  {
    title: "SSL Security",
    desc: "Automated TLS provisioning, mutual auth and certificate rotation hardened with zero-trust at every network hop.",
    icon: ShieldIcon,
  },
  {
    title: "VPS Infrastructure",
    desc: "Dedicated virtual servers with NVMe storage, GPU-ready compute and live migrations across our private backbone.",
    icon: ServerIcon,
  },
  {
    title: "Cloud Storage",
    desc: "S3-compatible object storage with global replication, lifecycle policies and end-to-end encryption by default.",
    icon: StorageIcon,
  },
];
