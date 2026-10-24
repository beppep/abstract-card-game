// The resolution engine.
//
// Everything that happens is a frame on one stack:
//   card     – a card's steps running in order (its source card is busy until the frame ends)
//   event    – one small thing happening: a move, a counter change, an activation.
//              Runs "before" triggers, applies itself, then runs "after" triggers.
//   choice   – waiting for the player to click a lit card
//   triggers – a batch of triggers waiting to fire; the player picks the order
//
// Frames above another frame always finish first, so a card stays busy for as
// long as anything it set off is still resolving. That is what stops loops.

import { randomInt, shuffleInPlace } from './rng';
import { describeStep, zoneLabel } from './text';
import {
  POOL, RULES,
  type CardDef, type CardFrame, type CardId, type CardInstance, type CardSource, type ChoiceFrame, type Cond,
  type EventFrame, type EventPattern, type GameEvent, type GameState, type Input, type Option, type PendingTrigger,
  type Prompt, type Ruleset, type Step, type TriggerFrame, type ZoneName,
} from './types';

/** Hard cap on work in one chain. Only reachable when cards keep pulling in fresh cards that trigger each other. */
export const CHAIN_LIMIT = 2000;

export class Game {
  readonly defs: Map<string, CardDef>;
  private readonly poolDefs: CardDef[];

  constructor(readonly rules: Ruleset, public state: GameState) {
    this.defs = new Map(rules.cards.map((c) => [c.id, c]));
    this.poolDefs = rules.cards.filter((c) => c.pool !== false);
  }

  static start(rules: Ruleset, characterId: string, seed: number): Game {
    const character = rules.characters.find((c) => c.id === characterId);
    if (!character) throw new Error(`Unknown character ${characterId}`);
    const state: GameState = {
      seed, rng: seed, character: characterId,
      nextId: 1, nextArrival: 1,
      cards: {}, zones: {}, counters: {},
      seenZones: [], seenCounters: [],
      stack: [], busy: {},
      turn: 0, won: false, chainSteps: 0, log: [],
    };
    const game = new Game(rules, state);
    game.seeZone(RULES);
    for (const id of character.rules) game.place(state.cards[game.create(id)], RULES, 'bottom');
    game.log(`${character.name} begins. Seed ${seed}.`);
    return game;
  }

  /** Put a card straight into a zone with no events (setup, tests, sandboxing). */
  spawn(defId: string, zone: ZoneName): CardId {
    if (!this.defs.has(defId)) throw new Error(`Unknown card ${defId}`);
    const id = this.create(defId);
    this.place(this.state.cards[id], zone, 'bottom');
    return id;
  }

  // ------------------------------------------------------------- queries

  def(card: CardId): CardDef {
    const inst = this.state.cards[card];
    const def = inst && this.defs.get(inst.def);
    if (!def) throw new Error(`No card ${card}`);
    return def;
  }

  zone(name: ZoneName): CardId[] {
    return this.state.zones[name] ?? [];
  }

  counter(name: string): number {
    return this.state.counters[name] ?? 0;
  }

  isBusy(card: CardId): boolean {
    return (this.state.busy[card] ?? 0) > 0;
  }

  isFaceDown(zone: ZoneName): boolean {
    return this.rules.faceDown.includes(zone);
  }

  /** What the game is waiting for. */
  prompt(): Prompt {
    const s = this.state;
    if (s.won) return { type: 'over', reason: 'won' };
    const top = s.stack.at(-1);
    if (!top) {
      const options = this.zone(RULES);
      return options.length ? { type: 'rules', options: [...options] } : { type: 'over', reason: 'no-rules' };
    }
    if (top.kind === 'choice') {
      return { type: 'choice', prompt: top.prompt, options: top.options.map((o) => o.card), optional: top.optional };
    }
    if (top.kind === 'triggers') {
      return { type: 'triggers', when: top.when, options: top.pending.map((p) => p.card) };
    }
    throw new Error(`Engine stopped on a ${top.kind} frame`);
  }

  // ------------------------------------------------------------- input

  /** Apply a player input. Returns false if it was not a legal input right now. */
  input(input: Input): boolean {
    const s = this.state;
    if (s.won) return false;
    const top = s.stack.at(-1);

    if (!top) {
      if (!('click' in input) || !this.zone(RULES).includes(input.click)) return false;
      s.turn++;
      s.chainSteps = 0;
      this.log(`Turn ${s.turn}: you press ${this.def(input.click).name}.`);
      this.pushEvent({ type: 'activate', card: input.click, zone: RULES });
      this.run();
      return true;
    }

    if (top.kind === 'choice') {
      if ('done' in input) {
        if (!top.optional) return false;
        s.stack.pop();
        if (top.purpose === 'pick') this.cardBelow().picked = null;
        this.run();
        return true;
      }
      const i = top.options.findIndex((o) => o.card === input.click);
      if (i < 0) return false;
      const [opt] = top.options.splice(i, 1);
      if (top.purpose === 'pick') {
        s.stack.pop();
        this.cardBelow().picked = opt.card;
      } else {
        this.pushEvent({ type: 'activate', card: opt.card, arrival: opt.arrival, zone: top.zone });
      }
      this.run();
      return true;
    }

    if (top.kind === 'triggers') {
      if (!('click' in input)) return false;
      const i = top.pending.findIndex((p) => p.card === input.click);
      if (i < 0) return false;
      this.fireTrigger(top, i);
      this.run();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------- resolution loop

  /** Resolve until the game needs a player input. */
  run(): void {
    const s = this.state;
    while (!s.won) {
      const top = s.stack.at(-1);
      if (!top) { s.chainSteps = 0; return; }
      if (top.kind === 'choice' && this.waitsForChoice(top)) return;
      if (top.kind === 'triggers' && this.waitsForTriggers(top)) return;
      if (++s.chainSteps > CHAIN_LIMIT) { this.abortChain(); return; }
      if (top.kind === 'card') this.stepCard(top);
      else if (top.kind === 'event') this.stepEvent(top);
    }
  }

  private waitsForChoice(f: ChoiceFrame): boolean {
    f.options = f.options.filter((o) => this.stillThere(o, f.zone) && !(f.skipBusy && this.isBusy(o.card)));
    if (f.options.length) return true;
    this.state.stack.pop();
    if (f.purpose === 'pick') {
      this.cardBelow().picked = null;
      this.log('Nothing to choose.', 'fizzle');
    }
    return false;
  }

  private waitsForTriggers(f: TriggerFrame): boolean {
    f.pending = f.pending.filter((p) => {
      const inst = this.state.cards[p.card];
      return inst && inst.arrival === p.arrival && !this.isBusy(p.card) && this.triggerActive(inst, this.def(p.card).triggers![p.trigger]);
    });
    if (f.pending.length > 1) return true;
    if (f.pending.length === 1) this.fireTrigger(f, 0);
    else this.state.stack.pop();
    return false;
  }

  private stillThere(o: Option, zone: ZoneName): boolean {
    const inst = this.state.cards[o.card];
    return !!inst && inst.zone === zone && inst.arrival === o.arrival;
  }

  // ------------------------------------------------------------- card frames

  private stepCard(f: CardFrame): void {
    const cur = f.cursors.at(-1);
    if (!cur) {
      this.state.stack.pop();
      this.unlock(f.source);
      return;
    }
    if (cur.pc >= cur.steps.length) {
      if (cur.times > 1) { cur.times--; cur.pc = 0; } else f.cursors.pop();
      return;
    }
    if (this.execStep(f, cur.steps[cur.pc])) cur.pc++;
  }

  /** Runs one step. Returns false when it opened a choice and must run again once the choice is made. */
  private execStep(f: CardFrame, step: Step): boolean {
    switch (step.do) {
      case 'move': {
        const card = this.resolveSource(f, step.card, false, `to move to ${zoneLabel(step.to)}`);
        if (card === undefined) return false;
        f.vars[step.as ?? 'it'] = card;
        if (!card) { this.log(`${describeStep(step)} — nothing there.`, 'fizzle'); return true; }
        const inst = this.state.cards[card];
        this.seeZone(step.to);
        this.pushEvent({ type: 'move', card, arrival: inst.arrival, from: inst.zone, to: step.to, at: step.at ?? 'bottom' });
        return true;
      }
      case 'activate': {
        const card = this.resolveSource(f, step.card, true, 'to activate');
        if (card === undefined) return false;
        f.vars[step.as ?? 'it'] = card;
        if (!card) { this.log(`${describeStep(step)} — nothing there.`, 'fizzle'); return true; }
        this.pushEvent({ type: 'activate', card, zone: this.state.cards[card].zone });
        return true;
      }
      case 'activateEach': {
        this.seeZone(step.zone);
        const options = this.snapshot(step.zone).filter((o) => !this.isBusy(o.card) && !(step.others && o.card === f.source));
        if (!options.length) { this.log(`${describeStep(step)} — nothing to activate.`, 'fizzle'); return true; }
        this.state.stack.push({
          kind: 'choice', purpose: 'activateEach', zone: step.zone, options, optional: step.mode === 'any', skipBusy: true,
          source: f.source,
          prompt: `${f.label}: activate each lit card in ${zoneLabel(step.zone)}${step.mode === 'any' ? ' (or stop)' : ''}.`,
        });
        return true;
      }
      case 'moveEach': {
        this.seeZone(step.from);
        this.seeZone(step.to);
        // Pushed in reverse so the oldest card moves first.
        for (const o of this.snapshot(step.from).reverse()) {
          this.pushEvent({ type: 'move', card: o.card, arrival: o.arrival, from: step.from, to: step.to, at: step.at ?? 'bottom' });
        }
        return true;
      }
      case 'gain':
      case 'lose':
        this.seeCounter(step.counter);
        this.pushEvent({ type: 'counter', counter: step.counter, amount: step.do === 'gain' ? step.amount : -step.amount });
        return true;
      case 'shuffle':
        this.seeZone(step.zone);
        shuffleInPlace(this.state, this.zone(step.zone));
        this.log(`${zoneLabel(step.zone)} is shuffled.`);
        return true;
      case 'if': {
        const branch = this.check(step.cond) ? step.then : step.else;
        if (branch) f.cursors.push({ steps: branch, pc: 0, times: 1 });
        return true;
      }
      case 'repeat':
        if (step.times > 0) f.cursors.push({ steps: step.steps, pc: 0, times: step.times });
        return true;
      case 'win':
        this.state.won = true;
        this.log(`${f.label}: you win the game!`, 'win');
        return true;
    }
  }

  /** undefined = waiting for a choice; null = no card. */
  private resolveSource(f: CardFrame, src: CardSource, forActivate: boolean, purpose: string): CardId | null | undefined {
    const s = this.state;
    if ('self' in src) return s.cards[f.source] ? f.source : null;
    if ('var' in src) {
      const id = f.vars[src.var];
      return id && s.cards[id] ? id : null;
    }
    if (src.zone === POOL) return forActivate ? null : this.create(this.poolDefs[randomInt(s, this.poolDefs.length)].id);
    this.seeZone(src.zone);
    const list = this.zone(src.zone);
    switch (src.pick) {
      case 'top': return list[0] ?? null;
      case 'bottom': return list.at(-1) ?? null;
      case 'random': return list.length ? list[randomInt(s, list.length)] : null;
      case 'choose': {
        if (f.picked !== undefined) {
          const picked = f.picked;
          f.picked = undefined;
          return picked;
        }
        const options = this.snapshot(src.zone).filter((o) => !(forActivate && this.isBusy(o.card)));
        if (!options.length) return null;
        s.stack.push({
          kind: 'choice', purpose: 'pick', zone: src.zone, options, optional: false, skipBusy: forActivate,
          source: f.source, prompt: `${f.label}: choose a card in ${zoneLabel(src.zone)} ${purpose}.`,
        });
        return undefined;
      }
    }
  }

  private check(c: Cond): boolean {
    if ('all' in c) return c.all.every((x) => this.check(x));
    if ('any' in c) return c.any.some((x) => this.check(x));
    if ('not' in c) return !this.check(c.not);
    const n = 'counter' in c ? this.counter(c.counter) : this.zone(c.zone).length;
    return (c.atLeast === undefined || n >= c.atLeast) && (c.atMost === undefined || n <= c.atMost);
  }

  // ------------------------------------------------------------- event frames

  private pushEvent(ev: GameEvent): void {
    this.state.stack.push({ kind: 'event', ev, phase: 'before' });
  }

  private stepEvent(f: EventFrame): void {
    const s = this.state;
    const ev = f.ev;
    if (f.phase === 'before') {
      f.phase = 'apply';
      this.queueTriggers('before', ev);
      return;
    }
    if (f.phase === 'after') {
      s.stack.pop();
      this.queueTriggers('after', ev);
      return;
    }

    // apply
    switch (ev.type) {
      case 'move': {
        const inst = s.cards[ev.card];
        if (!inst || inst.arrival !== ev.arrival || inst.zone !== ev.from) {
          s.stack.pop();
          if (inst?.zone === POOL) delete s.cards[ev.card];
          this.log(`${inst ? this.def(ev.card).name : 'A card'} already moved — the move fizzles.`, 'fizzle');
          return;
        }
        const name = this.def(ev.card).name;
        if (ev.to === POOL) {
          this.remove(inst);
          this.log(`${name} is removed.`);
        } else {
          this.place(inst, ev.to, ev.at);
          this.log(ev.from === POOL ? `${name} appears in ${zoneLabel(ev.to)}.` : `${name}: ${zoneLabel(ev.from)} → ${zoneLabel(ev.to)}.`);
        }
        f.phase = 'after';
        return;
      }
      case 'counter': {
        const before = this.counter(ev.counter);
        const after = Math.max(0, before + ev.amount);
        if (after === before) {
          s.stack.pop();
          this.log(`${ev.counter} stays at ${before}.`, 'fizzle');
          return;
        }
        s.counters[ev.counter] = after;
        ev.amount = after - before;
        this.log(`${ev.amount > 0 ? '+' : ''}${ev.amount} ${ev.counter} (now ${after}).`);
        f.phase = 'after';
        return;
      }
      case 'activate': {
        const inst = s.cards[ev.card];
        const reason = !inst || inst.zone === POOL ? 'is gone'
          : this.isBusy(ev.card) ? 'is still resolving'
          : ev.arrival !== undefined && inst.arrival !== ev.arrival ? 'moved'
          : null;
        if (reason) {
          s.stack.pop();
          this.log(`${inst ? this.def(ev.card).name : 'A card'} ${reason} — the activation fizzles.`, 'fizzle');
          return;
        }
        ev.zone = inst.zone;
        f.phase = 'after';
        const def = this.def(ev.card);
        this.log(`${def.name} activates.`);
        this.pushCard(ev.card, def.name, def.steps, {});
        return;
      }
    }
  }

  // ------------------------------------------------------------- triggers

  private queueTriggers(when: 'before' | 'after', ev: GameEvent): void {
    const pending: PendingTrigger[] = [];
    const eventCard = ev.type === 'counter' ? null : ev.card;
    for (const zone of this.state.seenZones) {
      if (zone === POOL || this.isFaceDown(zone)) continue;
      for (const id of this.zone(zone)) {
        if (this.isBusy(id)) continue;
        const inst = this.state.cards[id];
        this.def(id).triggers?.forEach((t, i) => {
          if (t.when === when && this.triggerActive(inst, t) && this.matches(t.on, ev, id)) {
            pending.push({ card: id, arrival: inst.arrival, trigger: i, eventCard });
          }
        });
      }
    }
    if (pending.length) this.state.stack.push({ kind: 'triggers', when, pending });
  }

  private triggerActive(inst: CardInstance, t: { while?: ZoneName[] }): boolean {
    if (inst.zone === POOL || this.isFaceDown(inst.zone)) return false;
    return !t.while || t.while.includes(inst.zone);
  }

  private matches(p: EventPattern, ev: GameEvent, self: CardId): boolean {
    if (p.event === 'counter') {
      if (ev.type !== 'counter') return false;
      if (p.counter && p.counter !== ev.counter) return false;
      return !p.dir || (p.dir === 'up' ? ev.amount > 0 : ev.amount < 0);
    }
    if (ev.type === 'counter' || p.event !== ev.type) return false;
    if (p.card === 'self' && ev.card !== self) return false;
    if (p.card === 'other' && ev.card === self) return false;
    if (p.event === 'activate' && ev.type === 'activate') return !p.zone || p.zone === ev.zone;
    if (p.event === 'move' && ev.type === 'move') return (!p.from || p.from === ev.from) && (!p.to || p.to === ev.to);
    return false;
  }

  private fireTrigger(f: TriggerFrame, index: number): void {
    const [p] = f.pending.splice(index, 1);
    const def = this.def(p.card);
    this.log(`${def.name} triggers.`);
    this.pushCard(p.card, `${def.name} (${f.when})`, def.triggers![p.trigger].steps, { event: p.eventCard });
  }

  // ------------------------------------------------------------- state helpers

  private pushCard(card: CardId, label: string, steps: Step[], vars: Record<string, CardId | null>): void {
    this.state.busy[card] = (this.state.busy[card] ?? 0) + 1;
    this.state.stack.push({ kind: 'card', source: card, label, cursors: [{ steps, pc: 0, times: 1 }], vars });
  }

  private unlock(card: CardId): void {
    const n = (this.state.busy[card] ?? 1) - 1;
    if (n > 0) this.state.busy[card] = n;
    else delete this.state.busy[card];
  }

  private cardBelow(): CardFrame {
    const f = this.state.stack.at(-1);
    if (f?.kind !== 'card') throw new Error('A pick choice must sit on a card frame');
    return f;
  }

  /** Every card in a zone right now, with its arrival, oldest first. */
  private snapshot(zone: ZoneName): Option[] {
    return this.zone(zone).map((card) => ({ card, arrival: this.state.cards[card].arrival }));
  }

  private create(defId: string): CardId {
    const id = `c${this.state.nextId++}`;
    this.state.cards[id] = { id, def: defId, zone: POOL, arrival: 0 };
    return id;
  }

  private place(inst: CardInstance, zone: ZoneName, at: 'top' | 'bottom'): void {
    this.detach(inst);
    this.seeZone(zone);
    const list = (this.state.zones[zone] ??= []);
    if (at === 'top') list.unshift(inst.id); else list.push(inst.id);
    inst.zone = zone;
    inst.arrival = this.state.nextArrival++;
  }

  private remove(inst: CardInstance): void {
    this.detach(inst);
    delete this.state.cards[inst.id];
  }

  private detach(inst: CardInstance): void {
    const list = this.state.zones[inst.zone];
    if (!list) return;
    const i = list.indexOf(inst.id);
    if (i >= 0) list.splice(i, 1);
  }

  private seeZone(zone: ZoneName): void {
    if (zone !== POOL && !this.state.seenZones.includes(zone)) this.state.seenZones.push(zone);
  }

  private seeCounter(counter: string): void {
    if (!this.state.seenCounters.includes(counter)) this.state.seenCounters.push(counter);
  }

  private abortChain(): void {
    this.state.stack = [];
    this.state.busy = {};
    this.state.chainSteps = 0;
    this.log(`The chain ran past ${CHAIN_LIMIT} steps and was cut off.`, 'warn');
  }

  private log(text: string, tone?: 'fizzle' | 'warn' | 'win'): void {
    const depth = this.state.stack.filter((f) => f.kind === 'card').length;
    this.state.log.push({ depth, text, tone });
  }
}
