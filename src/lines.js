// Per-character dialogue. Each student has their own voice, and guilty and
// innocent characters draw from the SAME pools, so how someone talks never
// reveals their role. Deduction comes from what they claim, not how they say it.

export const LINES = {
  hana: {
    warm: ['Ehehe, you\'re so sweet! Okay, you\'re officially my favourite today.', 'Stick with me, okay? Idols never leave their fans behind!', 'You\'re the only one who hasn\'t been weird to me all day~'],
    cold: ['Um… okay? That\'s kind of creepy, not gonna lie.', 'Heh… can you not look at me like that?'],
    agree: ['Wait, really?! I knew something was off about {x}!', 'Ooh, spicy. I\'ll keep my eye on {x}, promise!'],
    doubt: ['Nuh-uh, {x} is super nice to me. You\'re just jealous.', 'That\'s mean! You don\'t have proof.'],
    accuse: ['It was {x}! I\'m like, ninety percent sure!', '{x}, you\'ve been acting SO weird. Explain!'],
    defend: ['Me?! I literally cried when the lights went out!', 'Why would an idol do something so ugly?! Rude!'],
    idle: ['Can we please just vote and go to bed…', 'I just want to go home and do my skincare.'],
    react: ['Th-that could be anyone!', 'Eek. Don\'t look at me!'],
    yes: ['A sleepover? Yay! I\'ll bring snacks!'],
    no: ['Sorry… I already have plans. Probably.'],
  },
  reina: {
    warm: ['You may sit with me. Consider it an honour.', 'Hmph. You\'re more tolerable than the others, I suppose.', 'Tea? No? Your loss. …Stay a while anyway.'],
    cold: ['Do not presume we are friends.', 'Your manners are appalling.'],
    agree: ['{x}? Common. It would not surprise me in the least.', 'I had my suspicions about {x}. Now I have reasons.'],
    doubt: ['Gossip is beneath me. And beneath you, I hope.', 'Evidence, darling. Bring evidence.'],
    accuse: ['I name {x}. Someone had to have the spine to say it.', '{x}. Your story has more holes than a cheap lace doily.'],
    defend: ['I do not dirty my hands. I have people for that. …That was a joke.', 'Accuse a Kujō again and my lawyers will hear of it.'],
    idle: ['This is all so terribly vulgar.', 'Wake me when someone has actual proof.'],
    react: ['How very convenient.', 'Hmph. Inconclusive.'],
    yes: ['Very well. Do not snore.'],
    no: ['I think not.'],
  },
  kaito: {
    warm: ['You\'re sharp. I like having sharp people around.', 'Two heads are better than one. Especially when one of the other heads might be a killer.', 'Stay close. I\'m keeping notes on everyone.'],
    cold: ['Interesting choice of expression. I\'m writing that down.', 'That\'s… a tell. Do you know you just did a tell?'],
    agree: ['{x}, huh. The timeline does get fuzzy around them.', 'Noted. {x}\'s alibi was already thin.'],
    doubt: ['Suspicion without evidence is just vibes.', 'You\'re pointing fingers pretty fast. Why?'],
    accuse: ['Follow the evidence. It leads to {x}.', 'The clues narrow it down, and {x} is the only one left standing in the middle.'],
    defend: ['If I were the killer, do you think I\'d be this bad at hiding it? Think.', 'Check my alibi. I welcome it.'],
    idle: ['Nobody\'s talking about the timetable. Why?', 'Someone in this room is lying about where they were.'],
    react: ['Hm. That narrows it down.', 'Good. Now match it with a second clue.'],
    yes: ['Safety in numbers. Smart.'],
    no: ['I work better alone. No offence.'],
  },
  momo: {
    warm: ['O-oh! Thank you… I was really scared.', 'You\'re kind. Um… can I stay near you?', 'I made too many rice balls. Do you… want one?'],
    cold: ['S-sorry, did I do something wrong…?', 'That\'s a little scary…'],
    agree: ['{x}…? I don\'t want to think that, but… okay.', 'M-maybe you\'re right about {x}.'],
    doubt: ['Please don\'t say that about {x}… they were nice to me.', 'I don\'t think we should blame people…'],
    accuse: ['I-I\'m sorry, {x}, but I think it was you…', 'Everything points at {x}… I\'m so sorry.'],
    defend: ['I couldn\'t… I cry when I step on ants…', 'P-please, I didn\'t do anything!'],
    idle: ['I miss my flowers…', 'Can someone hold my hand during the vote?'],
    react: ['Oh no…', 'That\'s horrible…'],
    yes: ['Y-yes please! I didn\'t want to be alone.'],
    no: ['S-sorry… I can\'t tonight.'],
  },
  ren: {
    warm: ['…You can stay. It\'s quieter with you here.', 'Here. A flower. …Don\'t make it weird.', 'You\'re not like the others. Good.'],
    cold: ['…No.', 'Don\'t.'],
    agree: ['{x}. …Yeah. I\'ve seen it too.', '…I\'ll watch {x}.'],
    doubt: ['You don\'t know that.', '…Talk is cheap.'],
    accuse: ['{x}. It was {x}.', 'I\'ve been watching. {x}.'],
    defend: ['…I was where I said I was.', 'Believe what you want. I didn\'t.'],
    idle: ['…', 'Just vote.'],
    react: ['…Hm.', '…Figures.'],
    yes: ['…Fine.'],
    no: ['…No.'],
  },
  yuki: {
    warm: ['Trust level: rising. Congratulations.', 'Statistically you are the least annoying person here.', 'I have calculated that we survive longer together.'],
    cold: ['Your facial muscles did something odd just now. Logged.', 'Please stop that.'],
    agree: ['Cross-referencing {x}… yes, anomalies detected.', 'Adding {x} to my watchlist.'],
    doubt: ['Insufficient data. Try again.', 'Correlation is not causation.'],
    accuse: ['The data says {x}. The data does not lie.', 'Probability analysis complete. {x}.'],
    defend: ['My logs prove I was elsewhere. I keep logs of everything.', 'Error: accusation not supported by evidence.'],
    idle: ['Recommend we compare alibis turn by turn.', 'The cameras do not lie. People do.'],
    react: ['Useful. Updating model.', 'That eliminates half the class.'],
    yes: ['Acceptable. I will bring a nightlight.'],
    no: ['Declined.'],
  },
};

export function lineFor(state, rng, id, kind, vars = {}) {
  const pool = LINES[id]?.[kind] ?? ['…'];
  const text = pool[Math.floor(rng() * pool.length)];
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
