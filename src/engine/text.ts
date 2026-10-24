// Card text is generated from the card's data, so what a card says is always what it does.

import { POOL, type CardDef, type CardSource, type Cond, type EventPattern, type Step, type Trigger, type ZoneName } from './types';

export function zoneLabel(zone: ZoneName): string {
  return zone.charAt(0).toUpperCase() + zone.slice(1);
}

function source(src: CardSource): string {
  if ('self' in src) return 'this card';
  if ('var' in src) return src.var === 'it' ? 'it' : src.var === 'event' ? 'that card' : src.var;
  if (src.zone === POOL) return 'a new card';
  const z = zoneLabel(src.zone);
  switch (src.pick) {
    case 'top': return `the top card of ${z}`;
    case 'bottom': return `the bottom card of ${z}`;
    case 'random': return `a random card from ${z}`;
    case 'choose': return `a card of your choice from ${z}`;
  }
}

function cond(c: Cond): string {
  if ('all' in c) return c.all.map(cond).join(' and ');
  if ('any' in c) return c.any.map(cond).join(' or ');
  if ('not' in c) return `not (${cond(c.not)})`;
  const range = c.atLeast !== undefined && c.atMost !== undefined
    ? `${c.atLeast}–${c.atMost}`
    : c.atLeast !== undefined ? `${c.atLeast}+` : `at most ${c.atMost ?? 0}`;
  if ('counter' in c) return `you have ${range} ${c.counter}`;
  if (c.atMost === 0 && c.atLeast === undefined) return `${zoneLabel(c.zone)} is empty`;
  return `${zoneLabel(c.zone)} has ${range} cards`;
}

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function describeStep(step: Step): string {
  switch (step.do) {
    case 'move': {
      const what = source(step.card);
      const where = step.to === POOL ? 'Remove' : 'Move';
      if (step.to === POOL) return `${where} ${what}.`;
      if ('zone' in step.card && step.card.zone === POOL) return `Put a new card into ${zoneLabel(step.to)}${step.at === 'top' ? ' (on top)' : ''}.`;
      return sentence(`move ${what} to ${step.at === 'top' ? 'the top of ' : ''}${zoneLabel(step.to)}.`);
    }
    case 'activate':
      if ('zone' in step.card && step.card.zone === POOL) return 'Activate a new card.';
      return sentence(`activate ${source(step.card)}.`);
    case 'activateEach':
      return `Activate each ${step.others ? 'other ' : ''}card in ${zoneLabel(step.zone)}, ${step.mode === 'any' ? 'as many as you like' : 'in any order'}.`;
    case 'moveEach':
      return `Move each card in ${zoneLabel(step.from)} to ${zoneLabel(step.to)}.`;
    case 'gain': return `Gain ${step.amount} ${step.counter}.`;
    case 'lose': return `Lose ${step.amount} ${step.counter}.`;
    case 'shuffle': return `Shuffle ${zoneLabel(step.zone)}.`;
    case 'win': return 'Win the game.';
    case 'repeat': return `${step.times} times: ${describeSteps(step.steps).join(' ')}`;
    case 'if': {
      const then = describeSteps(step.then).join(' ');
      const otherwise = step.else ? ` Otherwise: ${describeSteps(step.else).join(' ')}` : '';
      return `If ${cond(step.cond)}: ${then}${otherwise}`;
    }
  }
}

export function describeSteps(steps: Step[]): string[] {
  return steps.map(describeStep);
}

function pattern(p: EventPattern): string {
  const card = p.event === 'counter' ? undefined : p.card;
  const who = card === 'self' ? 'this card' : card === 'other' ? 'another card' : 'a card';
  switch (p.event) {
    case 'activate':
      return `${who}${p.zone ? ` in ${zoneLabel(p.zone)}` : ''} is activated`;
    case 'move':
      if (p.to && p.from) return `${who} moves from ${zoneLabel(p.from)} to ${zoneLabel(p.to)}`;
      if (p.to) return `${who} enters ${zoneLabel(p.to)}`;
      if (p.from) return `${who} leaves ${zoneLabel(p.from)}`;
      return `${who} moves`;
    case 'counter':
      if (p.dir === 'down') return `you lose ${p.counter ?? 'a counter'}`;
      return `you gain ${p.counter ?? 'a counter'}`;
  }
}

export function describeTrigger(t: Trigger): string {
  const head = `${t.when === 'before' ? 'Before' : 'After'} ${pattern(t.on)}`;
  const where = t.while ? ` (while in ${t.while.map(zoneLabel).join(' or ')})` : '';
  return `${head}${where}: ${describeSteps(t.steps).join(' ')}`;
}

export function describeCard(def: CardDef): string[] {
  return [...describeSteps(def.steps), ...(def.triggers ?? []).map(describeTrigger)];
}
