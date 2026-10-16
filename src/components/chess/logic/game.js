/**
 * The scripted game that drives the loop.
 *
 * Morphy vs. Duke of Brunswick & Count Isouard — Paris, 1858 ("The Opera
 * Game"). Chosen because it is short, every move is purposeful, and it ends in
 * a clean mate, which gives the loop a real climax before it resets.
 *
 * Each ply is fully explicit (from/to plus the castling rook) so no move
 * parsing is needed at runtime. `evaluation` is in pawns, white-positive, and
 * roughly tracks what a modern engine reports.
 *
 * Forced-mate plies carry `mateIn` (or `mate` for the mate itself) plus
 * `mateFor`, the side delivering it. `mateFor` is stated explicitly because it
 * cannot be derived from whose turn it is: ply 32 here is Black's *forced*
 * reply inside White's mating net, so the mover and the mating side differ.
 *
 * `pv` is the predicted line — what an engine would print as its principal
 * variation from the position *before* this ply, so `pv[0]` is always this move
 * itself and `pv[1]` is the opponent's predicted best answer. Entries are
 * **indices into `plies`** rather than copied move objects, because every line
 * shown here happens to be the continuation that was actually played, and
 * copying it would let the prediction drift out of sync with the game it is
 * predicting. Inline move objects are accepted too, for a line that leaves the
 * game (see `bestReply`).
 *
 * `bestReply` overrides the opponent's predicted answer. It is needed only
 * where the move actually played next was a mistake: the engine's forecast is
 * "what should happen", and on ply 4 and ply 16 that is not what did happen.
 */

export const OPERA_GAME = {
  id: 'opera',
  title: 'The Opera Game',
  white: 'Morphy',
  black: 'Duke of Brunswick & Count Isouard',
  event: 'Paris, 1858',
  opening: 'Philidor Defence',
  plies: [
    { san: 'e4', from: 'e2', to: 'e4', color: 'w', evaluation: 0.3 },
    { san: 'e5', from: 'e7', to: 'e5', color: 'b', evaluation: 0.2 },
    { san: 'Nf3', from: 'g1', to: 'f3', color: 'w', evaluation: 0.3 },
    { san: 'd6', from: 'd7', to: 'd6', color: 'b', evaluation: 0.55, note: 'Philidor Defence' },
    // Black's best here is 3...Nf6, not the bishop sortie that follows.
    { san: 'd4', from: 'd2', to: 'd4', color: 'w', evaluation: 0.6, bestReply: { san: 'Nf6', from: 'g8', to: 'f6', color: 'b' } },
    { san: 'Bg4', from: 'c8', to: 'g4', color: 'b', evaluation: 0.95, tag: '?', note: 'Loose bishop' },
    { san: 'dxe5', from: 'd4', to: 'e5', color: 'w', capture: true, evaluation: 1.1, pv: [6, 7, 8, 9, 10] },
    { san: 'Bxf3', from: 'g4', to: 'f3', color: 'b', capture: true, evaluation: 1.05 },
    { san: 'Qxf3', from: 'd1', to: 'f3', color: 'w', capture: true, evaluation: 1.15 },
    { san: 'dxe5', from: 'd6', to: 'e5', color: 'b', capture: true, evaluation: 1.2 },
    { san: 'Bc4', from: 'f1', to: 'c4', color: 'w', evaluation: 1.25, note: 'Eyes f7' },
    { san: 'Nf6', from: 'g8', to: 'f6', color: 'b', evaluation: 1.35 },
    { san: 'Qb3', from: 'f3', to: 'b3', color: 'w', evaluation: 1.4, tag: '!', note: 'Double attack on f7', pv: [12, 13, 14, 15, 16] },
    { san: 'Qe7', from: 'd8', to: 'e7', color: 'b', evaluation: 1.75 },
    { san: 'Nc3', from: 'b1', to: 'c3', color: 'w', evaluation: 1.7, note: 'Develop, ignore the pawn' },
    { san: 'c6', from: 'c7', to: 'c6', color: 'b', evaluation: 1.95 },
    // ...b5 loses on the spot; 9...Nbd7 was the move.
    { san: 'Bg5', from: 'c1', to: 'g5', color: 'w', evaluation: 2.1, note: 'Last piece joins', bestReply: { san: 'Nbd7', from: 'b8', to: 'd7', color: 'b' } },
    { san: 'b5', from: 'b7', to: 'b5', color: 'b', evaluation: 3.4, tag: '?', note: 'Opens the c-file' },
    { san: 'Nxb5', from: 'c3', to: 'b5', color: 'w', capture: true, evaluation: 3.3, tag: '!!', note: 'Sacrifice to rip open c6', pv: [18, 19, 20, 21, 22] },
    { san: 'cxb5', from: 'c6', to: 'b5', color: 'b', capture: true, evaluation: 3.6 },
    { san: 'Bxb5+', from: 'c4', to: 'b5', color: 'w', capture: true, check: true, evaluation: 3.8 },
    { san: 'Nbd7', from: 'b8', to: 'd7', color: 'b', evaluation: 4.2, note: 'Forced block' },
    { san: 'O-O-O', from: 'e1', to: 'c1', color: 'w', rook: { from: 'a1', to: 'd1' }, evaluation: 5.1, tag: '!', note: 'Castles into the attack', pv: [22, 23, 24, 25, 26] },
    { san: 'Rd8', from: 'a8', to: 'd8', color: 'b', evaluation: 5.6 },
    { san: 'Rxd7', from: 'd1', to: 'd7', color: 'w', capture: true, evaluation: 6.2, tag: '!' },
    { san: 'Rxd7', from: 'd8', to: 'd7', color: 'b', capture: true, evaluation: 6.8 },
    { san: 'Rd1', from: 'h1', to: 'd1', color: 'w', evaluation: 7.9, tag: '!', note: 'Second rook to the pin', pv: [26, 27, 28, 29, 30, 31, 32] },
    { san: 'Qe6', from: 'e7', to: 'e6', color: 'b', evaluation: 9.5, note: 'Desperate unpin' },
    { san: 'Bxd7+', from: 'b5', to: 'd7', color: 'w', capture: true, check: true, evaluation: 10.5, pv: [28, 29, 30, 31, 32] },
    { san: 'Nxd7', from: 'f6', to: 'd7', color: 'b', capture: true, evaluation: 12 },
    { san: 'Qb8+', from: 'b3', to: 'b8', color: 'w', check: true, mateIn: 2, mateFor: 'w', tag: '!!', note: 'Queen sacrifice', pv: [30, 31, 32] },
    // No `pv` of its own: this ply is the middle of ply 30's line, so the panel
    // keeps that line up and simply steps along it.
    { san: 'Nxb8', from: 'd7', to: 'b8', color: 'b', capture: true, mateIn: 1, mateFor: 'w', note: 'Forced' },
    { san: 'Rd8#', from: 'd1', to: 'd8', color: 'w', mate: true, mateFor: 'w', tag: '#', note: 'Checkmate' },
  ],
};

/** Score used to stand in for a forced mate, in pawns. */
export const MATE_SCORE = 100;

const MINUS = '\u2212';

/** Bounds a probability to 0..1 without letting a non-finite input through. */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Which side is delivering mate, or null if the position is not a forced mate.
 * Prefers the explicit `mateFor` field; falls back to the mover, which is only
 * correct for the move that actually delivers mate.
 */
export function matingSide(ply) {
  if (!ply) return null;
  if (ply.mateFor === 'w' || ply.mateFor === 'b') return ply.mateFor;
  if (ply.mate) return ply.color;
  if (ply.mateIn) return ply.color;
  return null;
}

/**
 * The single source of truth for "how good is this position for White", in
 * pawns. Always returns a finite number so nothing downstream has to guard.
 */
export function signedEval(ply) {
  const side = matingSide(ply);
  if (side) return side === 'w' ? MATE_SCORE : -MATE_SCORE;
  const value = Number(ply?.evaluation);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Maps a white-positive pawn score onto 0..1 for an evaluation bar, where 0.5
 * is level and 1 is White winning.
 *
 * Hyperbolic rather than linear so the first pawn of advantage moves the bar
 * noticeably while a decisive +8 still leaves visible headroom for mate. The
 * result is bounded to (0, 1) by construction, and a non-finite input reads as
 * level rather than poisoning the bar with NaN.
 */
export function evalToFill(value) {
  const score = Number.isFinite(value) ? value : 0;
  const magnitude = Math.abs(score) / (Math.abs(score) + 4);
  return 0.5 + 0.5 * Math.sign(score) * magnitude;
}

/**
 * Formats an evaluation the way an analysis panel would: `+1.25`, `\u22120.40`,
 * `+M2` for a forced mate in two for White, `#` once mate is on the board.
 */
export function formatEval(ply) {
  if (!ply) return '+0.00';
  if (ply.mate) return '#';
  const side = matingSide(ply);
  if (side) return `${side === 'w' ? '+' : MINUS}M${ply.mateIn}`;
  return formatScore(signedEval(ply));
}

/** Formats a raw pawn score with an explicit sign. */
export function formatScore(value) {
  const score = Number.isFinite(value) ? value : 0;
  return `${score < 0 ? MINUS : '+'}${Math.abs(score).toFixed(2)}`;
}

/* ------------------------------------------------------- win / draw / loss */

/**
 * Pawns of advantage per factor-of-ten swing in expectancy. This is the classic
 * Elo conversion (400 centipawns) pulled in slightly, because a scripted
 * brilliancy should reach "winning" a little sooner than a rating formula does.
 */
const PAWNS_PER_DECADE = 3.2;

/** Draw share of a dead-level position, and how quickly an edge eats into it. */
const DRAW_AT_LEVEL = 0.42;
const DRAW_DECAY = 1.65;

/**
 * Win / draw / loss probabilities for White, from a white-positive pawn score.
 *
 * Derived from `signedEval` rather than authored per ply, so the trend graph and
 * the evaluation bar are two views of one number and cannot contradict each
 * other. The construction keeps `win + draw / 2 === expectancy`, which is the
 * property that makes the three bands add to exactly 1 at every point.
 *
 * @param {number} score white-positive advantage in pawns
 * @returns {{ win: number, draw: number, loss: number }} shares summing to 1
 */
export function winDrawLoss(score) {
  const value = Number.isFinite(score) ? score : 0;

  // A forced mate is not a probability question.
  if (Math.abs(value) >= MATE_SCORE) {
    return value > 0 ? { win: 1, draw: 0, loss: 0 } : { win: 0, draw: 0, loss: 1 };
  }

  const expectancy = 1 / (1 + 10 ** (-value / PAWNS_PER_DECADE));
  // Gaussian, so half a pawn barely dents the draw share while +3 all but
  // removes it. Linear decay flattened the interesting part of the curve.
  const draw = DRAW_AT_LEVEL * Math.exp(-((value / DRAW_DECAY) ** 2));
  const win = clamp01(expectancy - draw / 2);
  const loss = clamp01(1 - win - draw);
  return { win, draw: clamp01(1 - win - loss), loss };
}

/**
 * The whole win/draw/loss curve for a game, computed once.
 *
 * The animation replays an authored game, so the full curve is known up front
 * and there is nothing to accumulate frame by frame. Callers reveal it up to
 * the ply on the board instead, which keeps the graph from spoiling the mate.
 *
 * @returns {Array<{ index, san, score, fill, win, draw, loss, mate }>}
 */
export function buildTrend(game) {
  return game.plies.map((ply, index) => {
    const score = signedEval(ply);
    const { win, draw, loss } = winDrawLoss(score);
    return {
      index,
      san: ply.san,
      score,
      fill: evalToFill(score),
      win,
      draw,
      loss,
      mate: Boolean(ply.mate || ply.mateIn),
    };
  });
}

/* ------------------------------------------------------ predicted tactics */

/**
 * Resolves a ply's `pv` into concrete move objects.
 *
 * Numeric entries index into `game.plies`; objects are taken as-is. Returns an
 * empty array when the ply carries no prediction, so callers can treat "no
 * line" and "empty line" the same way.
 *
 * @returns {Array<object>} moves, starting with the ply itself
 */
export function resolvePv(game, index) {
  const ply = game.plies[index];
  if (!ply?.pv?.length) return [];
  return ply.pv
    .map((entry) => (typeof entry === 'number' ? game.plies[entry] : entry))
    .filter(Boolean);
}

/**
 * How many moves the mating side needs, counted from the start of the line.
 * Zero when the line does not end in mate. Counting the mating side's own moves
 * is what makes this agree with the authored `mateIn` fields.
 */
export function pvMateIn(moves) {
  const last = moves[moves.length - 1];
  if (!last?.mate) return 0;
  return moves.filter((move) => move.color === last.color).length;
}

/**
 * The opponent's predicted best answer to a ply, and where that prediction came
 * from. Priority: the engine line, then an explicit override for the two moves
 * whose real continuation was a blunder, then the game's own next move — but
 * never a move the annotator marked as a mistake, because "the opponent's best
 * move" and "the losing move they actually chose" are different claims.
 *
 * @returns {{ move: object, source: 'line'|'override'|'game' }|null}
 */
export function predictedReply(game, index) {
  const ply = game.plies[index];
  if (!ply) return null;

  const line = resolvePv(game, index);
  if (line.length > 1 && line[1].color !== ply.color) return { move: line[1], source: 'line' };

  if (ply.bestReply) return { move: ply.bestReply, source: 'override' };

  const next = game.plies[index + 1];
  if (next && next.color !== ply.color && next.tag !== '?') return { move: next, source: 'game' };

  return null;
}

/**
 * One-line reading of a predicted line, for the tactics panel headline.
 *
 * `qualifier` separates two claims that are easy to conflate. A ply carrying
 * `mateIn` is authored as a *forced* mate: the defender has no way out. A line
 * that merely ends in mate only gets there if the defence follows the line, so
 * it is labelled "best play" instead. Ply 26 is the case that matters — the
 * position is winning and the line does mate, but the distance depends on how
 * Black defends, so announcing a forced mate there would be a stronger claim
 * than the data supports.
 *
 * @returns {{ label: string, qualifier: string, kind: 'mate'|'winning'|'edge'|'level', mateIn: number }}
 */
export function tacticVerdict(game, index) {
  const ply = game.plies[index];
  const moves = resolvePv(game, index);
  const lineMate = pvMateIn(moves);
  const forced = Boolean(ply?.mateIn || ply?.mate);

  if (lineMate > 0) {
    const side = moves[moves.length - 1].color === 'w' ? 'White' : 'Black';
    return {
      label: `${side} mates in ${lineMate}`,
      qualifier: forced ? 'forced' : 'best play',
      kind: 'mate',
      mateIn: lineMate,
    };
  }

  // Fall back to the authored mate distance when no line was spelled out.
  const side = matingSide(ply);
  if (side && ply.mateIn) {
    return {
      label: `${side === 'w' ? 'White' : 'Black'} mates in ${ply.mateIn}`,
      qualifier: 'forced',
      kind: 'mate',
      mateIn: ply.mateIn,
    };
  }
  if (ply?.mate) {
    return { label: 'Checkmate', qualifier: '', kind: 'mate', mateIn: 0 };
  }

  const score = signedEval(ply);
  const leader = score >= 0 ? 'White' : 'Black';
  const magnitude = Math.abs(score);
  if (magnitude >= 3) return { label: `${leader} is winning`, qualifier: '', kind: 'winning', mateIn: 0 };
  if (magnitude >= 0.7) return { label: `${leader} is better`, qualifier: '', kind: 'edge', mateIn: 0 };
  return { label: 'Balanced', qualifier: '', kind: 'level', mateIn: 0 };
}
