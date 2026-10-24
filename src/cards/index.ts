// Example cards. Every card here is also in the one shared pool unless it says `pool: false`.
// Zones and counters are just names: mentioning one is all it takes for it to exist.

import { POOL, type CardDef, type CardSource, type Character, type Cond, type Ruleset, type Step, type ZoneName } from '../engine/types';

// Small helpers so card definitions read close to their text.
const fresh = (to: ZoneName): Step => ({ do: 'move', card: { zone: POOL, pick: 'top' }, to });
const choose = (zone: ZoneName): CardSource => ({ zone, pick: 'choose' });
const move = (card: CardSource, to: ZoneName, at?: 'top' | 'bottom'): Step => ({ do: 'move', card, to, at });
const activate = (card: CardSource): Step => ({ do: 'activate', card });
const gain = (counter: string, amount = 1): Step => ({ do: 'gain', counter, amount });
const lose = (counter: string, amount = 1): Step => ({ do: 'lose', counter, amount });
const when = (cond: Cond, then: Step[], otherwise?: Step[]): Step => ({ do: 'if', cond, then, else: otherwise });
const have = (counter: string, atLeast: number): Cond => ({ counter, atLeast });
const self: CardSource = { self: true };
const it: CardSource = { var: 'it' };
const top = (zone: ZoneName): CardSource => ({ zone, pick: 'top' });

export const cards: CardDef[] = [
  // ---------------------------------------------------------------- Intent
  { id: 'seeking', name: 'Seeking', steps: [fresh('hand')] },
  { id: 'casting', name: 'Casting', steps: [move(choose('hand'), 'discard'), activate(it)] },
  {
    id: 'recollection', name: 'Recollection',
    steps: [
      when({ zone: 'draw', atMost: 0 }, [{ do: 'moveEach', from: 'discard', to: 'draw' }, { do: 'shuffle', zone: 'draw' }]),
      { do: 'repeat', times: 2, steps: [move(top('draw'), 'hand')] },
    ],
  },

  // ---------------------------------------------------------------- Multitude
  { id: 'channeling', name: 'Channeling', steps: [gain('mana')] },
  { id: 'summoning', name: 'Summoning', steps: [when(have('mana', 2), [lose('mana', 2), fresh('creatures')])] },
  { id: 'aggression', name: 'Aggression', steps: [{ do: 'activateEach', zone: 'creatures', mode: 'all' }] },

  // ---------------------------------------------------------------- Entropy
  { id: 'decay', name: 'Decay', steps: [fresh('discard'), gain('entropy')] },
  { id: 'exhumation', name: 'Exhumation', steps: [activate(choose('discard')), move(it, 'void')] },
  {
    id: 'erosion', name: 'Erosion',
    steps: [when(have('entropy', 3), [lose('entropy', 3), { do: 'activateEach', zone: 'discard', mode: 'all' }], [gain('entropy')])],
  },

  // ---------------------------------------------------------------- the climb
  { id: 'insight', name: 'Insight', steps: [gain('insight')] },
  { id: 'clarity', name: 'Clarity', steps: [move(top('draw'), 'hand'), gain('insight')] },
  { id: 'ascension', name: 'Ascension', steps: [when(have('insight', 3), [lose('insight', 3), gain('floor')])] },
  { id: 'transcendence', name: 'Transcendence', steps: [when(have('floor', 3), [{ do: 'win' }], [gain('insight')])] },
  { id: 'forgetting', name: 'Forgetting', steps: [move(choose('rules'), 'void'), gain('floor')] },

  // ---------------------------------------------------------------- rewriting the rules
  { id: 'abstraction', name: 'Abstraction', steps: [move(choose('hand'), 'rules')] },
  { id: 'inscription', name: 'Inscription', steps: [move(choose('discard'), 'rules')] },
  {
    id: 'echo', name: 'Echo',
    steps: [move(self, 'creatures')],
    triggers: [{ when: 'after', on: { event: 'move', card: 'other', to: 'rules' }, while: ['creatures'], steps: [activate({ var: 'event' })] }],
  },

  // ---------------------------------------------------------------- bodies
  { id: 'fury', name: 'Fury', steps: [{ do: 'activateEach', zone: 'creatures', mode: 'all', others: true }] },
  { id: 'duplication', name: 'Duplication', steps: [fresh('creatures'), activate(it)] },
  { id: 'wandering', name: 'Wandering', steps: [move({ zone: 'hand', pick: 'random' }, 'creatures')] },
  { id: 'sacrifice', name: 'Sacrifice', steps: [move(choose('creatures'), 'discard'), gain('insight', 2)] },
  { id: 'collapse', name: 'Collapse', steps: [{ do: 'moveEach', from: 'creatures', to: 'discard' }, gain('insight', 3)] },
  {
    id: 'vigilance', name: 'Vigilance',
    steps: [gain('insight')],
    triggers: [{ when: 'before', on: { event: 'activate', card: 'other', zone: 'creatures' }, while: ['creatures'], steps: [gain('mana')] }],
  },

  // ---------------------------------------------------------------- lands
  { id: 'growth', name: 'Growth', steps: [fresh('lands')] },
  {
    id: 'fertility', name: 'Fertility',
    steps: [gain('mana')],
    triggers: [{ when: 'after', on: { event: 'activate', zone: 'rules' }, while: ['lands'], steps: [gain('mana')] }],
  },
  {
    id: 'resonance', name: 'Resonance',
    steps: [move(self, 'lands')],
    triggers: [{ when: 'after', on: { event: 'counter', counter: 'insight', dir: 'up' }, while: ['lands'], steps: [gain('mana')] }],
  },
  {
    id: 'feedback', name: 'Feedback',
    steps: [move(self, 'lands')],
    triggers: [{ when: 'after', on: { event: 'counter', counter: 'mana', dir: 'up' }, while: ['lands'], steps: [gain('insight')] }],
  },
  { id: 'hoarding', name: 'Hoarding', steps: [when(have('mana', 3), [lose('mana', 3), fresh('hand'), fresh('hand')])] },

  // ---------------------------------------------------------------- the discard and the deck
  { id: 'repetition', name: 'Repetition', steps: [activate(choose('discard'))] },
  { id: 'memory', name: 'Memory', steps: [{ do: 'moveEach', from: 'discard', to: 'draw' }, { do: 'shuffle', zone: 'draw' }] },
  { id: 'patience', name: 'Patience', steps: [move(self, 'draw', 'top'), gain('insight', 2)] },
  { id: 'impulse', name: 'Impulse', steps: [fresh('hand'), activate(it)] },
  {
    id: 'momentum', name: 'Momentum',
    steps: [gain('entropy')],
    triggers: [{ when: 'after', on: { event: 'move', card: 'other', to: 'discard' }, steps: [gain('insight')] }],
  },

  // ---------------------------------------------------------------- others
  { id: 'manifestation', name: 'Manifestation', steps: [fresh('enemies'), gain('insight', 2)] },
  { id: 'banishment', name: 'Banishment', steps: [move(choose('enemies'), 'void'), gain('level')] },
  {
    id: 'threat', name: 'Threat',
    steps: [gain('dread')],
    triggers: [{ when: 'after', on: { event: 'activate', zone: 'rules' }, while: ['enemies'], steps: [lose('insight')] }],
  },
];

export const characters: Character[] = [
  { id: 'intent', name: 'Intent', blurb: 'Seek cards, cast them from your hand, recollect the discard into a deck.', rules: ['seeking', 'casting', 'recollection'] },
  { id: 'multitude', name: 'Multitude', blurb: 'Channel mana, summon bodies, and send them all at once.', rules: ['channeling', 'summoning', 'aggression'] },
  { id: 'entropy', name: 'Entropy', blurb: 'Everything rots into the Discard. Play it from there.', rules: ['decay', 'exhumation', 'erosion'] },
];

export const ruleset: Ruleset = { cards, characters, faceDown: ['draw'] };
