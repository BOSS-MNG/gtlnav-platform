type BrandLogoProps = {
  /**
   * Where the brand lockup appears. Tweaks shadows and tagline copy to match
   * the historical look of each placement, without changing visuals.
   */
  variant?: "nav" | "footer";
};

/**
 * Official GTLNAV brand lockup: leaf mark + wordmark + "by godtechlabs"
 * eyebrow. The mark is the official PNG asset at
 * `public/branding/gtlnav-logo.png`. Sizing, surrounding chrome (rounded
 * container, border, blur, basil-glow shadow) is preserved 1:1 from the
 * previous inline-SVG mark so layout stays identical.
 */
export function BrandLogo({ variant = "nav" }: BrandLogoProps) {
  const isNav = variant === "nav";
  const tagline = isNav ? "by godtechlabs" : "Cloud OS";
  const markShadow = isNav
    ? "shadow-[0_0_30px_-5px_rgba(111,232,154,0.5)] transition-all duration-500 group-hover:border-basil-300/60 group-hover:shadow-[0_0_45px_-5px_rgba(111,232,154,0.8)]"
    : "shadow-[0_0_30px_-5px_rgba(111,232,154,0.6)]";
  const leafExtras = isNav
    ? "drop-shadow-[0_0_8px_rgba(111,232,154,0.9)]"
    : "";

  return (
    <>
      <div
        className={`relative grid h-10 w-10 place-items-center rounded-2xl border border-basil-400/30 bg-gradient-to-br from-basil-500/20 to-basil-700/10 backdrop-blur-xl ${markShadow}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/branding/gtlnav-logo.png"
          alt="GTLNAV"
          width={64}
          height={64}
          decoding="async"
          loading="eager"
          className={`h-7 w-7 object-contain ${leafExtras}`.trim()}
        />
      </div>
      <div
        className={
          isNav
            ? "flex flex-col leading-none"
            : "leading-tight"
        }
      >
        <span
          className={
            isNav
              ? "text-sm font-semibold tracking-[0.32em] text-white"
              : "text-sm font-semibold tracking-[0.32em] text-white block"
          }
        >
          GTLNAV
        </span>
        <span
          className={
            isNav
              ? "mt-1 text-[10px] font-medium uppercase tracking-[0.28em] text-basil-300/80"
              : "mt-1 text-[10px] uppercase tracking-[0.28em] text-basil-300/80 block"
          }
        >
          {tagline}
        </span>
      </div>
    </>
  );
}
