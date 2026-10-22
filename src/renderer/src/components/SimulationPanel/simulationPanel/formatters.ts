/** Compact interval label; exact milliseconds remain available in the editor. */
export function formatInterval(milliseconds?: number): string {
  if (!Number.isFinite(milliseconds)) return 'Invalid';
  const value = milliseconds!;
  if (value >= 3600000 && value % 3600000 === 0) return `${value / 3600000} h`;
  if (value >= 60000 && value % 60000 === 0) return `${value / 60000} min`;
  return `${value / 1000} s`;
}
