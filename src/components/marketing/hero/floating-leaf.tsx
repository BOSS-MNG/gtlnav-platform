import type { CSSProperties } from "react";
import { BasilLeaf } from "@/src/components/marketing/marketing-icons";

export function FloatingLeaf() {
  return (
    <div className="relative grid h-56 w-56 place-items-center md:h-72 md:w-72">
      {[0, 1, 2].map((i) => (
        <span
          key={`wave-${i}`}
          className="absolute inset-0 rounded-full border border-basil-300/40 animate-pulse-wave"
          style={{
            animationDelay: `${i * 1.05}s`,
            boxShadow: "inset 0 0 30px rgba(111,232,154,0.15)",
          }}
        />
      ))}

      <div className="absolute inset-0 rounded-full bg-basil-400/30 blur-3xl animate-pulse-glow" />
      <div
        className="absolute inset-4 rounded-full bg-basil-500/40 blur-2xl animate-pulse-glow"
        style={{ animationDelay: "-1.5s" }}
      />

      <div
        className="absolute -inset-2 rounded-full opacity-70 animate-conic-spin"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(111,232,154,0.6) 40deg, rgba(255,255,255,0.4) 60deg, rgba(111,232,154,0.6) 80deg, transparent 130deg, transparent 360deg)",
          mask: "radial-gradient(circle, transparent 64%, black 65%, black 72%, transparent 73%)",
          WebkitMask:
            "radial-gradient(circle, transparent 64%, black 65%, black 72%, transparent 73%)",
        }}
      />

      <div className="absolute inset-0 animate-spin-slow">
        <div className="absolute inset-0 rounded-full border border-basil-400/20" />
        <div className="absolute -inset-4 rounded-full border border-dashed border-basil-300/15" />
        <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-basil-300 shadow-[0_0_14px_rgba(111,232,154,1)]" />
      </div>
      <div className="absolute -inset-8 animate-spin-reverse">
        <div className="absolute inset-0 rounded-full border border-basil-400/10" />
        <span className="absolute top-1/2 -right-1 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-basil-200 shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
      </div>
      <div
        className="absolute -inset-14 animate-spin-slow"
        style={{ animationDuration: "60s" }}
      >
        <div className="absolute inset-0 rounded-full border border-dotted border-basil-300/[0.08]" />
      </div>

      <div className="absolute inset-6 rounded-full border border-basil-400/30 bg-gradient-to-br from-basil-500/10 to-black/20 backdrop-blur-xl" />

      <div
        className="absolute inset-2 rounded-full border border-basil-300/15 animate-breathe"
        style={{ boxShadow: "inset 0 0 60px rgba(111,232,154,0.25)" }}
      />

      <div className="relative animate-float">
        <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-basil-300/40 blur-2xl animate-breathe" />
        <BasilLeaf
          className="relative h-32 w-32 text-basil-300 drop-shadow-[0_0_24px_rgba(111,232,154,0.9)] md:h-44 md:w-44 animate-breathe"
          style={{ filter: "drop-shadow(0 0 28px rgba(111,232,154,0.6))" }}
        />
      </div>

      {[0, 72, 144, 216, 288].map((deg, i) => (
        <span
          key={deg}
          className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-basil-300 shadow-[0_0_12px_rgba(111,232,154,1)] animate-pulse-soft"
          style={
            {
              transform: `rotate(${deg}deg) translateX(110px) rotate(-${deg}deg)`,
              animationDelay: `${i * 0.4}s`,
            } as CSSProperties
          }
        />
      ))}

      {Array.from({ length: 14 }).map((_, i) => {
        const angle = (i * 360) / 14;
        const radius = 70 + ((i * 13) % 60);
        const dur = 4 + ((i * 0.4) % 3.5);
        const size = 0.5 + ((i * 0.3) % 1.6);
        return (
          <span
            key={`p-${i}`}
            className="absolute left-1/2 top-1/2 rounded-full bg-basil-200 animate-pulse-soft"
            style={
              {
                width: `${size}px`,
                height: `${size}px`,
                transform: `translate(-50%, -50%) rotate(${angle}deg) translateX(${radius}px)`,
                boxShadow:
                  "0 0 8px rgba(111,232,154,0.95), 0 0 18px rgba(111,232,154,0.5)",
                animationDuration: `${dur}s`,
                animationDelay: `${(i * 0.25) % 3}s`,
                opacity: 0.6 + ((i * 0.07) % 0.4),
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
