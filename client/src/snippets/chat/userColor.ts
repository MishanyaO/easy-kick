const USER_COLORS = [
  '#e05d5d', '#e09a5d', '#e0c95d', '#8fd45d', '#5dd4a8', '#5db8e0',
  '#7d8fe0', '#a87de0', '#d47ec0', '#c0c7c9', '#e0b0a0', '#9ad47e',
];

/** Deterministic per-username chat colour (stable across renders/sessions). */
export function userColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}
