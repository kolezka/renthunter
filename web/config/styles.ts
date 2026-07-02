// Shared Tailwind class strings for the settings modal. No backdrop-filter inside
// the modal: it already sits over the overlay's single blur layer, so plain
// translucent fills avoid stacking expensive blur passes.
export const labelSpan = "text-[0.78rem] font-semibold tracking-[0.03em] text-ink-2";
export const control =
  "w-full rounded-[12px] border border-[var(--glass-border)] bg-black/25 px-[13px] py-[11px] text-ink transition-[border-color,box-shadow,background] duration-200 placeholder:text-ink-3 focus:border-[rgba(47,109,255,0.7)] focus:bg-black/35 focus:shadow-[0_0_0_3px_rgba(47,109,255,0.18)] focus:outline-none";
export const grid = "grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-[14px]";
export const toggleTrack =
  "relative h-[27px] w-[46px] flex-shrink-0 rounded-full border border-[var(--glass-border)] bg-white/10 transition-[background,border-color] duration-300 peer-checked:border-transparent peer-checked:bg-[linear-gradient(120deg,var(--color-aurora-indigo),var(--color-aurora-violet))] peer-checked:[&>span]:translate-x-[19px] peer-focus-visible:shadow-[0_0_0_3px_rgba(47,109,255,0.3)]";
export const toggleKnob =
  "absolute left-[2px] top-[2px] h-[21px] w-[21px] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.4)] transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1.18,0.36,1)]";
export const hint = "font-medium not-italic text-ink-3";
export const fieldDesc = "m-0 text-[0.75rem] leading-snug text-ink-3";
export const card = "grid gap-[14px] rounded-[14px] border border-[var(--glass-border)] bg-white/[0.03] p-4";
