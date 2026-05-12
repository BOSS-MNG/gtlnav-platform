import Link from "next/link";
import { ArrowRight } from "@/src/components/marketing/marketing-icons";
import { BrandLogo } from "@/src/components/marketing/brand-logo";
import { MARKETING_NAV_ITEMS } from "@/src/lib/marketing/nav";

export function MarketingNav() {
  return (
    <header className="relative z-20">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 md:px-10 md:py-8">
        <a href="#top" className="group flex items-center gap-3">
          <BrandLogo variant="nav" />
        </a>

        <nav className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-2 text-sm text-white/70 backdrop-blur-xl md:flex">
          {MARKETING_NAV_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-full px-4 py-1.5 transition-colors duration-300 hover:bg-basil-400/10 hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-basil-400/30 bg-basil-500/5 px-3 py-1.5 text-xs font-medium text-basil-200 backdrop-blur-xl sm:inline-flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-basil-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-basil-300" />
            </span>
            All systems operational
          </span>
          <Link
            href="/login"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full border border-basil-400/40 bg-gradient-to-r from-basil-500/20 to-basil-400/10 px-5 py-2 text-sm font-medium text-white shadow-[0_0_30px_-8px_rgba(111,232,154,0.6)] backdrop-blur-xl transition-all duration-300 hover:border-basil-300/70 hover:shadow-[0_0_40px_-5px_rgba(111,232,154,0.8)]"
          >
            <span className="relative z-10">Console</span>
            <ArrowRight className="relative z-10 h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}
