// A handful of 16px stroke icons, used sparingly.
type P = { size?: number };
const S = ({ size = 16, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const SearchIcon = (p: P) => <S {...p}><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></S>;
export const XIcon = (p: P) => <S {...p}><path d="m4 4 8 8M12 4l-8 8" /></S>;
export const StarIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <S {...p}><path d="m8 2.2 1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.2l-3.52 1.85.68-3.93L2.3 6.35l3.95-.55z" fill={filled ? "currentColor" : "none"} /></S>
);
export const ExternalIcon = (p: P) => <S {...p}><path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5V13h-8.5V4.5H6.5" /></S>;
export const CalendarIcon = (p: P) => <S {...p}><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></S>;
export const LinkIcon = (p: P) => <S {...p}><path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" /></S>;
export const FilterIcon = (p: P) => <S {...p}><path d="M2.5 4h11M4.5 8h7M6.5 12h3" /></S>;
export const ChevronIcon = ({ open, ...p }: P & { open?: boolean }) => (
  <S {...p}><path d={open ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} /></S>
);
export const CheckIcon = (p: P) => <S {...p}><path d="m3.5 8.5 3 3 6-7" /></S>;
export const ListIcon = (p: P) => <S {...p}><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h0M2.5 8h0M2.5 12h0" /></S>;
export const PlusIcon = (p: P) => <S {...p}><path d="M8 3v10M3 8h10" /></S>;
export const InfoIcon = (p: P) => <S {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 7.5V11M8 5h0" /></S>;
export const BackIcon = (p: P) => <S {...p}><path d="M10 3.5 5.5 8l4.5 4.5" /></S>;
export const AlertIcon = (p: P) => <S {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.5M8 11h0" /></S>;
