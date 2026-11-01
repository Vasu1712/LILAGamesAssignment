export const mmss = (s: number) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

export const dayLabel = (folder: string) => folder.replace('_', ' ').replace('February', 'Feb');

/** Match start in UTC (timestamps are Unix seconds). */
export const startLabel = (unix: number) =>
  new Date(unix * 1000).toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';

export const shortId = (id: string) => (id.length > 12 ? id.slice(0, 8) : id);
