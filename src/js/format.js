const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function bytes(value, decimals = 1) {
  if (!isNum(value) || value < 0) return '--';
  if (value < 1) return '0 B';
  const exp = Math.min(UNITS.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** exp;
  return `${scaled.toFixed(exp === 0 ? 0 : decimals)} ${UNITS[exp]}`;
}

export function rate(value) {
  return isNum(value) ? `${bytes(Math.max(0, value))}/s` : '--';
}

// Percentages are clamped: a bad sample must never render as "10396.4 %".
export function percent(value, decimals = 1) {
  return isNum(value) ? clamp(value, 0, 100).toFixed(decimals) : '--';
}

export function fixed(value, decimals = 1) {
  return isNum(value) ? value.toFixed(decimals) : '--';
}

export function uptimeParts(seconds) {
  const total = isNum(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60)
  };
}

export function duration(seconds) {
  if (!isNum(seconds) || seconds < 0) return '--';
  const { days, hours, minutes } = uptimeParts(seconds);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}

const pad = (n) => String(n).padStart(2, '0');

export function clock(ms, withSeconds = true) {
  const d = new Date(ms);
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base;
}

export function dateTime(ms) {
  return new Date(ms).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}
