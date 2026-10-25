import './style.css';
import { ruleset } from './cards';
import { Game } from './engine/game';
import { describeCard, describeStep, zoneLabel } from './engine/text';
import { RULES, type CardId, type Frame, type Prompt } from './engine/types';

const STORAGE_KEY = 'abstract-card-game:last';
const app = document.querySelector<HTMLDivElement>('#app')!;

let game: Game;
/** Cards whose arrival is at least this came in since the last click, and get a short highlight. */
let freshFrom = Infinity;
/** Zones and counters in the order they first showed up this run, so nothing jumps around. */
let zoneOrder: string[] = [];
let counterOrder: string[] = [];

function remember(order: string[], names: Iterable<string>): string[] {
  for (const n of names) if (!order.includes(n)) order.push(n);
  return order;
}

// ---------------------------------------------------------------- setup

function load(): { character: string; seed: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && ruleset.characters.some((c) => c.id === saved.character)) return saved;
  } catch { /* storage unavailable */ }
  return { character: ruleset.characters[0].id, seed: randomSeed() };
}

function save(character: string, seed: number): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ character, seed })); } catch { /* storage unavailable */ }
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

function newRun(character: string, seed: number): void {
  game = Game.start(ruleset, character, seed);
  freshFrom = Infinity;
  zoneOrder = [];
  counterOrder = [];
  save(character, seed);
  render();
}

function play(card: CardId | null): void {
  freshFrom = game.state.nextArrival;
  game.input(card ? { click: card } : { done: true });
  render();
}

// ---------------------------------------------------------------- dom helper

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

// ---------------------------------------------------------------- render

function render(): void {
  const prompt = game.prompt();
  const lit = new Set<CardId>(prompt.type === 'over' ? [] : prompt.options);
  const log = logPanel();
  app.replaceChildren(
    header(),
    promptBar(prompt),
    h('main', { class: 'layout' }, board(lit), h('aside', { class: 'side' }, stackPanel(), log)),
  );
  const entries = log.querySelector('ol')!;
  entries.scrollTop = entries.scrollHeight;
}

function header(): HTMLElement {
  const s = game.state;
  const select = h('select', { 'aria-label': 'Character', onchange: () => newRun(select.value, randomSeed()) },
    ...ruleset.characters.map((c) => h('option', { value: c.id, selected: c.id === s.character }, c.name)));
  const seedInput = h('input', { type: 'number', value: s.seed, 'aria-label': 'Seed', class: 'seed' });
  const character = ruleset.characters.find((c) => c.id === s.character)!;

  const counters = remember(counterOrder, Object.keys(s.counters)).filter((c) => game.counter(c) > 0);
  return h('header', { class: 'top' },
    h('div', { class: 'brand' },
      h('h1', {}, 'Abstract'),
      h('p', {}, 'Press one card in Rules per turn. Everything else is cards.')),
    h('div', { class: 'run' },
      select,
      h('span', { class: 'blurb' }, character.blurb),
      h('label', { class: 'seed-label' }, 'Seed ', seedInput),
      h('button', { onclick: () => newRun(s.character, Number(seedInput.value) || 0) }, 'Restart'),
      h('button', { class: 'primary', onclick: () => newRun(s.character, randomSeed()) }, 'New run')),
    h('div', { class: 'counters' },
      h('span', { class: 'counter turn' }, h('b', {}, String(s.turn)), ' turn'),
      ...counters.map((c) => h('span', { class: 'counter' }, h('b', {}, String(game.counter(c))), ` ${c}`)),
      h('span', { class: 'counter pool' }, h('b', {}, '∞'), ' pool')),
  );
}

function promptBar(p: Prompt): HTMLElement {
  let text: string;
  let action: HTMLElement | null = null;
  switch (p.type) {
    case 'rules': text = 'Press a card in Rules.'; break;
    case 'choice':
      text = p.prompt;
      if (p.optional) action = h('button', { onclick: () => play(null) }, 'Stop here');
      break;
    case 'triggers':
      text = `${p.options.length} ${p.when} effects want to happen. Click them in the order they should resolve.`;
      break;
    case 'over':
      text = p.reason === 'won' ? `You won in ${game.state.turn} turns.` : 'Your Rules zone is empty. Nothing can ever happen again.';
      action = h('button', { class: 'primary', onclick: () => newRun(game.state.character, randomSeed()) }, 'New run');
      break;
  }
  return h('div', { class: `prompt prompt-${p.type}${p.type === 'over' ? ` ${p.reason}` : ''}` }, h('span', {}, text), action);
}

function board(lit: Set<CardId>): HTMLElement {
  // Only zones that hold cards exist. Rules is always shown: it is where you act.
  const order = remember(zoneOrder, [RULES, ...Object.keys(game.state.zones)]).filter((z) => z === RULES || game.zone(z).length);
  return h('section', { class: 'board' }, ...order.map((z) => zonePanel(z, lit)));
}

function zonePanel(zone: string, lit: Set<CardId>): HTMLElement {
  const ids = game.zone(zone);
  const faceDown = game.isFaceDown(zone);
  const title = h('h2', {}, zoneLabel(zone), h('span', { class: 'count' }, String(ids.length)), faceDown && h('span', { class: 'tag' }, 'face down'));
  let body: HTMLElement;
  if (faceDown) {
    const anyLit = ids.some((id) => lit.has(id));
    body = h('div', { class: 'pile' + (anyLit ? ' lit' : '') }, h('div', { class: 'back' }, h('span', {}, String(ids.length))));
  } else {
    body = h('div', { class: 'cards' }, ...(ids.length ? ids.map((id) => cardEl(id, lit.has(id))) : [h('span', { class: 'none' }, 'empty')]));
  }
  return h('div', { class: `zone zone-${zone === RULES ? 'rules' : 'other'}` }, title, body);
}

function cardEl(id: CardId, isLit: boolean): HTMLElement {
  const inst = game.state.cards[id];
  const def = game.def(id);
  const classes = ['card'];
  if (isLit) classes.push('lit');
  if (game.isBusy(id)) classes.push('busy');
  if (inst.arrival >= freshFrom) classes.push('fresh');
  return h('button', { class: classes.join(' '), disabled: !isLit, title: describeCard(def).join('\n'), onclick: () => play(id) },
    h('span', { class: 'name' }, def.name),
    h('span', { class: 'text' }, ...describeCard(def).map((line) => h('span', { class: 'line' }, line))),
    game.isBusy(id) && h('span', { class: 'badge' }, 'resolving'));
}

function stackPanel(): HTMLElement {
  const frames = [...game.state.stack].reverse();
  return h('div', { class: 'panel stack' },
    h('h3', {}, 'Stack', h('span', { class: 'count' }, String(frames.length))),
    frames.length
      ? h('ol', {}, ...frames.map(frameEl))
      : h('p', { class: 'none' }, 'Nothing is resolving.'));
}

function frameEl(f: Frame): HTMLElement {
  const name = (id: CardId | null) => (id && game.state.cards[id] ? game.def(id).name : 'a card');
  switch (f.kind) {
    case 'card': {
      const cur = f.cursors.at(-1);
      const next = cur && cur.pc < cur.steps.length ? describeStep(cur.steps[cur.pc]) : 'finishing';
      return h('li', { class: 'f-card' }, h('b', {}, f.label), h('span', {}, `next: ${next}`));
    }
    case 'event': {
      const ev = f.ev;
      const what = ev.type === 'move' ? `${name(ev.card)}: ${zoneLabel(ev.from)} → ${zoneLabel(ev.to)}`
        : ev.type === 'activate' ? `activate ${name(ev.card)}`
        : `${ev.amount > 0 ? '+' : ''}${ev.amount} ${ev.counter}`;
      const phase = f.phase === 'before' ? 'about to happen' : f.phase === 'apply' ? 'before effects done' : ev.type === 'activate' ? 'in progress' : 'done';
      return h('li', { class: 'f-event' }, h('b', {}, what), h('span', {}, phase));
    }
    case 'choice':
      return h('li', { class: 'f-choice' }, h('b', {}, 'waiting for you'), h('span', {}, `${f.options.length} lit in ${zoneLabel(f.zone)}`));
    case 'triggers':
      return h('li', { class: 'f-trig' }, h('b', {}, `${f.when} effects`), h('span', {}, f.pending.map((p) => name(p.card)).join(', ')));
  }
}

function logPanel(): HTMLElement {
  const entries = game.state.log.slice(-300);
  return h('div', { class: 'panel log' },
    h('h3', {}, 'Log'),
    h('ol', {}, ...entries.map((e) => h('li', {
      class: [e.tone ?? '', e.text.startsWith('Turn ') ? 'turn' : ''].join(' ').trim() || undefined,
      style: `--depth:${e.depth}`,
    }, e.text))));
}

const start = load();
newRun(start.character, start.seed);
