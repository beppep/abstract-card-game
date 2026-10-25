# Abstract

A very abstract roguelike card game. There are no built-in rules: everything is cards.

- **Zones** hold cards. They all work the same. A zone is just a name on a card: it exists while it holds cards.
  `rules` and `pool` are the only names the engine knows.
- **Rules.** Each turn you press one card in Rules. That is the only thing a player does on their own.
- **The pool** is infinite. Taking a card from it makes a brand-new random card.
- **Piles** (like `draw`) are just zones shown face down.
- **Counters** are named numbers. A counter exists while it is above zero.
- **Winning** is a card effect ("Win the game"), usually behind a condition.

Play: https://beppep.github.io/abstract-card-game/

## How resolution works

Everything that happens is a frame on one stack ([src/engine/game.ts](src/engine/game.ts)):

- **card**: a card's steps, run in order. The card is *busy* until the frame ends.
- **event**: one small thing (a move, a counter change, an activation). It runs *before* triggers, happens,
  then runs *after* triggers. Triggers fire between the small steps of a card, not after the whole card.
- **choice**: waiting for you to click a lit card.
- **triggers**: several triggers fired at once. You click them in the order you want.

Rules that keep it sane:

1. **Busy cards can't be activated and don't trigger.** A card stays busy until everything it set off has
   finished, because those frames sit above it on the stack. That's what stops A→B→A loops.
2. **"Activate each card in X" lights up the cards in X when it starts.** You click them in any order. A card only
   stays lit while it's been in X the whole time: it goes dark if it leaves, even if it comes back,
   and cards that arrive later never light up. Every time a card enters a zone it gets a new *arrival* number,
   and that's what is checked.
3. **"It" follows the card.** Once a step names a specific card ("activate it"), it tracks that card wherever it goes.
   Position-based steps ("the top card of Draw") read the zone when they resolve.
4. **Step limit.** The pool can feed a chain forever (cards that pull in cards that trigger). After
   2000 steps, the chain is cut off and the log says so.
5. **One seeded RNG** drives the pool and shuffles, so a seed replays the same game.

## Making cards

Cards are data in [src/cards/index.ts](src/cards/index.ts). Card text is generated from the data, so it always
matches what the card does. A character is just three starting Rules cards.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173/abstract-card-game/
npm test         # engine tests, plus random-play stress test
npm run build
```

Pushing to `main` builds and deploys to GitHub Pages (Settings → Pages → Source: GitHub Actions).
