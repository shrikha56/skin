// Static content: the academy map, the cast, the secret archetypes and items.
// Everything here is plain data so the engine stays deterministic and testable.

export const TITLE = 'Crimson Confession';
export const SETTING = 'Hoshizora Academy';

// 3x2 grid. Movement is orthogonal between neighbouring rooms.
export const ROOMS = [
  { id: 'library', name: 'Library', x: 0, y: 0, camera: false, item: 'diary',
    action: { id: 'research', icon: 'book', label: 'Dig through the gossip archive', desc: 'Once per match: learn one student who is definitely NOT the Obsessive.' },
    blurb: 'Tall shelves swallow the lamplight. Easy to vanish between the stacks.' },
  { id: 'classroom', name: 'Classroom 2-B', x: 1, y: 0, camera: true, item: 'keycard',
    action: { id: 'cameras', icon: 'camera', label: 'Check the security monitor', desc: 'Once per day: see where every student is right now, and review last night\'s footage.' },
    blurb: 'The security monitor hums behind the teacher\'s desk. A camera watches the door.' },
  { id: 'music', name: 'Music Room', x: 2, y: 0, camera: false, item: 'mirror',
    action: { id: 'rehearse', icon: 'note', label: 'Rehearse together', desc: 'Everyone here trusts you more (+8). The room is soundproof: nobody outside hears a scream.' }, soundproof: true,
    blurb: 'Soundproofed walls. Nobody would hear a thing in here.' },
  { id: 'infirmary', name: 'Infirmary', x: 0, y: 1, camera: false, item: 'salts',
    action: { id: 'wash', icon: 'bandage', label: 'Wash up & rest', desc: 'Scrub off any bloodstains and recover 15 sanity.' },
    blurb: 'Antiseptic, white curtains, and a cabinet that is never locked.' },
  { id: 'courtyard', name: 'Courtyard', x: 1, y: 1, camera: true, item: 'whistle',
    action: { id: 'bell', icon: 'bell', label: 'Ring the emergency bell', desc: 'Once per match: call a Class Trial right now.' },
    blurb: 'Rain hammers the glass roof. A camera blinks over the fountain.' },
  { id: 'dorm', name: 'Dorm Hall', x: 2, y: 1, camera: false, item: 'letter',
    action: { id: 'lock', icon: 'lock', label: 'Barricade your door tonight', desc: 'Once per match: you sleep here tonight and nobody can get in (unless the Obsessive has Silent Step).' },
    blurb: 'Rows of doors, one flickering light, and the smell of cheap tea.' },
];

export const PERIODS = ['Morning', 'Lunch', 'After School', 'Dusk'];

// Two visible traits per character. Each trait alone narrows suspects to
// 2-3 people; combining both identifies exactly one. That is the deduction core.
export const CHARACTERS = [
  { id: 'hana', name: 'Hana Sakurai', short: 'Hana', hair: 'pink', build: 'petite', style: 'twintails', outfit: 'sailor',
    hairHex: '#f59ac0', eyeHex: '#8a4fbf', skin: '#fde8dc', club: 'Idol Club', schedule: ['classroom', 'courtyard', 'music', 'dorm'],
    sticker: 'key', sfx: '*KYAA~*',
    bio: 'Idol-club darling. Everyone\'s best friend, apparently.' },
  { id: 'reina', name: 'Reina Kujō', short: 'Reina', hair: 'gold', build: 'petite', style: 'updo', outfit: 'gown',
    hairHex: '#f2d27a', eyeHex: '#3f8fb0', skin: '#fde9dc', club: 'Tea Society', schedule: ['dorm', 'courtyard', 'dorm', 'classroom'],
    sticker: 'gem', sfx: '*HMPH*',
    bio: 'Heiress. Believes everyone is beneath her, and says so.' },
  { id: 'kaito', name: 'Kaito Amane', short: 'Kaito', hair: 'gold', build: 'tall', style: 'messy', outfit: 'trench',
    hairHex: '#b98049', eyeHex: '#3aa57a', skin: '#f6dcc8', club: 'Mystery Club', schedule: ['library', 'classroom', 'library', 'classroom'],
    sticker: 'search', sfx: '*AHA!*',
    bio: 'Transfer student. Thinks every problem is a puzzle, including people.' },
  { id: 'momo', name: 'Momo Hanazawa', short: 'Momo', hair: 'pink', build: 'tall', style: 'long', outfit: 'dress',
    hairHex: '#f7b6d0', eyeHex: '#d9667f', skin: '#fdeee4', club: 'Gardening Club', schedule: ['infirmary', 'library', 'courtyard', 'dorm'],
    sticker: 'heart', sfx: '*EEP*',
    bio: 'Soft-spoken and sweet. Talks to her plants more than to people.' },
  { id: 'ren', name: 'Ren Kurosawa', short: 'Ren', hair: 'black', build: 'tall', style: 'short', outfit: 'gakuran',
    hairHex: '#26222e', eyeHex: '#55506a', skin: '#f3dccd', club: 'Student Council', schedule: ['classroom', 'dorm', 'classroom', 'library'],
    sticker: 'flower', sfx: '*…*',
    bio: 'Student council. Brings flowers to people who never asked for them.' },
  { id: 'yuki', name: 'Yuki Shirogane', short: 'Yuki', hair: 'black', build: 'petite', style: 'bob', outfit: 'techsuit',
    hairHex: '#2d2a36', eyeHex: '#5b8fd9', skin: '#fbe7db', club: 'Science Club', schedule: ['music', 'infirmary', 'infirmary', 'courtyard'],
    sticker: 'chip', sfx: '*BEEP*',
    bio: 'Science club. Deadpan, precise, keeps a log of everything.' },
];

export const TRAIT_TEXT = {
  hair: { black: 'black hair', pink: 'pink hair', gold: 'golden / light-brown hair' },
  build: { petite: 'small footprints / petite build', tall: 'large footprints / tall build' },
};

export const ROLES = {
  yandere: {
    name: 'The Obsessive', tag: 'Yandere', team: 'yandere', color: '#e0245e', sfx: '*SHATTER*',
    stat: 'Obsession unlocks Stalk & Silent Step', whisper: 'アナタだけを見てるよ。',
    pitch: 'Your heart beats for one person. Someone else is in the way.',
  },
  accomplice: {
    name: 'The Accomplice', tag: 'Accomplice', team: 'yandere', color: '#9b3dd6', sfx: '*CREAK*',
    stat: 'Never counts as a witness',
    pitch: 'You know the Obsessive\'s secret. You will make sure nobody else does.',
  },
  detective: {
    name: 'The Detective', tag: 'Detective', team: 'academy', color: '#2f80ed', sfx: '*HUNCH*',
    stat: 'Searches always find hidden clues',
    pitch: 'Something is wrong at this school. Find the Obsessive and expose them at trial.',
  },
  target: {
    name: 'The Target', tag: 'Target', team: 'academy', color: '#f2994a', sfx: '*CRUSH*',
    stat: 'Survival chance: whoever you trust',
    pitch: 'You have received a note: "Stay away from them. Or else." Survive.',
  },
  socialite: {
    name: 'The Manipulative Socialite', tag: 'Socialite', team: 'solo', color: '#27ae60', sfx: '*WHISPER*',
    stat: 'Rumors hit harder and cost no trust',
    pitch: 'You don\'t care who the killer is. You care who gets blamed.',
  },
  romantic: {
    name: 'The Hopeless Romantic', tag: 'Romantic', team: 'solo', color: '#eb5c9a', sfx: '*DOKI*',
    stat: 'Confess at 60+ trust',
    pitch: 'Murder? Whatever. You have a confession to make before this is over.',
  },
};

export const ROLE_ORDER = ['yandere', 'accomplice', 'detective', 'target', 'socialite', 'romantic'];

export const ITEMS = {
  diary: { name: 'Torn Diary Page', icon: 'page', usable: true,
    desc: 'Frantic handwriting. Read it to learn who the Obsessive is fixated on.' },
  keycard: { name: 'Security Keycard', icon: 'card', usable: true,
    desc: 'Opens the security monitor. Reveals any camera footage from last night.' },
  mirror: { name: 'Pocket Mirror', icon: 'mirror', usable: true, needsTarget: true,
    desc: 'Angle it at someone in your room to glimpse how obsessed they really are.' },
  salts: { name: 'Smelling Salts', icon: 'vial', usable: true,
    desc: 'Clears the head. Restores 40 sanity.' },
  whistle: { name: 'Emergency Whistle', icon: 'whistle', usable: false,
    desc: 'Passive. If you are attacked at night, you blow it: the attack fails and the attacker is glimpsed.' },
  letter: { name: 'Blank Love Letter', icon: 'letter', usable: false,
    desc: 'Give it to someone while talking to them (+25 trust).' },
};

export const EXPRESSIONS = ['neutral', 'happy', 'blush', 'shocked', 'suspicious', 'sad', 'yandere'];

// Tone chips the player can attach to a friendly chat.
export const TONES = {
  smile: { label: 'Smile', icon: 'smile', expr: 'happy' },
  blush: { label: 'Blush', icon: 'blush', expr: 'blush' },
  smirk: { label: 'Smirk', icon: 'smirk', expr: 'suspicious' },
  stare: { label: 'Stare', icon: 'eye', expr: 'yandere' },
};

// Chores that spread students around the school. Innocents' tasks are real;
// the Obsessive and Accomplice get fake ones so they can blend in.
export const TASKS = {
  library: 'Return the overdue books',
  classroom: 'Fix the projector',
  music: 'Tune the piano',
  infirmary: 'Restock the first-aid kit',
  courtyard: 'Water the flower beds',
  dorm: 'Reset the fuse box',
};
export const TASKS_PER_STUDENT = 3;
