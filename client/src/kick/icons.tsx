// Icons lifted verbatim from Kick's dashboard sidebar markup.
// Each is the 32x32 'active' variant, recolored to currentColor.

export type IconProps = { className?: string };

type P = IconProps;

export const StreamIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M27.3 4.69995L24.48 7.51995C26.66 9.69995 28 12.7 28 16C28 19.3 26.66 22.3 24.48 24.48L27.3 27.3C30.2 24.4 32 20.4 32 16C32 11.6 30.2 7.57995 27.3 4.69995Z" fill="currentColor"/><path d="M4.7 4.69995C1.8 7.59995 0 11.6 0 16C0 20.4 1.8 24.42 4.7 27.3L7.52 24.48C5.34 22.3 4 19.3 4 16C4 12.7 5.34 9.69995 7.52 7.51995L4.7 4.69995Z" fill="currentColor"/><path d="M12.28 11.3V20.72H14.64L21.72 16L14.64 11.3H12.28Z" fill="currentColor"/>
  </svg>
);

export const StreamKeyIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <g clipPath="url(#clip0_4576_792)"><path d="M12.3561 8.88106L13.9868 7.24984C15.4162 5.82001 17.3287 5.01447 19.3621 5.01447C21.3954 5.01447 23.308 5.79987 24.7373 7.24984C27.6968 10.2102 27.6968 15.0434 24.7373 18.0038L23.1066 19.635L26.67 23.1995L28.3007 21.5683C33.2331 16.6344 33.2331 8.6394 28.3007 3.70548C25.8245 1.22845 22.6033 0 19.3621 0C16.1208 0 12.8997 1.22845 10.4234 3.70548L8.7927 5.33669L12.3561 8.9012V8.88106Z" fill="currentColor"/><path d="M19.5433 23.1995L18.0132 24.73C16.5838 26.1598 14.6713 26.9654 12.6379 26.9654C10.6046 26.9654 8.69204 26.18 7.26266 24.73C4.30324 21.7697 4.30324 16.9364 7.26266 13.9761L8.7927 12.4456L5.22932 8.88106L3.69928 10.4116C-1.23309 15.3656 -1.23309 23.3606 3.69928 28.2945C6.17553 30.7716 9.39667 32 12.6379 32C15.8792 32 19.1003 30.7716 21.5766 28.2945L23.1066 26.764L19.5433 23.1995Z" fill="currentColor"/><path d="M19.1406 10.3109C18.4964 10.3109 17.8522 10.5525 17.369 11.056L10.967 17.46C9.9805 18.4468 9.9805 20.0378 10.967 21.0245C11.4501 21.5079 12.0944 21.7697 12.7386 21.7697C13.3828 21.7697 14.0271 21.528 14.5102 21.0245L20.9122 14.6205C21.8987 13.6337 21.8987 12.0428 20.9122 11.056C20.4291 10.5727 19.7848 10.3109 19.1406 10.3109Z" fill="currentColor"/></g><defs><clipPath id="clip0_4576_792"><rect width="32" height="32" fill="currentColor"/></clipPath></defs>
  </svg>
);

export const RevenueIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 0V32H32V0H0ZM9.5 26H4.5V12H9.5V26ZM18.5 26H13.5V16H18.5V26ZM27.5 26H22.5V6H27.5V26Z" fill="currentColor"/>
  </svg>
);

export const AchievementsIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <g clipPath="url(#clip0_232_4144)"><path d="M22.9 18H25C28.86 18 32 14.86 32 11C32 7.48 29.38 4.58 26 4.1V0H6V4.1C2.62 4.58 0 7.48 0 11C0 14.86 3.14 18 7 18H9.1C9.98 19.52 11.34 20.74 13 21.4V28H6V32H26V28H19V21.4C20.66 20.74 22 19.52 22.9 18ZM28 11C28 12.66 26.66 14 25 14H24V8H25C26.66 8 28 9.34 28 11ZM7 14C5.34 14 4 12.66 4 11C4 9.34 5.34 8 7 8H8V14H7Z" fill="currentColor"/></g><defs><clipPath id="clip0_232_4144"><rect width="32" height="32" fill="currentColor"/></clipPath></defs>
  </svg>
);

export const StudioIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 4L0 28L32 28L32 4L0 4ZM8 24H4L4 8L8 8L8 24ZM14.64 20.72H12.28L12.28 11.28L14.64 11.28L21.72 16L14.64 20.72ZM28 24H24L24 8L28 8L28 24Z" fill="currentColor"/>
  </svg>
);

export const ModerationIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <g clipPath="url(#clip0_232_4014)"><path d="M26.5 11.84H20.18V5.52L24.94 0.74C23.72 0.28 22.4 0 21 0C14.92 0 10 4.92 10 11C10 12.38 10.26 13.72 10.74 14.94L0 25.68L6.32 32L17.06 21.26C18.28 21.72 19.6 22 21 22C27.08 22 32 17.08 32 11C32 9.62 31.74 8.28 31.26 7.06L26.48 11.84H26.5Z" fill="currentColor"/></g><defs><clipPath id="clip0_232_4014"><rect width="32" height="32" fill="currentColor"/></clipPath></defs>
  </svg>
);

export const CommunityIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <g clipPath="url(#clip0_232_2621)"><path d="M0 20V32H4V24H16V32H32V20H0Z" fill="currentColor"/><path d="M9 18C13.97 18 18 13.97 18 9C18 4.03 13.97 0 9 0C4.03 0 0 4.03 0 9C0 13.97 4.03 18 9 18ZM9 4C11.76 4 14 6.24 14 9C14 11.76 11.76 14 9 14C6.24 14 4 11.76 4 9C4 6.24 6.24 4 9 4Z" fill="currentColor"/><path d="M26 18C29.3137 18 32 15.3137 32 12C32 8.68629 29.3137 6 26 6C22.6863 6 20 8.68629 20 12C20 15.3137 22.6863 18 26 18Z" fill="currentColor"/></g><defs><clipPath id="clip0_232_2621"><rect width="32" height="32" fill="currentColor"/></clipPath></defs>
  </svg>
);

export const DropsIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <g clipPath="url(#clip0_232_2751)"><path d="M18 0H14V18H18V0Z" fill="currentColor"/><path d="M28 4H24V10H28V4Z" fill="currentColor"/><path d="M8 4H4V10H8V4Z" fill="currentColor"/><path d="M24 16V20H28V24H4V20H8V16H0V32H32V16H24Z" fill="currentColor"/></g><defs><clipPath id="clip0_232_2751"><rect width="32" height="32" fill="currentColor"/></clipPath></defs>
  </svg>
);
export const KickMarkIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M3.51318 2H12.961V8.24341H16V5.03906H19.2044V2H28.4868V11.2825H25.4478V14.4741H22.2434V17.5259H25.4478V20.7175H28.4868V30H19.2044V26.9609H16V23.7566H12.961V30H3.51318V2Z" fill="currentColor"/>
  </svg>
);

/** The document glyph Kick puts in the Mod Actions panel header. */
export const ModActionsIcon = ({ className }: P) => (
  <svg viewBox="0 0 32 32" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M24.23 3.03003L7.76997 3.03003C6.35997 3.03003 5.21997 4.17003 5.21997 5.58003L5.21997 26.42C5.21997 27.83 6.35997 28.97 7.76997 28.97L20.19 28.97L26.77 22.39L26.77 5.58003C26.77 4.17003 25.63 3.03003 24.22 3.03003H24.23ZM16 21.07H8.18997V19.16H16L16 21.07ZM23.81 15.29L8.18997 15.29V13.38L23.81 13.38L23.81 15.29ZM23.81 9.51003L8.18997 9.51003V7.60003L23.81 7.60003V9.51003Z" fill="currentColor"/>
  </svg>
);

export const MenuIcon = ({ className }: P) => (
  <svg viewBox="0 0 16 16" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M16 12.519H0V14.5H16V12.519Z" fill="currentColor"/>
    <path d="M16 7.25951H0V9.24049H16V7.25951Z" fill="currentColor"/>
    <path d="M16 2H0V3.98098H16V2Z" fill="currentColor"/>
  </svg>
);

export const ChevronDownIcon = ({ className }: P) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 6L8 10L12 6" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
