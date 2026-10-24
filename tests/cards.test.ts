import { describe, expect, it } from 'vitest';
import { ruleset } from '../src/cards';
import { Game } from '../src/engine/game';
import { describeCard } from '../src/engine/text';

describe('example cards', () => {
  it('every card has text and a unique id', () => {
    const ids = new Set<string>();
    for (const c of ruleset.cards) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(describeCard(c).length).toBeGreaterThan(0);
    }
  });

  it('every character starts with three real rules cards', () => {
    for (const ch of ruleset.characters) {
      const g = Game.start(ruleset, ch.id, 1);
      expect(g.zone('rules')).toHaveLength(3);
    }
  });

  // Random play: press random rules and click random lit cards. Nothing should ever crash or hang.
  it.each(ruleset.characters.map((c) => c.id))('%s survives 300 turns of random clicking', (id) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const g = Game.start(ruleset, id, seed);
      let r = seed;
      const rand = (n: number) => { r = (r * 1103515245 + 12345) % 2147483648; return r % n; };
      for (let i = 0; i < 2000 && g.state.turn < 300; i++) {
        const p = g.prompt();
        if (p.type === 'over') break;
        if (p.type === 'choice' && p.optional && rand(4) === 0) {
          expect(g.input({ done: true })).toBe(true);
          continue;
        }
        expect(g.input({ click: p.options[rand(p.options.length)] })).toBe(true);
      }
      expect(Object.keys(g.state.busy).length === 0 || g.state.stack.length > 0).toBe(true);
    }
  });
});
