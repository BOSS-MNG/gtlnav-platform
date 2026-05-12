/**
 * GTLNAV — preview banner.
 *
 * Surface a clear, consistent "this module is preview / not yet driving real
 * infrastructure" note on top of dashboard pages whose data is simulated.
 *
 * The component is intentionally minimal so it can be dropped into any
 * existing client component without re-flowing the layout. Style mirrors
 * the existing dashboard amber-warning pattern.
 */
import type { ReactNode } from "react";

export type PreviewBannerProps = {
  title?: string;
  children?: ReactNode;
};

export function PreviewBanner({ title, children }: PreviewBannerProps) {
  return (
    <div
      role="status"
      className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100"
    >
      <p className="flex items-center gap-2 font-semibold uppercase tracking-[0.18em] text-amber-50">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />
        {title ?? "Preview — not driving real infrastructure yet"}
      </p>
      {children ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-amber-100/85">
          {children}
        </p>
      ) : null}
    </div>
  );
}
