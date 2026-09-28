// Hand-drawn style line icons (24x24, round caps, 2px ink stroke) used instead
// of emoji so every symbol matches the portraits' line art. Colour follows
// `currentColor`; `fill` accents use the .ic-fill class so CSS can tint them.

const P = {
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5C4.7 19 4 18.3 4 17.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5c.8 0 1.5-.7 1.5-1.5z"/><path d="M11 19c.6.7 1.4.7 2 0"/><path d="M6.5 8h2.5M15 8h2.5M15 11h2.5"/>',
  camera: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/><circle cx="7" cy="11" r="1.2" class="ic-fill"/>',
  note: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5" class="ic-fill"/><circle cx="16.5" cy="16" r="2.5" class="ic-fill"/>',
  bandage: '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M10.3 10.3l3.4 3.4M9.5 12.5l.01 0M12 9.8l.01 0M14.5 12.2l.01 0M12 14.5l.01 0"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M12 3v2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2.5"/>',
  page: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 12h6M9 15h3"/><path d="M15 3v3h3"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><path d="M6.5 14.5h4"/>',
  mirror: '<ellipse cx="12" cy="9" rx="5.5" ry="6"/><path d="M12 15v6M9 21h6"/><path d="M9.5 7c.6-1.2 1.6-1.8 2.7-1.9"/>',
  vial: '<path d="M9 3h6M10 3v6l-4.5 9a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7.5 15h9" /><circle cx="11" cy="18" r=".8" class="ic-fill"/>',
  whistle: '<path d="M3 11h9a5 5 0 1 1-5 5v-1H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="16" r="1.4" class="ic-fill"/><path d="M13 8l2-3M17 9l3-2M16 5l1-2"/>',
  letter: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3.5 7l8.5 6.5L20.5 7"/><path d="M12 17.2l-1.7-1.5a1 1 0 0 1 1.7-1 1 1 0 0 1 1.7 1z" class="ic-fill"/>',
  key: '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M16.5 16.5l2-2M14 14l2-2"/>',
  gem: '<path d="M7 4h10l4 5-9 11L3 9z"/><path d="M3 9h18M9.5 4 8 9l4 11 4-11-1.5-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/><path d="M8 8.5a3 3 0 0 1 2.5-1.5"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" class="ic-fill"/>',
  flower: '<circle cx="12" cy="8" r="2" class="ic-fill"/><path d="M12 6a2.5 2.5 0 1 1 2 3.8 2.5 2.5 0 1 1-2 3 2.5 2.5 0 1 1-2-3A2.5 2.5 0 1 1 12 6z"/><path d="M12 12v9M12 17c-2-2-4-2-5-1M12 18c2-2 4-2 5-1"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5v.5M15 9.5v.5"/>',
  blush: '<circle cx="12" cy="12" r="8.5"/><path d="M10 15.5h4"/><path d="M8 10.5l2-1M16 10.5l-2-1"/><path d="M6.5 13l1.5-1M7.5 14l1.5-1M17.5 13l-1.5-1M16.5 14l-1.5-1"/>',
  smirk: '<circle cx="12" cy="12" r="8.5"/><path d="M9 15c2 .8 4 .6 6-1.2"/><path d="M8.5 9.5h2M13.5 9l2 .5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3" class="ic-fill"/>',
  knife: '<path d="M3 21l6.5-6.5"/><path d="M8 13.5l2.5 2.5"/><path d="M9.5 14.5 20.5 3.5c.5 4-1.5 8.5-6.5 11.5z"/>',
  sponge: '<rect x="4" y="9" width="16" height="10" rx="3"/><circle cx="9" cy="13" r=".8" class="ic-fill"/><circle cx="14" cy="15" r=".8" class="ic-fill"/><circle cx="16" cy="12" r=".8" class="ic-fill"/><path d="M8 6c.5-1.5 1.5-1.5 2 0M13 5c.5-1.5 1.5-1.5 2 0"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  moon: '<path d="M19 15.5A8 8 0 0 1 8.5 5a8 8 0 1 0 10.5 10.5z"/>',
  candle: '<rect x="8.5" y="10" width="7" height="11" rx="1"/><path d="M12 10V8"/><path d="M12 3c1.6 1.8 1.6 3.3 0 4.5-1.6-1.2-1.6-2.7 0-4.5z" class="ic-fill"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  alert: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 9.5v5"/><path d="M12 17.3v.2"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" class="ic-fill"/>',
  scales: '<path d="M12 4v16M8 20h8M5 7h14"/><path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r="1" class="ic-fill"/><circle cx="15.5" cy="15.5" r="1" class="ic-fill"/><circle cx="12" cy="12" r="1" class="ic-fill"/>',
  star: '<path d="M12 3.5l2.5 5.3 5.7.7-4.2 3.9 1.1 5.7L12 16.3 6.9 19l1.1-5.7-4.2-3.9 5.7-.7z" class="ic-fill"/>',
  skull: '<path d="M5 11a7 7 0 0 1 14 0c0 2.4-1 3.7-2 4.5V19H7v-3.5C6 14.7 5 13.4 5 11z"/><circle cx="9.3" cy="11.5" r="1.6" class="ic-fill"/><circle cx="14.7" cy="11.5" r="1.6" class="ic-fill"/><path d="M10 19v2M14 19v2M12 14.5v1"/>',
  door: '<path d="M6 21V4h10v17M4 21h14"/><path d="M16 5l3 1v15"/><circle cx="13.5" cy="12.5" r=".8" class="ic-fill"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" class="ic-fill"/>',
  rose: '<path d="M12 4c3 0 4.5 2 4.5 4S14.5 12 12 12 7.5 10 7.5 8 9 4 12 4z"/><path d="M10 6.5c1 1.5 3 1.5 4 0M12 12v9M12 16c-2.5-1-4-.5-5 .5M12 17.5c2-1.5 3.5-1 4.5 0"/>',
  arrow: '<path d="M5 12h13M13 6.5 18.5 12 13 17.5"/>',
  back: '<path d="M19 12H6M11 6.5 5.5 12 11 17.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  caret: '<path d="M6 9.5l6 6 6-6"/>',
};

export const ICON_NAMES = Object.keys(P);

export function icon(name, cls = '') {
  const body = P[name];
  if (!body) return '';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
