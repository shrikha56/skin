// Procedural anime bust portraits as inline SVG, so the prototype needs no art
// assets. The look follows the character-sheet reference: clean dark ink
// outlines, flat pastel fills with one cel-shade tone, and a distinct outfit
// and silhouette per student. Expressions swap eyes, brows, mouth and overlays.

import { CHAR_BY_ID } from './core.js';

const INK = '#2a2030';
const ink = (w = 2.5) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
};

// --- Hair (drawn behind the head) ------------------------------------------
function backHair(style, h) {
  const d = shade(h, -30);
  switch (style) {
    case 'twintails':
      return `
        <path d="M50 78 Q2 96 10 176 Q14 222 40 244 Q30 200 44 150 Q52 116 62 96 Z" fill="${h}" ${ink()}/>
        <path d="M150 78 Q198 96 190 176 Q186 222 160 244 Q170 200 156 150 Q148 116 138 96 Z" fill="${h}" ${ink()}/>
        <path d="M26 130 Q22 180 36 222" stroke="${d}" stroke-width="3" fill="none"/>
        <path d="M174 130 Q178 180 164 222" stroke="${d}" stroke-width="3" fill="none"/>
        <path d="M44 90 Q40 38 100 32 Q160 38 156 90 L150 140 L50 140 Z" fill="${h}" ${ink()}/>`;
    case 'updo':
      return `
        <circle cx="100" cy="30" r="30" fill="${h}" ${ink()}/>
        <path d="M84 22 Q100 6 116 22 Q106 34 96 28" stroke="${d}" stroke-width="3" fill="none"/>
        <path d="M44 96 Q40 42 100 36 Q160 42 156 96 L150 124 L50 124 Z" fill="${h}" ${ink()}/>
        <path d="M50 110 Q36 140 48 170 Q56 150 54 128" fill="${h}" ${ink(2)}/>
        <path d="M150 110 Q164 140 152 170 Q144 150 146 128" fill="${h}" ${ink(2)}/>`;
    case 'long':
      return `
        <path d="M44 92 Q36 36 100 30 Q164 36 156 92 L172 250 L28 250 Z" fill="${h}" ${ink()}/>
        <path d="M52 140 Q46 200 50 248 M148 140 Q154 200 150 248" stroke="${d}" stroke-width="3" fill="none"/>`;
    case 'messy':
      return `<path d="M42 104 L30 84 L44 78 L34 56 L58 60 L60 32 L82 46 L96 22 L110 42 L130 26 L134 50 L160 44 L152 70 L172 80 L156 96 L160 116 L40 116 Z" fill="${h}" ${ink()}/>`;
    case 'bob':
      return `<path d="M40 104 Q34 36 100 30 Q166 36 160 104 L164 172 Q148 180 132 176 L68 176 Q52 180 36 172 Z" fill="${h}" ${ink()}/>`;
    case 'short':
    default:
      return `<path d="M44 106 Q38 38 100 32 Q162 38 156 106 L150 128 L50 128 Z" fill="${h}" ${ink()}/>`;
  }
}

// --- Fringe (drawn over the face) ------------------------------------------
function bangs(style, h) {
  const hi = shade(h, 45);
  const d = shade(h, -30);
  const shine = (y = 60) => `<path d="M72 ${y} Q100 ${y - 12} 128 ${y}" stroke="${hi}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".85"/>`;
  switch (style) {
    case 'messy':
      return `<path d="M48 110 L52 74 Q100 34 150 74 L154 110 L140 84 L132 106 L118 78 L106 100 L94 76 L82 104 L72 80 L62 104 Z" fill="${h}" ${ink()}/>
        <path d="M96 76 L100 94 M120 80 L124 96" stroke="${d}" stroke-width="2.5"/>${shine(58)}`;
    case 'short':
      return `<path d="M46 112 Q44 48 100 42 Q156 48 154 112 L144 90 L128 102 L114 84 L100 100 L86 84 L72 102 L56 90 Z" fill="${h}" ${ink()}/>${shine(58)}`;
    case 'bob':
      return `<path d="M44 114 Q42 44 100 40 Q158 44 156 114 L156 100 L44 100 Z" fill="${h}" ${ink()}/>
        <path d="M44 100 L156 100 L156 110 L44 110 Z" fill="${h}"/>
        <path d="M44 104 Q100 110 156 104" stroke="${INK}" stroke-width="2.5" fill="none"/>
        <path d="M44 104 L40 172 M156 104 L160 172" stroke="${INK}" stroke-width="2.5"/>${shine(56)}`;
    case 'updo':
      return `<path d="M46 110 Q46 46 100 42 Q154 46 154 110 Q140 76 112 70 Q96 86 72 84 Q56 92 46 110 Z" fill="${h}" ${ink()}/>
        <path d="M52 104 Q44 126 50 150" stroke="${h}" stroke-width="6" fill="none"/>
        <path d="M52 104 Q44 126 50 150" stroke="${INK}" stroke-width="1.5" fill="none" opacity=".6"/>${shine(56)}`;
    case 'long':
      return `<path d="M44 118 Q42 44 100 40 Q158 44 156 118 L146 92 L134 110 L122 84 L104 104 L92 82 L78 108 L62 88 Z" fill="${h}" ${ink()}/>
        <path d="M46 110 Q40 160 52 200 M154 110 Q160 160 148 200" stroke="${INK}" stroke-width="2.5" fill="none"/>${shine(58)}`;
    case 'twintails':
    default:
      return `<path d="M46 112 Q44 46 100 40 Q156 46 154 112 L142 88 L130 104 L118 80 L100 102 L84 78 L70 104 L58 88 Z" fill="${h}" ${ink()}/>
        <circle cx="50" cy="84" r="7" fill="#e0245e" ${ink(2)}/><circle cx="150" cy="84" r="7" fill="#e0245e" ${ink(2)}/>${shine(58)}`;
  }
}

// --- Outfits ---------------------------------------------------------------
function outfit(kind, skin) {
  const neck = `<path d="M86 172 L86 202 L114 202 L114 172 Z" fill="${shade(skin, -22)}" ${ink(2)}/>`;
  switch (kind) {
    case 'sailor':
      return `${neck}
        <path d="M34 250 Q38 206 100 198 Q162 206 166 250 Z" fill="#fbfbff" ${ink()}/>
        <path d="M58 204 L100 236 L142 204 L154 214 L100 248 L46 214 Z" fill="#2c3a78" ${ink()}/>
        <path d="M62 212 L100 240 L138 212" stroke="#fff" stroke-width="2" fill="none"/>
        <path d="M88 224 L100 238 L112 224 L118 248 L100 240 L82 248 Z" fill="#e0245e" ${ink(2)}/>`;
    case 'gown':
      return `<path d="M30 250 Q34 200 100 192 Q166 200 170 250 Z" fill="${skin}" ${ink()}/>
        <path d="M86 172 L86 196 L114 196 L114 172" fill="${shade(skin, -22)}"/>
        <path d="M44 250 Q52 222 78 222 Q100 232 122 222 Q148 222 156 250 Z" fill="#2f8a5b" ${ink()}/>
        <path d="M70 230 Q100 244 130 230 M84 236 L92 250 M116 236 L108 250" stroke="#1d5e3c" stroke-width="2.5" fill="none"/>
        <path d="M76 206 Q100 222 124 206" stroke="#fff" stroke-width="4" fill="none" stroke-dasharray="1 6" stroke-linecap="round"/>`;
    case 'trench':
      return `${neck}
        <path d="M30 250 Q34 204 100 196 Q166 204 170 250 Z" fill="#c9a071" ${ink()}/>
        <path d="M82 200 L100 250 L118 200 Z" fill="#fff" ${ink(2)}/>
        <path d="M96 208 L100 250 L104 208 Z" fill="#23294a"/>
        <path d="M60 206 L82 200 L94 250 L70 250 Z M140 206 L118 200 L106 250 L130 250 Z" fill="#b48a5d" ${ink()}/>`;
    case 'dress':
      return `${neck}
        <ellipse cx="46" cy="222" rx="22" ry="18" fill="#fff" ${ink()}/>
        <ellipse cx="154" cy="222" rx="22" ry="18" fill="#fff" ${ink()}/>
        <path d="M44 250 Q48 208 100 202 Q152 208 156 250 Z" fill="#fff6fa" ${ink()}/>
        <path d="M80 204 Q100 222 120 204" fill="none" ${ink(2)}/>
        <path d="M96 222 Q100 216 104 222 Q100 230 96 222 Z" fill="#f59ac0" ${ink(1.5)}/>`;
    case 'gakuran':
      return `${neck}
        <path d="M30 250 Q34 204 100 196 Q166 204 170 250 Z" fill="#d9dce6" ${ink()}/>
        <path d="M80 196 L80 210 L120 210 L120 196" fill="#2a2633" ${ink(2)}/>
        <path d="M100 210 L100 250" stroke="${INK}" stroke-width="2"/>
        <circle cx="106" cy="222" r="3" fill="#e2b34a" ${ink(1)}/><circle cx="106" cy="240" r="3" fill="#e2b34a" ${ink(1)}/>
        <path d="M44 214 L44 250 M156 214 L156 250" stroke="#2a2633" stroke-width="6"/>`;
    case 'techsuit':
    default:
      return `${neck}
        <path d="M30 250 Q34 204 100 196 Q166 204 170 250 Z" fill="#3a3a48" ${ink()}/>
        <path d="M82 190 L82 212 Q100 220 118 212 L118 190" fill="#3a3a48" ${ink(2)}/>
        <path d="M60 216 Q64 236 58 250 M140 216 Q136 236 142 250 M82 228 L118 228" stroke="#23232c" stroke-width="3" fill="none"/>
        <rect x="92" y="222" width="16" height="8" rx="2" fill="#6fe3ff" ${ink(1.5)}/>`;
  }
}

// --- Face ------------------------------------------------------------------
function eyes(expr, eye) {
  const L = 77;
  const R = 123;
  const Y = 126;
  const open = (cx, pupil = 7, glint = true, iris = eye) => `
    <ellipse cx="${cx}" cy="${Y}" rx="12" ry="14.5" fill="#fff"/>
    <ellipse cx="${cx}" cy="${Y + 2}" rx="9.5" ry="12.5" fill="${iris}"/>
    <ellipse cx="${cx}" cy="${Y - 3}" rx="9.5" ry="6" fill="${shade(iris, -45)}" opacity=".55"/>
    <ellipse cx="${cx}" cy="${Y + 3}" rx="${pupil * 0.62}" ry="${pupil}" fill="#140d18"/>
    ${glint ? `<circle cx="${cx - 4}" cy="${Y - 3}" r="3.4" fill="#fff"/><circle cx="${cx + 4}" cy="${Y + 7}" r="1.7" fill="#fff" opacity=".85"/>` : ''}
    <path d="M${cx - 15} ${Y - 9} Q${cx} ${Y - 20} ${cx + 15} ${Y - 9}" stroke="${INK}" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    <path d="M${cx + 12} ${Y - 11} l5 -3" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
  switch (expr) {
    case 'happy':
    case 'blush':
      return [L, R].map((cx) => `<path d="M${cx - 12} ${Y + 4} Q${cx} ${Y - 10} ${cx + 12} ${Y + 4}" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`).join('');
    case 'shocked':
      return [L, R].map((cx) => `
        <ellipse cx="${cx}" cy="${Y}" rx="13" ry="15" fill="#fff" ${ink(2.5)}/>
        <circle cx="${cx}" cy="${Y + 1}" r="3.5" fill="#140d18"/>`).join('');
    case 'suspicious':
      return [L, R].map((cx) => `${open(cx, 6)}
        <path d="M${cx - 16} ${Y - 3} L${cx + 16} ${Y - 7} L${cx + 16} ${Y - 24} L${cx - 16} ${Y - 24} Z" fill="var(--skin)"/>
        <path d="M${cx - 15} ${Y - 3} L${cx + 15} ${Y - 7}" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`).join('');
    case 'sad':
      return [L, R].map((cx) => `${open(cx, 7)}
        <path d="M${cx - 12} ${Y + 16} Q${cx - 16} ${Y + 26} ${cx - 12} ${Y + 32}" stroke="#7ec3f0" stroke-width="3" fill="none"/>`).join('');
    case 'yandere':
      // Hollow, over-wide eyes with pin-prick pupils — the classic "unhinged" look.
      return [L, R].map((cx) => `
        <ellipse cx="${cx}" cy="${Y}" rx="13" ry="15" fill="#fff" ${ink(2.5)}/>
        <circle cx="${cx}" cy="${Y + 1}" r="8" fill="none" stroke="#6b3a7a" stroke-width="2"/>
        <circle cx="${cx}" cy="${Y + 1}" r="4.5" fill="none" stroke="#6b3a7a" stroke-width="1.5"/>
        <circle cx="${cx}" cy="${Y + 1}" r="1.6" fill="#140d18"/>
        <path d="M${cx - 14} ${Y + 16} Q${cx} ${Y + 20} ${cx + 14} ${Y + 16}" stroke="#6b3a7a" stroke-width="2" fill="none"/>`).join('');
    case 'dead':
      return [L, R].map((cx) => `<path d="M${cx - 9} ${Y - 9} L${cx + 9} ${Y + 9} M${cx + 9} ${Y - 9} L${cx - 9} ${Y + 9}" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`).join('');
    default:
      return open(L) + open(R);
  }
}

function brows(expr, h) {
  const c = shade(h, -50);
  const b = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`;
  switch (expr) {
    case 'shocked': return b(64, 96, 86, 92) + b(114, 92, 136, 96);
    case 'suspicious': return b(64, 100, 88, 106) + b(112, 106, 136, 100);
    case 'sad': return b(64, 104, 86, 98) + b(114, 98, 136, 104);
    case 'yandere': return b(64, 98, 86, 96) + b(114, 96, 136, 98);
    default: return b(64, 102, 86, 100) + b(114, 100, 136, 102);
  }
}

function mouth(expr) {
  const s = '#7a2a3d';
  switch (expr) {
    case 'happy': return `<path d="M88 160 Q100 176 112 160 Z" fill="${s}" ${ink(2)}/><path d="M93 167 Q100 172 107 167" fill="#ef8aa0"/>`;
    case 'blush': return `<path d="M93 163 Q100 168 107 163" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    case 'shocked': return `<ellipse cx="100" cy="166" rx="7" ry="9" fill="${s}" ${ink(2)}/>`;
    case 'suspicious': return `<path d="M91 165 L110 162" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'sad': return `<path d="M91 168 Q100 160 109 168" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    case 'yandere': return `<path d="M76 154 Q100 188 124 154 Q100 166 76 154 Z" fill="${s}" ${ink(2)}/>
      <path d="M80 157 Q100 166 120 157 L118 162 Q100 169 82 162 Z" fill="#fff"/>`;
    case 'dead': return `<path d="M92 166 L108 166" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
    default: return `<path d="M94 164 Q100 168 106 164" stroke="${INK}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
  }
}

function overlays(expr, n) {
  let out = '';
  if (['blush', 'happy', 'yandere'].includes(expr)) {
    out += `<g opacity="${expr === 'happy' ? 0.5 : 0.85}">
      <ellipse cx="68" cy="148" rx="12" ry="6" fill="#ff8fab"/><ellipse cx="132" cy="148" rx="12" ry="6" fill="#ff8fab"/>
      <path d="M61 146 l5 -5 M67 148 l5 -5 M73 150 l5 -5 M125 146 l5 -5 M131 148 l5 -5 M137 150 l5 -5" stroke="#e0245e" stroke-width="1.5"/></g>`;
  }
  if (expr === 'yandere') {
    out += `<rect x="40" y="40" width="120" height="100" fill="url(#ydShade${n})" clip-path="url(#faceClip${n})"/>
      <g stroke="#4a2a5a" stroke-width="2" opacity=".7" clip-path="url(#faceClip${n})">
        ${[60, 70, 80, 90, 110, 120, 130, 140].map((x, i) => `<path d="M${x} 72 L${x} ${96 + (i % 3) * 6}"/>`).join('')}
      </g>`;
  }
  if (expr === 'shocked') out += `<path d="M152 94 Q161 110 152 119 Q143 110 152 94 Z" fill="#bfe6ff" ${ink(2)}/>`;
  if (expr === 'suspicious') out += `<path d="M148 80 Q158 86 152 96" stroke="#5aa9e6" stroke-width="2.5" fill="none"/>`;
  return out;
}

let uid = 0;

export function portraitSVG(id, expr = 'neutral', { dead = false } = {}) {
  const c = CHAR_BY_ID[id];
  const e = dead ? 'dead' : expr;
  const h = c.hairHex;
  const n = ++uid;
  return `<svg viewBox="0 0 200 250" class="portrait-svg${dead ? ' is-dead' : ''}" role="img" aria-label="${c.short} (${e})" style="--skin:${c.skin}">
  <defs>
    <linearGradient id="ydShade${n}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a0a2a" stop-opacity=".8"/><stop offset="1" stop-color="#2a0a2a" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="faceClip${n}"><ellipse cx="100" cy="126" rx="54" ry="62"/></clipPath>
  </defs>
  ${backHair(c.style, h)}
  ${outfit(c.outfit, c.skin)}
  <ellipse cx="46" cy="128" rx="7" ry="11" fill="${c.skin}" ${ink(2)}/>
  <ellipse cx="154" cy="128" rx="7" ry="11" fill="${c.skin}" ${ink(2)}/>
  <path d="M46 118 Q46 186 100 190 Q154 186 154 118 Q154 64 100 64 Q46 64 46 118 Z" fill="${c.skin}" ${ink()}/>
  <path d="M52 108 Q100 124 148 108 L148 100 L52 100 Z" fill="${shade(c.skin, -20)}" opacity=".55"/>
  ${eyes(e, c.eyeHex)}
  ${brows(e, h)}
  <path d="M100 142 l-2 6 l3 0" stroke="${shade(c.skin, -45)}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  ${mouth(e)}
  ${overlays(e, n)}
  ${bangs(c.style, h)}
</svg>`;
}
