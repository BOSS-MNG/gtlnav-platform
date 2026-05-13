import Link from "next/link";
import {
  ArrowRight,
  Compass,
} from "@/src/components/marketing/marketing-icons";
import { LiveMetricsRing } from "@/src/components/marketing/hero/live-metrics-ring";
import { FloatingLeaf } from "@/src/components/marketing/hero/floating-leaf";

const HERO_STATS: { v: string; l: string }[] = [
  { v: "99.999%", l: "Uptime SLA" },
  { v: "240+", l: "Edge nodes" },
  { v: "<40ms", l: "Global p95" },
  { v: "ISO 27001", l: "Certified" },
];

export function Hero() {
  return (
    <section
      id="top"
      className="relative mx-auto flex max-w-7xl flex-col items-center px-6 pt-10 pb-32 text-center md:px-10 md:pt-16 md:pb-44"
    >
      <LiveMetricsRing />

      <FloatingLeaf />

      <div className="mt-10 inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-xs font-medium tracking-wide text-white/70 backdrop-blur-xl">
        <span className="text-basil-300">●</span>
        <span className="uppercase tracking-[0.28em]">
          Cloud OS · v2.6 · Live
        </span>
      </div>

      <h1 className="relative mt-8 select-none font-display text-[clamp(3.5rem,13vw,11rem)] font-semibold leading-[0.85] tracking-tight">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-20 bg-clip-text text-transparent opacity-90 blur-[40px]"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(111,232,154,0.85), rgba(27,191,90,0.45))",
          }}
        >
          GTLNAV
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-clip-text text-transparent blur-2xl opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(111,232,154,0.6), rgba(27,191,90,0.4))",
          }}
        >
          GTLNAV
        </span>

        <span
          className="relative bg-clip-text text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(180deg, #ffffff 0%, #f0fff5 25%, #ffffff 45%, #cdebd6 65%, #6fe89a 100%)",
            WebkitTextStroke: "0.5px rgba(255,255,255,0.05)",
            filter:
              "drop-shadow(0 0 28px rgba(111,232,154,0.35)) drop-shadow(0 0 4px rgba(255,255,255,0.4))",
          }}
        >
          GTLNAV
        </span>

        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 animate-text-sweep bg-clip-text text-transparent mix-blend-screen"
          style={{
            backgroundImage:
              "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.95) 48%, rgba(111,232,154,0.9) 52%, transparent 65%)",
            backgroundSize: "250% 100%",
            WebkitTextStroke: "0.5px rgba(255,255,255,0.05)",
          }}
        >
          GTLNAV
        </span>

        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-30 select-none bg-clip-text text-transparent opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(180deg, #ffffff, #ffffff)",
            transform: "translateY(8px) scale(1.02)",
          }}
        >
          GTLNAV
        </span>
      </h1>

      <h2 className="mt-6 text-2xl font-medium tracking-tight text-white/90 md:text-4xl">
        <span className="bg-gradient-to-r from-basil-200 via-white to-basil-200 bg-clip-text text-transparent">
          Navigate The Future Infrastructure 🚀
        </span>
      </h2>

      <p className="mt-7 max-w-2xl text-balance text-base leading-relaxed text-white/60 md:text-lg">
        A unified cloud operating system for{" "}
        <span className="text-basil-200">hosting</span>,{" "}
        <span className="text-basil-200">deployment</span>,{" "}
        <span className="text-basil-200">domains</span> and global{" "}
        <span className="text-basil-200">infrastructure</span>. A
        GODTECHLABS infrastructure platform engineered to ship production
        workloads at the speed of thought.
      </p>

      <div className="mt-12 flex flex-col items-center gap-4 sm:flex-row">
        <Link
          href="/login"
          className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full bg-gradient-to-r from-basil-300 via-basil-400 to-basil-500 px-8 py-4 text-base font-semibold text-black shadow-[0_0_50px_-8px_rgba(111,232,154,0.85)] transition-all duration-500 hover:shadow-[0_0_70px_-5px_rgba(111,232,154,1)]"
        >
          <span
            aria-hidden
            className="absolute inset-0 -z-10 animate-shimmer bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.6)_50%,transparent_70%)] bg-[length:200%_100%]"
          />
          <span className="relative">Launch Platform</span>
          <ArrowRight className="relative h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
        </Link>

        <Link
          href="/register"
          className="group relative inline-flex items-center gap-3 overflow-hidden rounded-full border border-white/15 bg-white/[0.03] px-8 py-4 text-base font-medium text-white backdrop-blur-xl transition-all duration-300 hover:border-basil-300/50 hover:bg-white/[0.06]"
        >
          <span className="absolute inset-0 -z-10 bg-gradient-to-r from-basil-400/0 via-basil-400/15 to-basil-400/0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          <span>Join beta</span>
          <Compass className="h-4 w-4 text-basil-300 transition-transform duration-500 group-hover:rotate-45" />
        </Link>
      </div>

      <div className="mt-20 grid w-full max-w-3xl grid-cols-2 gap-6 text-left sm:grid-cols-4">
        {HERO_STATS.map((m) => (
          <div
            key={m.l}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl transition-colors duration-300 hover:border-basil-400/30"
          >
            <div className="bg-gradient-to-br from-white to-basil-300 bg-clip-text text-2xl font-semibold tracking-tight text-transparent md:text-3xl">
              {m.v}
            </div>
            <div className="mt-1 text-xs uppercase tracking-[0.22em] text-white/40">
              {m.l}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
