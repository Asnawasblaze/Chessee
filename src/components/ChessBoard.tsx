import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import {
  createChessScene,
  type ChessScene,
  type ChessSceneHandle,
  type ChessSceneState,
} from "./chess/chessScene.js";
import { renderQuality } from "./renderQuality";
import "./ChessBoard.css";

export type { ChessSceneHandle, ChessSceneState };

/* ---------------------------------------------------------------------- */
/* ChessBoard — the Why chapter's background, as a React layer             */
/* ---------------------------------------------------------------------- */

/* A thin shell over the imperative scene in chess/chessScene.js. It owns exactly
 * three things — when the scene exists, when its loop runs, and the handle the
 * chapter drives it through — and deliberately nothing else.
 *
 * The chapter drives it through `handleRef.set()`, which writes live channels.
 * Everything about this scene that the scroll timeline touches is scrubbed at
 * frame rate, and a re-render per frame would take the whole composition — three
 * WebGL contexts included — with it. So no state, no props diffing, no React in
 * the loop.
 *
 * The loop stops on two independent conditions: the IntersectionObserver below
 * covers "scrolled away", and `visibilitychange` covers a hidden tab. Both
 * resolve through one `sync()`, because either is enough to stop the frame.
 */

interface ChessBoardProps {
  className?: string;
  handleRef?: Ref<ChessSceneHandle>;
}

export default function ChessBoard({
  className = "",
  handleRef,
}: ChessBoardProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ChessScene | null>(null);
  /* The loop is stopped and started from two independent conditions, so the
     resolver has to be reachable from outside the effect that owns them. */
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    /* Returns null rather than throwing when the browser refuses a context. This
       page asks for several and browsers cap how many a document may hold, so a
       refusal is a real state and not an exceptional one — the chapter keeps its
       night, its copy and its figure, and loses a background. */
    const scene = createChessScene(mount, {
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      /* The scene has its own `detectQuality`, which measured this container.
         That is the wrong input: what is being rationed is one GPU pushing six
         canvases, so the tier is a page-level decision and every other layer now
         reads it from renderQuality. Passing it here is what keeps the board
         from being the one layer that disagrees. */
      quality: renderQuality().tier,
    });
    if (!scene) return;
    sceneRef.current = scene;

    let onScreen = true;
    let pageVisible = !document.hidden;

    const sync = () => {
      scene.setPaused(!onScreen || !pageVisible);
    };
    syncRef.current = sync;

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0 }
    );
    io.observe(mount);

    const onVisibility = () => {
      pageVisible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    sync();

    return () => {
      syncRef.current = () => {};
      sceneRef.current = null;
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      scene.dispose();
    };
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      set(values: ChessSceneState) {
        sceneRef.current?.set(values);
      },
    }),
    []
  );

  /* `.chess-board` is not negotiable and not the caller's to supply — the renderer
     measures this box to size its drawing buffer, and a div with no height of its
     own yields a one-pixel buffer stretched over the frame. See ChessBoard.css. */
  return (
    <div
      className={`chess-board${className ? ` ${className}` : ""}`}
      ref={mountRef}
      aria-hidden="true"
    />
  );
}
