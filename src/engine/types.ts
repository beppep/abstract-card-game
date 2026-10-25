// Core data shapes. Everything in GameState is plain JSON so a game can be
// saved, cloned or replayed from its seed.

export type ZoneName = string;
export type CounterName = string;
export type CardId = string;

/**
 * The two zones the engine itself knows about. Every other zone is just a name on a card:
 * it exists while it holds cards. Counters likewise exist while they are above zero.
 */
export const RULES: ZoneName = 'rules';
export const POOL: ZoneName = 'pool';

// ---------------------------------------------------------------- card text

/** Where a step gets its card from. */
export type CardSource =
  | { self: true }
  /** A card remembered earlier in this same card's resolution ("it"). */
  | { var: string }
  /** A position in a zone, read when the step resolves. `pool` always yields a brand new random card. */
  | { zone: ZoneName; pick: 'top' | 'bottom' | 'random' | 'choose' };

export type Step =
  /** Move one card. The moved card is remembered as `as` (default "it"). */
  | { do: 'move'; card: CardSource; to: ZoneName; at?: 'top' | 'bottom'; as?: string }
  /** Activate one card. */
  | { do: 'activate'; card: CardSource; as?: string }
  /**
   * Light up every card that is in `zone` right now; the player clicks them one at a time.
   * A card only stays lit while it keeps the same arrival in that zone.
   * `all`: you must click every lit card. `any`: you may stop whenever you like.
   */
  | { do: 'activateEach'; zone: ZoneName; mode: 'all' | 'any'; others?: boolean }
  /** Move every card that is in `from` right now, oldest first, one small step each. */
  | { do: 'moveEach'; from: ZoneName; to: ZoneName; at?: 'top' | 'bottom' }
  | { do: 'gain'; counter: CounterName; amount: number }
  | { do: 'lose'; counter: CounterName; amount: number }
  | { do: 'shuffle'; zone: ZoneName }
  | { do: 'if'; cond: Cond; then: Step[]; else?: Step[] }
  | { do: 'repeat'; times: number; steps: Step[] }
  | { do: 'win' };

export type Cond =
  | { counter: CounterName; atLeast?: number; atMost?: number }
  | { zone: ZoneName; atLeast?: number; atMost?: number }
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond };

export type EventPattern =
  | { event: 'activate'; card?: 'self' | 'other'; zone?: ZoneName }
  | { event: 'move'; card?: 'self' | 'other'; from?: ZoneName; to?: ZoneName }
  | { event: 'counter'; counter?: CounterName; dir?: 'up' | 'down' };

export interface Trigger {
  when: 'before' | 'after';
  on: EventPattern;
  steps: Step[];
  /** Zones this card must be in for the trigger to work. Default: any face-up zone. */
  while?: ZoneName[];
}

export interface CardDef {
  id: string;
  name: string;
  /** What happens when the card is activated. */
  steps: Step[];
  triggers?: Trigger[];
  /** Set to false to keep a card out of the pool. */
  pool?: boolean;
}

export interface Character {
  id: string;
  name: string;
  blurb: string;
  rules: string[];
}

export interface Ruleset {
  cards: CardDef[];
  characters: Character[];
  /** Zones shown face down (piles). Purely about what is visible: rules treat them like any zone. */
  faceDown: ZoneName[];
}

// ---------------------------------------------------------------- game state

export interface CardInstance {
  id: CardId;
  def: string;
  zone: ZoneName;
  /** Changes every time the card enters a zone. "The same card, still where it was" means same arrival. */
  arrival: number;
}

export type GameEvent =
  | { type: 'move'; card: CardId; arrival: number; from: ZoneName; to: ZoneName; at: 'top' | 'bottom' }
  /** `arrival` set means the card must still have that arrival (used by activateEach). */
  | { type: 'activate'; card: CardId; arrival?: number; zone: ZoneName }
  | { type: 'counter'; counter: CounterName; amount: number };

export interface Cursor {
  steps: Step[];
  pc: number;
  /** Remaining passes for a `repeat` block, including the current one. */
  times: number;
}

export interface CardFrame {
  kind: 'card';
  source: CardId;
  label: string;
  cursors: Cursor[];
  vars: Record<string, CardId | null>;
  /** Value written by a choice frame for the step that asked for it. */
  picked?: CardId | null;
}

export interface EventFrame {
  kind: 'event';
  ev: GameEvent;
  phase: 'before' | 'apply' | 'after';
}

export interface Option {
  card: CardId;
  arrival: number;
}

export interface ChoiceFrame {
  kind: 'choice';
  /** `pick`: choose one card for the step below. `activateEach`: click cards to activate them. */
  purpose: 'pick' | 'activateEach';
  prompt: string;
  zone: ZoneName;
  options: Option[];
  optional: boolean;
  /** Busy cards are not offered (the chosen card is about to be activated). */
  skipBusy: boolean;
  /** Card whose step opened this choice. */
  source: CardId;
}

export interface PendingTrigger {
  card: CardId;
  arrival: number;
  trigger: number;
  /** The card the event was about, if any. Trigger steps can refer to it as { var: 'event' }. */
  eventCard: CardId | null;
}

export interface TriggerFrame {
  kind: 'triggers';
  when: 'before' | 'after';
  pending: PendingTrigger[];
}

export type Frame = CardFrame | EventFrame | ChoiceFrame | TriggerFrame;

export interface LogEntry {
  depth: number;
  text: string;
  tone?: 'fizzle' | 'warn' | 'win';
}

export interface GameState {
  seed: number;
  rng: number;
  character: string;
  nextId: number;
  nextArrival: number;
  cards: Record<CardId, CardInstance>;
  /** Index 0 is the top / oldest card. */
  zones: Record<ZoneName, CardId[]>;
  counters: Record<CounterName, number>;
  stack: Frame[];
  /** Cards whose effects are currently resolving. They cannot be activated or trigger. */
  busy: Record<CardId, number>;
  turn: number;
  won: boolean;
  chainSteps: number;
  log: LogEntry[];
}

export type Input = { click: CardId } | { done: true };

export type Prompt =
  | { type: 'rules'; options: CardId[] }
  | { type: 'choice'; prompt: string; options: CardId[]; optional: boolean }
  | { type: 'triggers'; when: 'before' | 'after'; options: CardId[] }
  | { type: 'over'; reason: 'won' | 'no-rules' };
