export function BackgroundFX() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-[-72px] opacity-[0.09] animate-grid-pan"
        style={{
          backgroundImage:
            "linear-gradient(rgba(111,232,154,0.55) 1px, transparent 1px), linear-gradient(90deg, rgba(111,232,154,0.55) 1px, transparent 1px)",
          backgroundSize: "72px 72px, 72px 72px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />

      <div
        className="absolute inset-0 opacity-[0.5] mix-blend-screen animate-conic-spin-slow"
        style={{
          backgroundImage:
            "conic-gradient(from 0deg at 50% 35%, rgba(111,232,154,0) 0deg, rgba(111,232,154,0.18) 40deg, rgba(111,232,154,0) 100deg, rgba(111,232,154,0) 220deg, rgba(111,232,154,0.12) 270deg, rgba(111,232,154,0) 340deg)",
          maskImage:
            "radial-gradient(ellipse at 50% 30%, black, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 50% 30%, black, transparent 70%)",
        }}
      />

      <div
        className="absolute inset-0 opacity-[0.35] mix-blend-screen"
        style={{
          backgroundImage:
            "radial-gradient(circle at 0.5px 0.5px, rgba(255,255,255,0.4) 0.5px, transparent 0)",
          backgroundSize: "3px 3px",
          maskImage:
            "radial-gradient(ellipse at 50% 30%, black, transparent 70%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at 50% 30%, black, transparent 70%)",
        }}
      />

      <div className="absolute -top-40 left-1/2 h-[55rem] w-[55rem] -translate-x-1/2 rounded-full bg-basil-500/20 blur-[140px] animate-pulse-glow" />
      <div className="absolute top-[40%] -left-32 h-[32rem] w-[32rem] rounded-full bg-basil-600/25 blur-[120px] animate-float-slow" />
      <div
        className="absolute top-[55%] -right-40 h-[36rem] w-[36rem] rounded-full bg-emerald-500/15 blur-[140px] animate-float-slow"
        style={{ animationDelay: "-4s" }}
      />
      <div className="absolute bottom-0 left-1/3 h-[28rem] w-[28rem] rounded-full bg-basil-400/15 blur-[120px] animate-pulse-glow" />

      <div
        className="absolute -left-1/4 top-[15%] h-[40rem] w-[60rem] rounded-full bg-basil-400/[0.07] blur-[160px] animate-aurora"
        style={{ animationDelay: "-3s" }}
      />
      <div
        className="absolute -right-1/4 top-[60%] h-[36rem] w-[55rem] rounded-full bg-emerald-300/[0.06] blur-[180px] animate-aurora"
        style={{ animationDelay: "-7s" }}
      />

      <div
        className="absolute left-1/2 top-1/3 h-[28rem] w-[55rem] -translate-x-1/2 rounded-full bg-basil-300/[0.04] blur-[120px] animate-drift"
        style={{ animationDelay: "-5s" }}
      />
      <div className="absolute left-[10%] top-[70%] h-[22rem] w-[40rem] rounded-full bg-basil-500/[0.05] blur-[100px] animate-drift-reverse" />

      <div className="absolute inset-x-0 top-0 z-10">
        {Array.from({ length: 36 }).map((_, i) => {
          const left = (i * 2.78) % 100;
          const delay = (i * 0.7) % 22;
          const duration = 14 + ((i * 1.3) % 18);
          const size = 1 + ((i * 0.4) % 2.6);
          const opacity = 0.3 + ((i * 0.06) % 0.6);
          return (
            <span
              key={i}
              className="absolute block rounded-full bg-basil-300 animate-rise"
              style={{
                left: `${left}%`,
                width: `${size}px`,
                height: `${size}px`,
                animationDelay: `-${delay}s`,
                animationDuration: `${duration}s`,
                opacity,
                boxShadow:
                  "0 0 6px rgba(111,232,154,0.9), 0 0 14px rgba(111,232,154,0.4)",
              }}
            />
          );
        })}
      </div>

      <div
        className="absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(ellipse 120% 60% at 50% 110%, rgba(0,0,0,0.9) 0%, transparent 60%), radial-gradient(ellipse 120% 60% at 50% -10%, rgba(0,0,0,0.7) 0%, transparent 60%)",
        }}
      />

      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black" />
    </div>
  );
}
