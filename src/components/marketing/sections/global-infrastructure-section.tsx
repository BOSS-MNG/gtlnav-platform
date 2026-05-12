import { EdgeNetworkMap } from "@/src/components/marketing/visualizations/edge-network-map";
import { ArchitectureStack } from "@/src/components/marketing/visualizations/architecture-stack";
import { AiRoutingCard } from "@/src/components/marketing/cards/ai-routing-card";
import { DistributedStorageCard } from "@/src/components/marketing/cards/distributed-storage-card";
import { NetworkTopologyCard } from "@/src/components/marketing/cards/network-topology-card";

export function GlobalInfrastructureSection() {
  return (
    <section
      id="architecture"
      className="relative mx-auto max-w-7xl px-6 py-24 md:px-10 md:py-32"
    >
      <div className="mx-auto mb-16 max-w-3xl text-center">
        <div className="reveal-up inline-flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-4 py-1.5 text-xs uppercase tracking-[0.28em] text-basil-200 backdrop-blur-xl">
          <span>Global Infrastructure Architecture</span>
        </div>
        <h3 className="reveal-up mt-6 text-balance text-4xl font-semibold tracking-tight md:text-6xl">
          <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
            A planet-scale cloud,
          </span>{" "}
          <span className="bg-gradient-to-r from-basil-200 to-basil-400 bg-clip-text text-transparent">
            engineered as one substrate.
          </span>
        </h3>
        <p className="reveal-up mt-5 text-balance text-base text-white/55 md:text-lg">
          240+ edge locations, intelligent routing, anycast DNS, NVMe compute and
          erasure-coded storage — orchestrated as a single self-healing network.
        </p>
      </div>

      <div className="reveal-up grid gap-6 lg:grid-cols-12">
        <EdgeNetworkMap />
        <ArchitectureStack />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <AiRoutingCard />
        <DistributedStorageCard />
        <NetworkTopologyCard />
      </div>
    </section>
  );
}
