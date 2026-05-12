import { BackgroundFX } from "@/src/components/marketing/background-fx";
import { MarketingNav } from "@/src/components/marketing/marketing-nav";
import { MarketingFooter } from "@/src/components/marketing/marketing-footer";
import { Hero } from "@/src/components/marketing/hero/hero";
import { NetworkActivitySection } from "@/src/components/marketing/sections/network-activity-section";
import { ServicesSection } from "@/src/components/marketing/sections/services-section";
import { InfrastructureGridSection } from "@/src/components/marketing/sections/infrastructure-grid-section";
import { GlobalInfrastructureSection } from "@/src/components/marketing/sections/global-infrastructure-section";

export default function Page() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-black text-white">
      <BackgroundFX />

      <MarketingNav />

      <main className="relative z-10">
        <Hero />
        <NetworkActivitySection />
        <ServicesSection />
        <InfrastructureGridSection />
        <GlobalInfrastructureSection />
      </main>

      <MarketingFooter />
    </div>
  );
}
