import { BrandLogo } from "@/src/components/marketing/brand-logo";
import {
  FOOTER_COLUMNS,
  FOOTER_SOCIALS,
} from "@/src/lib/marketing/footer-links";

export function MarketingFooter() {
  return (
    <footer id="footer" className="relative z-10 px-6 pb-10 md:px-10">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent backdrop-blur-2xl">
        <div className="relative px-8 py-14 md:px-14 md:py-16">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-basil-500/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-basil-400/60 to-transparent"
          />

          <div className="grid grid-cols-1 gap-12 md:grid-cols-12">
            <div className="md:col-span-4">
              <div className="flex items-center gap-3">
                <BrandLogo variant="footer" />
              </div>
              <p className="mt-6 max-w-xs text-sm leading-relaxed text-white/50">
                Navigate the future infrastructure. Hosting, deployment, domains
                and global cloud — a GODTECHLABS infrastructure platform.
              </p>

              <div className="mt-8 flex items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-3 py-1.5 text-xs font-medium text-basil-200 backdrop-blur-xl w-fit">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-basil-300" />
                </span>
                Operating across 240+ edge regions
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8 md:col-span-8 md:grid-cols-4">
              {FOOTER_COLUMNS.map((c) => (
                <div key={c.title}>
                  <div className="text-xs font-semibold uppercase tracking-[0.28em] text-basil-300/80">
                    {c.title}
                  </div>
                  <ul className="mt-5 space-y-3">
                    {c.items.map((item) => (
                      <li key={item.label}>
                        <a
                          href={item.href}
                          className="group inline-flex items-center gap-2 text-sm text-white/65 transition-colors duration-300 hover:text-white"
                        >
                          <span className="h-1 w-1 rounded-full bg-basil-400/0 transition-all duration-300 group-hover:bg-basil-300 group-hover:shadow-[0_0_8px_rgba(111,232,154,1)]" />
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-14 flex flex-col items-start justify-between gap-6 border-t border-white/10 pt-8 md:flex-row md:items-center">
            <div className="text-xs text-white/40">
              © {new Date().getFullYear()} GTLNAV · A GODTECHLABS company. All
              rights reserved.
            </div>
            <div className="flex items-center gap-3">
              {FOOTER_SOCIALS.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60 backdrop-blur-xl transition-all duration-300 hover:border-basil-400/40 hover:text-white"
                >
                  {s.label}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div
          aria-hidden
          className="relative h-32 w-full overflow-hidden border-t border-white/5"
        >
          <div className="pointer-events-none absolute inset-x-0 -bottom-24 mx-auto h-48 w-[80%] rounded-[100%] bg-basil-500/20 blur-3xl" />
          <div className="absolute inset-x-0 bottom-2 select-none text-center font-display text-[clamp(3rem,12vw,9rem)] font-bold leading-none tracking-tighter text-white/[0.04]">
            GTLNAV
          </div>
        </div>
      </div>
    </footer>
  );
}
