/**
 * Minimal chess board bookkeeping.
 *
 * This is deliberately *not* a chess engine: the looping animation replays a
 * scripted game, so we only need enough state to (a) know where every piece is
 * and (b) generate pseudo-legal moves for the interactive "move map" the user
 * gets when clicking a piece. Check / pin legality is intentionally ignored —
 * it would add a lot of code for zero visual payoff.
 */

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const BOARD_SIZE = 8;

/** Square string ("e4") -> { file: 4, rank: 3 } with 0-based indices. */
export function squareToIndex(square) {
  return {
    file: square.charCodeAt(0) - 97,
    rank: Number(square[1]) - 1,
  };
}

/** 0-based file/rank -> square string. Returns null when off board. */
export function indexToSquare(file, rank) {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}`;
}

/**
 * Square -> world position. The board is 8x8 world units, centred on origin,
 * with white's first rank at -z so the default camera looks down the board
 * from behind white.
 */
export function squareToWorld(square, y = 0) {
  const { file, rank } = squareToIndex(square);
  return {
    x: file - 3.5,
    y,
    z: 3.5 - rank,
  };
}

/** True when the square is a light square. */
export function isLightSquare(square) {
  const { file, rank } = squareToIndex(square);
  return (file + rank) % 2 === 1;
}

export const PIECE_NAMES = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

export const PIECE_VALUES = { p: 1, n: 3, b: 3.25, r: 5, q: 9, k: 0 };

const START_POSITION = [
  ['a1', 'r', 'w'], ['b1', 'n', 'w'], ['c1', 'b', 'w'], ['d1', 'q', 'w'],
  ['e1', 'k', 'w'], ['f1', 'b', 'w'], ['g1', 'n', 'w'], ['h1', 'r', 'w'],
  ['a2', 'p', 'w'], ['b2', 'p', 'w'], ['c2', 'p', 'w'], ['d2', 'p', 'w'],
  ['e2', 'p', 'w'], ['f2', 'p', 'w'], ['g2', 'p', 'w'], ['h2', 'p', 'w'],
  ['a7', 'p', 'b'], ['b7', 'p', 'b'], ['c7', 'p', 'b'], ['d7', 'p', 'b'],
  ['e7', 'p', 'b'], ['f7', 'p', 'b'], ['g7', 'p', 'b'], ['h7', 'p', 'b'],
  ['a8', 'r', 'b'], ['b8', 'n', 'b'], ['c8', 'b', 'b'], ['d8', 'q', 'b'],
  ['e8', 'k', 'b'], ['f8', 'b', 'b'], ['g8', 'n', 'b'], ['h8', 'r', 'b'],
];

const SLIDE_DIRS = {
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  q: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
};

const STEP_DIRS = {
  n: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  k: [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]],
};

/**
 * Occupancy map keyed by square. Values are `{ id, type, color, square }`
 * where `id` is stable for the lifetime of a loop so the renderer can bind a
 * mesh to a logical piece.
 */
export class BoardState {
  constructor() {
    this.bySquare = new Map();
    this.byId = new Map();
    this.reset();
  }

  reset() {
    this.bySquare.clear();
    this.byId.clear();
    START_POSITION.forEach(([square, type, color], i) => {
      const piece = { id: `${color}${type}${i}`, type, color, square, captured: false };
      this.bySquare.set(square, piece);
      this.byId.set(piece.id, piece);
    });
  }

  at(square) {
    return this.bySquare.get(square) ?? null;
  }

  pieces() {
    return [...this.byId.values()];
  }

  /**
   * Apply a scripted move. Returns `{ piece, captured, rook }` so the renderer
   * can animate exactly what changed (including the castling rook).
   */
  apply(move) {
    const piece = this.bySquare.get(move.from);
    if (!piece) return null;

    let captured = this.bySquare.get(move.to) ?? null;
    if (captured) {
      captured.captured = true;
      this.bySquare.delete(captured.square);
    }

    this.bySquare.delete(move.from);
    piece.square = move.to;
    this.bySquare.set(move.to, piece);

    let rook = null;
    if (move.rook) {
      rook = this.bySquare.get(move.rook.from) ?? null;
      if (rook) {
        this.bySquare.delete(move.rook.from);
        rook.square = move.rook.to;
        this.bySquare.set(move.rook.to, rook);
      }
    }

    if (move.promotion && piece) piece.type = move.promotion;

    return { piece, captured, rook };
  }

  /** Pseudo-legal destinations for the piece standing on `square`. */
  movesFrom(square) {
    const piece = this.at(square);
    if (!piece) return [];

    const { file, rank } = squareToIndex(square);
    const out = [];

    const push = (f, r) => {
      const target = indexToSquare(f, r);
      if (!target) return 'off';
      const other = this.at(target);
      if (!other) {
        out.push({ to: target, capture: false });
        return 'empty';
      }
      if (other.color !== piece.color) out.push({ to: target, capture: true });
      return 'blocked';
    };

    if (piece.type === 'p') {
      const dir = piece.color === 'w' ? 1 : -1;
      const homeRank = piece.color === 'w' ? 1 : 6;
      const one = indexToSquare(file, rank + dir);
      if (one && !this.at(one)) {
        out.push({ to: one, capture: false });
        const two = indexToSquare(file, rank + dir * 2);
        if (rank === homeRank && two && !this.at(two)) out.push({ to: two, capture: false });
      }
      for (const df of [-1, 1]) {
        const diag = indexToSquare(file + df, rank + dir);
        if (!diag) continue;
        const other = this.at(diag);
        if (other && other.color !== piece.color) out.push({ to: diag, capture: true });
      }
      return out;
    }

    if (STEP_DIRS[piece.type]) {
      for (const [df, dr] of STEP_DIRS[piece.type]) push(file + df, rank + dr);
      return out;
    }

    for (const [df, dr] of SLIDE_DIRS[piece.type] ?? []) {
      let f = file + df;
      let r = rank + dr;
      while (push(f, r) === 'empty') {
        f += df;
        r += dr;
      }
    }
    return out;
  }

  /** Every piece that can currently reach `square` (used for the probe tool). */
  attackersOf(square) {
    const found = [];
    for (const piece of this.bySquare.values()) {
      if (piece.square === square) continue;
      if (this.movesFrom(piece.square).some((m) => m.to === square)) found.push(piece);
    }
    return found;
  }

  /**
   * Net square control: how many white pieces reach a square minus how many
   * black ones do. One pass over the pieces, reused for the heat-map overlay.
   */
  controlMap() {
    const map = new Map();
    for (const piece of this.bySquare.values()) {
      const delta = piece.color === 'w' ? 1 : -1;
      for (const move of this.movesFrom(piece.square)) {
        map.set(move.to, (map.get(move.to) ?? 0) + delta);
      }
    }
    return map;
  }

  /** Naive material balance in pawns, white-positive. Feeds the HUD readout. */
  material() {
    let score = 0;
    for (const piece of this.bySquare.values()) {
      score += (piece.color === 'w' ? 1 : -1) * PIECE_VALUES[piece.type];
    }
    return score;
  }
}
