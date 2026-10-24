// Which zones and counters a card mentions. A zone or counter exists as soon as something mentions it,
// so the board shows these even before anything has happened in them.

import { POOL, type CardDef, type CardSource, type Cond, type Step } from './types';

export interface Refs {
  zones: Set<string>;
  counters: Set<string>;
}

export function cardRefs(def: CardDef, into: Refs = { zones: new Set(), counters: new Set() }): Refs {
  const src = (s: CardSource) => { if ('zone' in s) into.zones.add(s.zone); };
  const cond = (c: Cond): void => {
    if ('all' in c) c.all.forEach(cond);
    else if ('any' in c) c.any.forEach(cond);
    else if ('not' in c) cond(c.not);
    else if ('counter' in c) into.counters.add(c.counter);
    else into.zones.add(c.zone);
  };
  const steps = (list: Step[]): void => {
    for (const s of list) {
      switch (s.do) {
        case 'move': src(s.card); into.zones.add(s.to); break;
        case 'activate': src(s.card); break;
        case 'activateEach': into.zones.add(s.zone); break;
        case 'moveEach': into.zones.add(s.from); into.zones.add(s.to); break;
        case 'gain': case 'lose': into.counters.add(s.counter); break;
        case 'shuffle': into.zones.add(s.zone); break;
        case 'if': cond(s.cond); steps(s.then); if (s.else) steps(s.else); break;
        case 'repeat': steps(s.steps); break;
        case 'win': break;
      }
    }
  };
  steps(def.steps);
  for (const t of def.triggers ?? []) {
    steps(t.steps);
    t.while?.forEach((z) => into.zones.add(z));
    const p = t.on;
    if (p.event === 'counter') { if (p.counter) into.counters.add(p.counter); }
    else {
      if ('zone' in p && p.zone) into.zones.add(p.zone);
      if ('from' in p && p.from) into.zones.add(p.from);
      if ('to' in p && p.to) into.zones.add(p.to);
    }
  }
  into.zones.delete(POOL);
  return into;
}
