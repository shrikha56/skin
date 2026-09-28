// Comic "spot art" for big story panels: bold ink outlines, flat fills,
// halftone dots and starburst backdrops, drawn to match the portraits.
// spotArt(name) returns an <svg> sized by CSS.

const INK = '#2a2030';
const S = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;
const s2 = `stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"`;

// 16-point starburst behind the subject.
function burst(fill, r1 = 92, r2 = 70, points = 16) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2;
    const r = i % 2 ? r2 : r1;
    pts.push(`${(100 + Math.cos(a) * r).toFixed(1)},${(100 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" ${s2}/>`;
}
const sparkle = (x, y, r, fill = '#fff') =>
  `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${fill}" ${s2}/>`;
const shine = (d) => `<path d="${d}" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".85"/>`;

const ART = {
  moon: (h) => `${burst('#27306b')}
    ${sparkle(46, 52, 10)}${sparkle(160, 150, 8)}${sparkle(150, 44, 6, '#ffd166')}
    <path d="M94 42 A60 60 0 1 0 150.7 124.3 A50 50 0 0 1 94 42 Z" fill="#ffd166" ${S}/>
    <path d="M94 42 A60 60 0 1 0 150.7 124.3 A50 50 0 0 1 94 42 Z" fill="url(#${h})" opacity=".35"/>
    ${shine('M56 90 Q54 116 70 136')}
    <path d="M40 158 q0 -16 18 -16 q4 -14 22 -12 q10 -10 24 0 q18 0 16 18 z" fill="#fff" ${S}/>`,
  candle: (h) => `${burst('#3a1f4a')}
    <circle cx="100" cy="64" r="40" fill="#ffb347" opacity=".35"/>
    <path d="M100 30 C116 50 118 66 100 80 C82 66 84 50 100 30 Z" fill="#ff9f1c" ${S}/>
    <path d="M100 48 C107 58 107 66 100 72 C93 66 93 58 100 48 Z" fill="#ffe066"/>
    <path d="M78 84 H122 V170 H78 Z" fill="#fff6e0" ${S}/>
    <path d="M78 84 H122 V96 Q116 110 112 96 Q106 118 100 96 Q92 106 88 96 Q84 104 78 96 Z" fill="#fff" ${s2}/>
    <rect x="78" y="84" width="44" height="86" fill="url(#${h})" opacity=".25"/>
    <path d="M62 170 H138 L130 182 H70 Z" fill="#c9a071" ${S}/>`,
  sun: (h) => `${burst('#ff9f1c', 96, 62, 12)}
    <circle cx="100" cy="100" r="50" fill="#ffe066" ${S}/>
    <circle cx="100" cy="100" r="50" fill="url(#${h})" opacity=".3"/>
    ${shine('M72 88 Q78 70 96 66')}
    <path d="M84 108 q16 14 32 0" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="84" cy="94" r="4" fill="${INK}"/><circle cx="116" cy="94" r="4" fill="${INK}"/>`,
  alert: () => `${burst('#e0245e', 96, 64, 14)}
    <path d="M86 40 H114 L108 124 H92 Z" fill="#fff" ${S}/>
    <circle cx="100" cy="152" r="14" fill="#fff" ${S}/>
    ${sparkle(40, 50, 9, '#ffe066')}${sparkle(162, 150, 9, '#ffe066')}`,
  rose: (h) => `${burst('#2a0d1c')}
    <path d="M100 118 C104 140 98 160 102 186" stroke="#2f8a5b" stroke-width="8" fill="none" stroke-linecap="round"/>
    <path d="M100 118 C104 140 98 160 102 186" ${s2} fill="none" opacity=".6"/>
    <path d="M102 156 C120 140 140 146 146 156 C128 168 114 166 102 156 Z" fill="#2f8a5b" ${s2}/>
    <path d="M100 44 C132 40 146 66 138 92 C130 118 70 118 62 92 C54 66 68 40 100 44 Z" fill="#e0245e" ${S}/>
    <path d="M100 58 C118 56 124 74 114 86 C104 96 86 90 86 78 C86 66 98 64 104 72" fill="none" ${s2}/>
    <path d="M62 92 C70 106 88 114 100 114" fill="none" ${s2}/>
    <path d="M62 60 C54 78 58 96 74 108" fill="none" stroke="#fff" stroke-width="4" opacity=".6" stroke-linecap="round"/>
    <path d="M40 150 q10 -10 18 0 q-8 10 -18 0z" fill="#e0245e" ${s2}/><path d="M150 60 q10 -10 18 0 q-8 10 -18 0z" fill="#e0245e" ${s2}/>
    <path d="M100 44 C132 40 146 66 138 92 C130 118 70 118 62 92 C54 66 68 40 100 44 Z" fill="url(#${h})" opacity=".3"/>`,
  scales: () => `${burst('#ffd166')}
    <path d="M100 40 V160" ${S}/><path d="M70 170 H130 L122 158 H78 Z" fill="#c9a071" ${S}/>
    <path d="M44 66 H156" ${S}/><circle cx="100" cy="42" r="9" fill="#ffe066" ${S}/>
    <path d="M44 66 L26 112 H62 Z" fill="none" ${s2}/><path d="M156 66 L138 112 H174 Z" fill="none" ${s2}/>
    <path d="M22 112 Q44 138 66 112 Z" fill="#ffe066" ${S}/><path d="M134 112 Q156 138 178 112 Z" fill="#ffe066" ${S}/>`,
  heart: (h) => `${burst('#ffd1e3')}
    <path d="M100 166 C40 122 34 86 50 64 C66 42 94 46 100 70 C106 46 134 42 150 64 C166 86 160 122 100 166 Z" fill="#ff5fa2" ${S}/>
    <path d="M100 166 C40 122 34 86 50 64 C66 42 94 46 100 70 C106 46 134 42 150 64 C166 86 160 122 100 166 Z" fill="url(#${h})" opacity=".3"/>
    ${shine('M62 76 Q66 62 80 60')}
    ${sparkle(160, 40, 10)}${sparkle(36, 150, 8)}${sparkle(170, 150, 6, '#ffe066')}`,
  star: () => `${burst('#efe6f6')}${sparkle(100, 100, 56, '#ffe066')}${sparkle(48, 52, 14)}${sparkle(156, 150, 12)}`,
  key: (h) => `${burst('#6b3aa0')}
    <circle cx="70" cy="80" r="32" fill="#ffd166" ${S}/><circle cx="70" cy="80" r="13" fill="#6b3aa0" ${S}/>
    <path d="M94 102 L156 164 M132 140 L146 126 M146 154 L160 140" fill="none" stroke="#ffd166" stroke-width="16" stroke-linecap="round"/>
    <path d="M94 102 L156 164 M132 140 L146 126 M146 154 L160 140" fill="none" ${s2}/>
    <circle cx="70" cy="80" r="32" fill="url(#${h})" opacity=".3"/>
    ${sparkle(150, 52, 10)}`,
  storm: () => `${burst('#1a1f45')}
    <path d="M44 104 q-2 -30 30 -30 q10 -28 42 -22 q30 -6 38 24 q26 2 24 28 z" fill="#c8cfe6" ${S}/>
    <path d="M104 100 L84 136 H104 L92 176 L132 126 H110 L124 100 Z" fill="#ffe066" ${S}/>
    <path d="M52 128 l-8 22 M66 132 l-8 22 M146 124 l-8 22 M160 130 l-8 22" stroke="#9fb3ff" stroke-width="5" stroke-linecap="round"/>`,
  clipboard: (h) => `${burst('#bfe6d3')}
    <rect x="50" y="36" width="100" height="136" rx="10" fill="#c9a071" ${S}/>
    <rect x="62" y="54" width="76" height="106" fill="#fff" ${s2}/>
    <rect x="80" y="28" width="40" height="20" rx="5" fill="#8a8fa6" ${S}/>
    <rect x="72" y="72" width="12" height="12" ${s2} fill="#fff"/><path d="M74 78 l4 5 l9 -12" stroke="#e0245e" stroke-width="4" fill="none" stroke-linecap="round"/>
    <rect x="72" y="98" width="12" height="12" ${s2} fill="#fff"/><path d="M74 104 l4 5 l9 -12" stroke="#e0245e" stroke-width="4" fill="none" stroke-linecap="round"/>
    <rect x="72" y="124" width="12" height="12" ${s2} fill="#fff"/>
    <path d="M92 78 H126 M92 104 H122 M92 130 H118" ${s2}/>
    <rect x="50" y="36" width="100" height="136" rx="10" fill="url(#${h})" opacity=".2"/>`,
  school: (h) => `${burst('#dcecf7')}
    <path d="M30 170 V100 L100 64 L170 100 V170 Z" fill="#fbe8dc" ${S}/>
    <path d="M80 170 V78 L100 60 L120 78 V170" fill="#f6d9c4" ${S}/>
    <circle cx="100" cy="92" r="12" fill="#fff" ${s2}/><path d="M100 86 V92 L104 95" ${s2} fill="none"/>
    <path d="M100 60 V36 L120 42 L100 48" fill="#e0245e" ${s2}/>
    <rect x="44" y="112" width="20" height="18" fill="#9fd6ff" ${s2}/><rect x="136" y="112" width="20" height="18" fill="#9fd6ff" ${s2}/>
    <rect x="44" y="142" width="20" height="18" fill="#9fd6ff" ${s2}/><rect x="136" y="142" width="20" height="18" fill="#9fd6ff" ${s2}/>
    <path d="M90 170 V140 Q100 128 110 140 V170" fill="#6b3a2a" ${s2}/>
    <path d="M30 170 V100 L100 64 L170 100 V170 Z" fill="url(#${h})" opacity=".15"/>`,
  knife: () => `${burst('#e0245e', 96, 66, 14)}
    <path d="M58 150 L150 42 C164 70 150 104 104 128 Z" fill="#eef2f7" ${S}/>
    ${shine('M120 76 L142 52')}
    <path d="M44 150 L74 180 L88 166 L58 136 Z" fill="#2a2633" ${S}/>
    <path d="M52 130 L94 172" ${S}/>
    <path d="M112 124 q4 12 0 22 q-6 -6 0 -22z" fill="#c4002e" ${s2}/><path d="M96 134 q3 8 0 15 q-4 -4 0 -15z" fill="#c4002e" ${s2}/>`,
  bell: (h) => `${burst('#ffd166')}
    <path d="M60 136 V100 C60 70 76 52 100 52 C124 52 140 70 140 100 V136 L152 150 H48 Z" fill="#ffb627" ${S}/>
    <path d="M60 136 V100 C60 70 76 52 100 52 C124 52 140 70 140 100 V136 L152 150 H48 Z" fill="url(#${h})" opacity=".3"/>
    <circle cx="100" cy="164" r="12" fill="#ffb627" ${S}/><path d="M100 52 V38" ${S}/>
    ${shine('M78 96 Q80 76 94 68')}
    <path d="M30 80 q-10 20 0 40 M170 80 q10 20 0 40 M18 70 q-14 30 0 60 M182 70 q14 30 0 60" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  lock: (h) => `${burst('#ffd1e3')}
    <path d="M70 92 V70 a30 30 0 0 1 60 0 V92" fill="none" stroke="#8a8fa6" stroke-width="14"/>
    <path d="M70 92 V70 a30 30 0 0 1 60 0 V92" fill="none" ${s2}/>
    <path d="M100 176 C50 142 42 112 54 94 C66 78 90 80 100 98 C110 80 134 78 146 94 C158 112 150 142 100 176 Z" fill="#ff5fa2" ${S}/>
    <path d="M100 176 C50 142 42 112 54 94 C66 78 90 80 100 98 C110 80 134 78 146 94 C158 112 150 142 100 176 Z" fill="url(#${h})" opacity=".3"/>
    <circle cx="100" cy="124" r="9" fill="${INK}"/><path d="M100 128 V146" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`,
  magnifier: (h) => `${burst('#dcecf7')}
    <path d="M128 128 L170 170" stroke="#6b3a2a" stroke-width="18" stroke-linecap="round"/>
    <path d="M128 128 L170 170" ${s2}/>
    <circle cx="90" cy="90" r="50" fill="#e8f6ff" ${S}/>
    <circle cx="90" cy="90" r="50" fill="url(#${h})" opacity=".2"/>
    <path d="M76 70 q10 -4 12 8 q2 12 -8 14 q-10 -2 -4 -22z M96 96 q10 -4 12 8 q2 12 -8 14 q-10 -2 -4 -22z" fill="#c4002e" ${s2}/>
    ${shine('M58 76 Q62 58 80 52')}`,
  camera: () => `${burst('#27306b')}
    <rect x="36" y="70" width="100" height="64" rx="10" fill="#8a8fa6" ${S}/>
    <path d="M136 90 L170 72 V132 L136 114 Z" fill="#5a5f76" ${S}/>
    <circle cx="68" cy="102" r="16" fill="#1a1f45" ${S}/><circle cx="64" cy="98" r="5" fill="#fff"/>
    <circle cx="118" cy="84" r="6" fill="#e0245e" ${s2}/>
    <path d="M86 134 L76 170 H104 L96 134" fill="#8a8fa6" ${S}/>`,
  book: (h) => `${burst('#f6e7d2')}
    <path d="M100 58 C80 46 50 46 30 54 V156 C50 148 80 148 100 160 C120 148 150 148 170 156 V54 C150 46 120 46 100 58 Z" fill="#fff" ${S}/>
    <path d="M100 58 V160" ${s2}/>
    <path d="M44 76 H86 M44 92 H86 M44 108 H80 M114 76 H156 M114 92 H156 M114 108 H146" stroke="#8a8fa6" stroke-width="4" stroke-linecap="round"/>
    <path d="M100 58 C80 46 50 46 30 54 V156 C50 148 80 148 100 160 C120 148 150 148 170 156 V54 C150 46 120 46 100 58 Z" fill="url(#${h})" opacity=".15"/>
    ${sparkle(160, 36, 10, '#ffe066')}`,
};

let uid = 0;
export const SPOT_ART = Object.keys(ART);

export function spotArt(name) {
  const draw = ART[name] ?? ART.star;
  const h = `ht${++uid}`;
  return `<svg class="spot-art" viewBox="0 0 200 200" aria-hidden="true">
    <defs><pattern id="${h}" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.6" fill="${INK}"/></pattern></defs>
    ${draw(h)}
  </svg>`;
}
