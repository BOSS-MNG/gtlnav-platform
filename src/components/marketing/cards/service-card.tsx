import type { ComponentType, SVGProps } from "react";
import { ArrowRight } from "@/src/components/marketing/marketing-icons";

type ServiceCardProps = {
  title: string;
  desc: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  index: number;
};

export function ServiceCard({ title, desc, Icon, index }: ServiceCardProps) {
  return (
    <div className="group reveal-up relative rounded-3xl">
      <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/40 via-basil-500/10 to-transparent opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100" />

      <div className="relative h-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent p-7 backdrop-blur-2xl transition-all duration-500 group-hover:-translate-y-1 group-hover:border-basil-400/40">
        <div
          className="pointer-events-none absolute -top-32 -right-32 h-64 w-64 rounded-full bg-basil-500/20 opacity-0 blur-3xl transition-opacity duration-700 group-hover:opacity-100"
          style={{ transitionDelay: `${index * 30}ms` }}
        />

        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/60 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-basil-400/30 bg-gradient-to-br from-basil-500/15 to-basil-700/5 shadow-[0_0_25px_-8px_rgba(111,232,154,0.5)] transition-all duration-500 group-hover:border-basil-300/60 group-hover:shadow-[0_0_40px_-6px_rgba(111,232,154,0.9)]">
          <Icon className="h-7 w-7 text-basil-300 transition-transform duration-500 group-hover:scale-110" />
        </div>

        <h4 className="mt-6 text-xl font-semibold tracking-tight text-white">
          {title}
        </h4>
        <p className="mt-3 text-sm leading-relaxed text-white/55">{desc}</p>

        <div className="mt-7 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-basil-300/80 transition-colors duration-300 group-hover:text-basil-200">
          <span>Engage Module</span>
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-500 group-hover:translate-x-1" />
        </div>
      </div>
    </div>
  );
}
