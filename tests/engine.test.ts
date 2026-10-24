import { describe, expect, it } from 'vitest';
import { CHAIN_LIMIT, Game } from '../src/engine/game';
import type { CardDef, Ruleset } from '../src/engine/types';

/** A ruleset with one character whose rules are `rules`, plus extra cards. Only `poolCards` come from the pool. */
function setup(rules: CardDef[], others: CardDef[] = [], poolCards: string[] = []): Game {
  const all = [...rules, ...others].map((c) => ({ ...c, pool: poolCards.includes(c.id) }));
  const ruleset: Ruleset = {
    cards: all,
    characters: [{ id: 'test', name: 'Test', blurb: '', rules: rules.map((r) => r.id) }],
    faceDown: ['draw'],
  };
  return Game.start(ruleset, 'test', 42);
}

const card = (id: string, steps: CardDef['steps'], triggers?: CardDef['triggers']): CardDef => ({ id, name: id, steps, triggers });

function press(g: Game, defId: string) {
  const id = g.zone('rules').find((c) => g.state.cards[c].def === defId)!;
  expect(g.input({ click: id })).toBe(true);
}

function click(g: Game, id: string) {
  expect(g.input({ click: id })).toBe(true);
}

describe('activate each', () => {
  const command = card('command', [{ do: 'activateEach', zone: 'creatures', mode: 'all' }]);
  const fury = card('fury', [
    { do: 'activateEach', zone: 'creatures', mode: 'all', others: true },
    { do: 'gain', counter: 'x', amount: 1 },
  ]);

  it('two cards that activate each other always finish', () => {
    const g = setup([command], [fury]);
    const a = g.spawn('fury', 'creatures');
    const b = g.spawn('fury', 'creatures');
    press(g, 'command');
    expect(g.prompt()).toMatchObject({ type: 'choice', options: [a, b] });

    click(g, a); // A lights up the others: only B, since A is busy
    expect(g.prompt()).toMatchObject({ type: 'choice', options: [b] });
    click(g, b); // B finds A busy, nothing to activate; B gains, then A gains
    expect(g.counter('x')).toBe(2);

    // Back in Command's sweep: B is still lit
    expect(g.prompt()).toMatchObject({ type: 'choice', options: [b] });
    click(g, b);
    expect(g.prompt()).toMatchObject({ type: 'choice', options: [a] });
    click(g, a);
    expect(g.counter('x')).toBe(4);
    expect(g.prompt().type).toBe('rules');
    expect(g.state.busy).toEqual({});
  });

  it('skips a card that left and came back during the sweep', () => {
    const shuffleOut = card('bounce', [
      { do: 'move', card: { zone: 'creatures', pick: 'bottom' }, to: 'void' },
      { do: 'move', card: { var: 'it' }, to: 'creatures' },
    ]);
    const idle = card('idle', [{ do: 'gain', counter: 'idle', amount: 1 }]);
    const g = setup([command], [shuffleOut, idle]);
    const a = g.spawn('bounce', 'creatures');
    const b = g.spawn('idle', 'creatures');
    press(g, 'command');
    click(g, a); // B leaves and returns: new arrival, so it goes dark
    expect(g.zone('creatures')).toEqual([a, b]);
    expect(g.prompt().type).toBe('rules');
    expect(g.counter('idle')).toBe(0);
  });

  it('does not light up cards that arrive during the sweep', () => {
    const summon = card('summon', [{ do: 'move', card: { zone: 'pool', pick: 'top' }, to: 'creatures' }]);
    const g = setup([command], [summon], ['summon']);
    const a = g.spawn('summon', 'creatures');
    press(g, 'command');
    click(g, a);
    expect(g.zone('creatures')).toHaveLength(2);
    expect(g.prompt().type).toBe('rules');
  });

  it('lets you stop early when it says as many as you like', () => {
    const some = card('some', [{ do: 'activateEach', zone: 'creatures', mode: 'any' }]);
    const idle = card('idle', [{ do: 'gain', counter: 'idle', amount: 1 }]);
    const g = setup([some], [idle]);
    const a = g.spawn('idle', 'creatures');
    g.spawn('idle', 'creatures');
    press(g, 'some');
    expect(g.prompt()).toMatchObject({ type: 'choice', optional: true });
    click(g, a);
    expect(g.input({ done: true })).toBe(true);
    expect(g.counter('idle')).toBe(1);
    expect(g.prompt().type).toBe('rules');
  });
});

describe('specific cards', () => {
  it('"activate it" follows the card to where it moved', () => {
    const casting = card('casting', [
      { do: 'move', card: { zone: 'hand', pick: 'choose' }, to: 'discard' },
      { do: 'activate', card: { var: 'it' } },
    ]);
    const where = card('where', [{ do: 'if', cond: { zone: 'discard', atLeast: 1 }, then: [{ do: 'gain', counter: 'ok', amount: 1 }] }]);
    const g = setup([casting], [where]);
    const h = g.spawn('where', 'hand');
    press(g, 'casting');
    expect(g.input({ done: true })).toBe(false); // a pick is not optional
    click(g, h);
    expect(g.state.cards[h].zone).toBe('discard');
    expect(g.counter('ok')).toBe(1);
  });

  it('a card cannot activate itself while it is resolving', () => {
    const selfish = card('selfish', [{ do: 'activate', card: { self: true } }, { do: 'gain', counter: 'n', amount: 1 }]);
    const g = setup([selfish]);
    press(g, 'selfish');
    expect(g.counter('n')).toBe(1);
    expect(g.state.log.some((l) => l.tone === 'fizzle' && l.text.includes('still resolving'))).toBe(true);
  });

  it('a choice with nothing to choose fizzles that step only', () => {
    const casting = card('casting', [
      { do: 'move', card: { zone: 'hand', pick: 'choose' }, to: 'discard' },
      { do: 'activate', card: { var: 'it' } },
      { do: 'gain', counter: 'after', amount: 1 },
    ]);
    const g = setup([casting]);
    press(g, 'casting');
    expect(g.counter('after')).toBe(1);
    expect(g.prompt().type).toBe('rules');
  });
});

describe('triggers', () => {
  it('fire between the small steps of a card', () => {
    const deploy = card('deploy', [
      { do: 'move', card: { zone: 'hand', pick: 'top' }, to: 'creatures' },
      { do: 'if', cond: { counter: 'a', atLeast: 1 }, then: [{ do: 'gain', counter: 'b', amount: 1 }] },
    ]);
    const watcher = card('watcher', [], [{ when: 'after', on: { event: 'move', to: 'creatures' }, steps: [{ do: 'gain', counter: 'a', amount: 1 }] }]);
    const g = setup([deploy], [watcher]);
    g.spawn('watcher', 'creatures');
    g.spawn('watcher', 'hand'); // the card being deployed also watches once it lands
    press(g, 'deploy');
    // Two watchers saw it: choose the order
    const p = g.prompt();
    expect(p.type).toBe('triggers');
    if (p.type !== 'triggers') return;
    click(g, p.options[1]);
    expect(g.counter('a')).toBe(2);
    expect(g.counter('b')).toBe(1);
  });

  it('before triggers resolve before the activation', () => {
    const go = card('go', [{ do: 'activate', card: { zone: 'creatures', pick: 'top' } }]);
    const beast = card('beast', [{ do: 'if', cond: { counter: 'mana', atLeast: 1 }, then: [{ do: 'gain', counter: 'paid', amount: 1 }] }]);
    const vigil = card('vigil', [], [{ when: 'before', on: { event: 'activate', zone: 'creatures' }, steps: [{ do: 'gain', counter: 'mana', amount: 1 }] }]);
    const g = setup([go], [beast, vigil]);
    g.spawn('beast', 'creatures');
    g.spawn('vigil', 'lands');
    press(g, 'go');
    expect(g.counter('paid')).toBe(1);
  });

  it('two triggers that feed each other stop because both are busy', () => {
    const think = card('think', [{ do: 'gain', counter: 'insight', amount: 1 }]);
    const resonance = card('resonance', [], [{ when: 'after', on: { event: 'counter', counter: 'insight', dir: 'up' }, steps: [{ do: 'gain', counter: 'mana', amount: 1 }] }]);
    const feedback = card('feedback', [], [{ when: 'after', on: { event: 'counter', counter: 'mana', dir: 'up' }, steps: [{ do: 'gain', counter: 'insight', amount: 1 }] }]);
    const g = setup([think], [resonance, feedback]);
    g.spawn('resonance', 'lands');
    g.spawn('feedback', 'lands');
    press(g, 'think');
    expect(g.counter('insight')).toBe(2);
    expect(g.counter('mana')).toBe(1);
    expect(g.prompt().type).toBe('rules');
  });

  it('cards in face-down piles do not trigger', () => {
    const think = card('think', [{ do: 'gain', counter: 'insight', amount: 1 }]);
    const resonance = card('resonance', [], [{ when: 'after', on: { event: 'counter', counter: 'insight' }, steps: [{ do: 'gain', counter: 'mana', amount: 1 }] }]);
    const g = setup([think], [resonance]);
    g.spawn('resonance', 'draw');
    press(g, 'think');
    expect(g.counter('mana')).toBe(0);
  });

  it('a runaway chain is cut off by the step limit', () => {
    const seed = card('seed', [{ do: 'move', card: { zone: 'pool', pick: 'top' }, to: 'hand' }]);
    const bloom = card('bloom', [], [{ when: 'after', on: { event: 'move', card: 'self', to: 'hand' }, steps: [{ do: 'move', card: { zone: 'pool', pick: 'top' }, to: 'hand' }] }]);
    const g = setup([seed], [bloom], ['bloom']);
    press(g, 'seed');
    expect(g.state.log.at(-1)?.tone).toBe('warn');
    expect(g.state.stack).toEqual([]);
    expect(g.state.busy).toEqual({});
    expect(g.zone('hand').length).toBeGreaterThan(10);
    expect(g.state.chainSteps).toBeLessThanOrEqual(CHAIN_LIMIT);
  });
});

describe('counters, zones and winning', () => {
  it('counters never go below zero, and the change seen is the real change', () => {
    const drain = card('drain', [{ do: 'gain', counter: 'hp', amount: 1 }, { do: 'lose', counter: 'hp', amount: 5 }, { do: 'lose', counter: 'hp', amount: 1 }]);
    const seen = card('seen', [], [{ when: 'after', on: { event: 'counter', counter: 'hp', dir: 'down' }, steps: [{ do: 'gain', counter: 'drops', amount: 1 }] }]);
    const g = setup([drain], [seen]);
    g.spawn('seen', 'lands');
    press(g, 'drain');
    expect(g.counter('hp')).toBe(0);
    expect(g.counter('drops')).toBe(1); // losing from 0 changes nothing, so no trigger
  });

  it('recycles the discard into the draw pile, oldest first, then shuffles', () => {
    const recycle = card('recycle', [{ do: 'moveEach', from: 'discard', to: 'draw' }, { do: 'shuffle', zone: 'draw' }]);
    const idle = card('idle', []);
    const g = setup([recycle], [idle]);
    const ids = [g.spawn('idle', 'discard'), g.spawn('idle', 'discard'), g.spawn('idle', 'discard')];
    press(g, 'recycle');
    expect(g.zone('discard')).toEqual([]);
    expect([...g.zone('draw')].sort()).toEqual([...ids].sort());
  });

  it('the same seed replays the same game', () => {
    const gather = card('gather', [{ do: 'repeat', times: 5, steps: [{ do: 'move', card: { zone: 'pool', pick: 'top' }, to: 'hand' }] }]);
    const a = card('a', []), b = card('b', []), c = card('c', []);
    const run = () => {
      const g = setup([gather], [a, b, c], ['a', 'b', 'c']);
      press(g, 'gather');
      return g.zone('hand').map((id) => g.state.cards[id].def);
    };
    expect(run()).toEqual(run());
  });

  it('win the game ends everything', () => {
    const winner = card('winner', [{ do: 'win' }, { do: 'gain', counter: 'late', amount: 1 }]);
    const g = setup([winner]);
    press(g, 'winner');
    expect(g.prompt()).toEqual({ type: 'over', reason: 'won' });
    expect(g.counter('late')).toBe(0);
    expect(g.input({ click: g.zone('rules')[0] })).toBe(false);
  });

  it('only cards in Rules can be pressed, and only when nothing is resolving', () => {
    const casting = card('casting', [{ do: 'move', card: { zone: 'hand', pick: 'choose' }, to: 'discard' }]);
    const idle = card('idle', []);
    const g = setup([casting], [idle]);
    const h = g.spawn('idle', 'hand');
    expect(g.input({ click: h })).toBe(false);
    press(g, 'casting');
    expect(g.input({ click: g.zone('rules')[0] })).toBe(false);
  });
});
