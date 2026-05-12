import type { ComponentType, SVGProps } from "react";
import {
  PulseIcon,
  RocketIcon,
  BoltIcon,
  ServerIcon,
  GlobeIcon,
  StorageIcon,
} from "@/src/components/marketing/marketing-icons";
import { MetricCard } from "@/src/components/marketing/hero/metric-card";

type RingSide = "tl" | "tr" | "ml" | "mr" | "bl" | "br";

type RingMetric = {
  value: string;
  label: string;
  side: RingSide;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  delay: number;
};

const METRICS: RingMetric[] = [
  { value: "99.999%", label: "Uptime", side: "tl", Icon: PulseIcon, delay: 0 },
  {
    value: "148",
    label: "Global Deployments",
    side: "tr",
    Icon: RocketIcon,
    delay: 1.2,
  },
  { value: "4ms", label: "Edge Latency", side: "ml", Icon: BoltIcon, delay: 2.4 },
  {
    value: "32",
    label: "Active Nodes",
    side: "mr",
    Icon: ServerIcon,
    delay: 0.6,
  },
  {
    value: "12",
    label: "Regions Online",
    side: "bl",
    Icon: GlobeIcon,
    delay: 1.8,
  },
  {
    value: "8.2 TB",
    label: "Distributed Storage",
    side: "br",
    Icon: StorageIcon,
    delay: 3,
  },
];

const POSITIONS: Record<RingSide, string> = {
  tl: "left-[2%] top-[6%] md:left-[3%] md:top-[8%]",
  tr: "right-[2%] top-[6%] md:right-[3%] md:top-[8%]",
  ml: "left-[1%] top-[44%] md:left-[2%] md:top-[42%]",
  mr: "right-[1%] top-[44%] md:right-[2%] md:top-[42%]",
  bl: "left-[4%] bottom-[18%] md:left-[8%] md:bottom-[20%]",
  br: "right-[4%] bottom-[18%] md:right-[8%] md:bottom-[20%]",
};

export function LiveMetricsRing() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 hidden lg:block"
    >
      {METRICS.map((m) => (
        <div
          key={m.label}
          className={[
            "absolute w-[14rem]",
            POSITIONS[m.side],
            "animate-tilt-float",
          ].join(" ")}
          style={{ animationDelay: `-${m.delay}s` }}
        >
          <MetricCard value={m.value} label={m.label} Icon={m.Icon} />
        </div>
      ))}
    </div>
  );
}
