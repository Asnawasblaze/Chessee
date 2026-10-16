/* Types for chessScene.js.
 *
 * The scene and the modules under gfx/ and logic/ are plain JS, ported from the
 * standalone prototype in animations/ and kept close enough to it to still be
 * diffable. Converting them would mean declaring a few hundred class fields for
 * no benefit at the only place types are actually load-bearing — which is here,
 * the boundary the React wrapper crosses. So the boundary is typed and the
 * interior is not.
 */

/**
 * The channels the chapter's pinned timeline writes at frame rate. Every field
 * optional: anything omitted holds its last value, so a caller can drive one
 * channel from one tween without restating the rest.
 */
export interface ChessSceneState {
  /**
   * Which beat's frame, 0-3. Fractional values are composed frames in their own
   * right, not halfway houses — the camera interpolates and eases between the
   * shots either side, so a scrub that stops between two beats still lands on
   * something framed.
   */
  beat?: number;
  /** 0-1, how present the four analysis cards are. */
  instruments?: number;
  /**
   * 0-1, how present the rating gauge is. Separate from `instruments` because the
   * closing shot needs the four analysis cards to leave while this one stays.
   */
  gauge?: number;
  /** 0-1, how present the row of opponents behind Black is. */
  bots?: number;
  /** Above 0.5, predicted lines are performed in phantom pieces over the board. */
  preview?: number;
  /** The rating the gauge shows, in Elo. */
  elo?: number;
  /** 0-1, how far the whole scene is held back under the chapter's copy. */
  dim?: number;
}

export interface ChessSceneOptions {
  reducedMotion?: boolean;
  /**
   * The page's quality tier, from renderQuality.ts. Not detected here: the
   * budget being rationed is one GPU driving six canvases, so the decision
   * belongs to the page rather than to this container's dimensions.
   */
  quality?: "low" | "medium" | "high";
}

/** What the React wrapper hands out. See ChessBoard.tsx for the contract. */
export interface ChessSceneHandle {
  set(values: ChessSceneState): void;
}

export declare class ChessScene {
  constructor(container: HTMLElement, options?: ChessSceneOptions);
  /** True when WebGL was refused. Nothing else on the instance is usable. */
  readonly failed: boolean;
  set(values: ChessSceneState): void;
  setPaused(paused: boolean): void;
  resize(): void;
  dispose(): void;
}

/** Mounts the scene into a sized element. Null when WebGL was refused. */
export declare function createChessScene(
  container: HTMLElement,
  options?: ChessSceneOptions
): ChessScene | null;
