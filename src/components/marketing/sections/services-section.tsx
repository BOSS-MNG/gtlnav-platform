import { ServiceCard } from "@/src/components/marketing/cards/service-card";
import { SERVICES } from "@/src/lib/marketing/services";

export function ServicesSection() {
  return (
    <section
      id="services"
      className="relative mx-auto max-w-7xl px-6 py-24 md:px-10 md:py-32"
    >
      <div className="mx-auto mb-16 max-w-3xl text-center">
        <div className="reveal-up inline-flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-4 py-1.5 text-xs uppercase tracking-[0.28em] text-basil-200 backdrop-blur-xl">
          <span>The Stack</span>
        </div>
        <h3 className="reveal-up mt-6 text-balance text-4xl font-semibold tracking-tight md:text-6xl">
          <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
            One platform.
          </span>{" "}
          <span className="bg-gradient-to-r from-basil-200 to-basil-400 bg-clip-text text-transparent">
            Every layer.
          </span>
        </h3>
        <p className="reveal-up mt-5 text-balance text-base text-white/55 md:text-lg">
          A composable cloud built for builders. Hosting, deployment, security
          and storage — orchestrated as one elegant operating system.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((s, i) => (
          <ServiceCard
            key={s.title}
            index={i}
            title={s.title}
            desc={s.desc}
            Icon={s.icon}
          />
        ))}
      </div>
    </section>
  );
}
