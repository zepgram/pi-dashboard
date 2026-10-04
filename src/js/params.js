// URL parameters, handy for kiosks and screenshots. They only affect this
// browser session and are never written back to the shared settings.
//
//   ?mode=normal|compact|ultra     display density
//   ?theme=default|emerald|rose|amber|indigo
//   ?modal=settings|api|sysinfo|services|help|chart
//   ?chart=cpu|memory|temperature|network|load   metric for ?modal=chart
//   ?range=live|1h|24h             range for ?modal=chart
//   ?welcome=0                     hide the first-visit hint
import { MODES, state, THEMES } from './state.js';

const params = new URLSearchParams(window.location.search);

export function applyParamOverrides() {
  const mode = params.get('mode');
  if (MODES.includes(mode)) state.overrides.displayMode = mode;
  const theme = params.get('theme');
  if (theme && THEMES[theme]) state.overrides.theme = theme;
}

export const welcomeAllowed = () => params.get('welcome') !== '0';

export function openParamModal(openers) {
  const modal = params.get('modal');
  if (!modal || !openers[modal]) return;
  if (modal === 'chart') openers.chart(params.get('chart') || 'cpu', params.get('range') || 'live');
  else openers[modal]();
}
