import type { ComponentType, SVGProps } from "react";
import { ArrowRight } from "@/src/components/marketing/marketing-icons";

type InfrastructureCardProps = {
  title: string;
  desc: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  index: number;
};

export function InfrastructureCard({
  title,
  desc,
  Icon,
  index,
}: InfrastructureCardProps) {
  const tilt =
    index % 2 === 0
      ? "group-hover:[transform:rotateX(3deg)_rotateY(-4deg)_translateY(-6px)]"
      : "group-hover:[transform:rotateX(3deg)_rotateY(4deg)_translateY(-6px)]";

  return (
    <div className="group reveal-up relative rounded-3xl [transform-style:preserve-3d]">
      <div className="pointer-events-none absolute -inset-px rounded-3xl bg-gradient-to-br from-basil-400/40 via-basil-500/10 to-transparent opacity-0 blur-md transition-opacity duration-500 group-hover:opacity-100" />

      <div
        className={[
          "relative h-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.02] to-transparent p-7 backdrop-blur-2xl transition-all duration-700 ease-out",
          "group-hover:border-basil-400/40",
          tilt,
        ].join(" ")}
        style={{ transformStyle: "preserve-3d" }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 0% 0%, rgba(111,232,154,0.15), transparent 40%)",
          }}
        />

        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            backgroundImage:
              "radial-gradient(600px circle at 30% 0%, rgba(111,232,154,0.18), transparent 40%)",
          }}
        />

        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-300/60 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        <div
          className="absolute -right-2 -top-2 h-24 w-24 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{
            backgroundImage:
              "conic-gradient(from 0deg, rgba(111,232,154,0) 0deg, rgba(111,232,154,0.5) 90deg, rgba(111,232,154,0) 180deg)",
            mask: "radial-gradient(circle, transparent 50%, black 51%, black 70%, transparent 71%)",
            WebkitMask:
              "radial-gradient(circle, transparent 50%, black 51%, black 70%, transparent 71%)",
            animation: "conic-spin 8s linear infinite",
          }}
        />

        <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-basil-400/30 bg-gradient-to-br from-basil-500/15 to-basil-700/5 shadow-[0_0_25px_-8px_rgba(111,232,154,0.5)] transition-all duration-500 group-hover:border-basil-300/60 group-hover:shadow-[0_0_45px_-6px_rgba(111,232,154,0.95)]">
          <Icon className="h-7 w-7 text-basil-300 transition-transform duration-500 group-hover:scale-110" />
        </div>

        <h4 className="mt-6 text-xl font-semibold tracking-tight text-white">
          {title}
        </h4>
        <p className="mt-3 text-sm leading-relaxed text-white/55">{desc}</p>

        <div className="mt-7 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.22em] text-basil-300/80 transition-colors duration-300 group-hover:text-basil-200">
            <span>Activate Layer</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-500 group-hover:translate-x-1" />
          </div>

          <div className="flex items-center gap-1">
            {[0, 1, 2, 3].map((b) => (
              <span
                key={b}
                className={`h-3 w-0.5 rounded-full bg-basil-400/${
                  60 - b * 10
                } animate-pulse-soft`}
                style={{ animationDelay: `${b * 0.18}s` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
