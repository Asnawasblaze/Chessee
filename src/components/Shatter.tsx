import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  createShatter,
  supportsHtmlInCanvas,
  type ShatterInstance,
  type ShatterOptions,
} from "./shatterEffect";

export type { ShatterInstance, ShatterOptions };

/* ---------------------------------------------------------------------- */
/* Canvas UI: Shatter — the React wrapper, vendored                        */
/* ---------------------------------------------------------------------- */

/* Three canvases and a mode switch. Where the experimental html-in-canvas API
 * exists, the children are laid out inside a `layoutsubtree` canvas and captured
 * from it every paint; where it doesn't, they render as ordinary DOM and the
 * effect quietly paints nothing at all. The effect itself lives in
 * shatterEffect.ts — see the header there for what it does and what it needs.
 *
 * The one addition to the published component is `onReady`, which hands the live
 * instance out so a caller can drive an option from something that changes every
 * frame (this project scrubs `baseStrength` from scroll position) without pushing
 * a number through React state to get there.
 */
interface ShatterProps extends ShatterOptions {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Handed the live instance once the effect is up, and `null` when it goes. */
  onReady?: (instance: ShatterInstance | null) => void;
}

const emptySubscribe = () => () => {};

export default function Shatter({
  children,
  className,
  style,
  onReady,
  ...options
}: ShatterProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<ShatterInstance | null>(null);
  const [initialOptions] = useState(options);
  const [failed, setFailed] = useState(false);
  /* Held in a ref, and synced in its own effect *above* the one that builds the
     effect: a caller passing an inline arrow — which every caller does — must not
     be able to tear down a WebGL context and rebuild it on every render. Effects
     run in declaration order, so the ref is current by the time the builder below
     calls it on mount. */
  const readyRef = useRef(onReady);

  useEffect(() => {
    readyRef.current = onReady;
  });

  const supported = useSyncExternalStore(
    emptySubscribe,
    supportsHtmlInCanvas,
    () => false
  );
  const native = supported && !failed;

  useEffect(() => {
    const source = sourceRef.current;
    const content = contentRef.current;
    const output = outputRef.current;
    if (!source || !content || !output) return;
    /* No html-in-canvas, no effect: without it the content texture never gets
       written, so the shader's guard term zeroes every fragment and the pass
       renders nothing at all. Upstream builds it anyway; here it is skipped,
       because "nothing at all" still costs a live WebGL2 context — and on this
       page there are already three of those, on a budget the browser enforces
       by evicting the oldest. */
    if (!supported) return;
    try {
      instanceRef.current = createShatter(
        { source, content, output },
        initialOptions
      );
    } catch (error) {
      console.warn("Shatter: effect unavailable, falling back to plain DOM.", error);
      instanceRef.current = null;
    }
    if (native && !instanceRef.current) setFailed(true);
    readyRef.current?.(instanceRef.current);
    return () => {
      readyRef.current?.(null);
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [initialOptions, native, supported]);

  useEffect(() => {
    instanceRef.current?.setOptions(options);
  });

  return (
    <div className={className} style={{ position: "relative", ...style }}>
      <canvas
        ref={sourceRef}
        // @ts-expect-error experimental html-in-canvas attribute
        layoutsubtree="true"
        suppressHydrationWarning
        style={
          native
            ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
            : { display: "none" }
        }
      >
        {native ? (
          <div
            ref={contentRef}
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              /* `hidden`, not the published `auto`: the content this project
                 hands the effect is a decorative full-bleed background (see
                 WhySection's .why-ambient) whose layers are deliberately wider
                 than the box they sit in — a receding floor grid, a light
                 shaft — and are meant to be clipped by an ancestor, not to make
                 this box scrollable. `auto` on a box smaller than its content
                 draws a real browser scrollbar, which is what was showing up
                 as the Why chapter's "extra" scrollbar; nothing here is ever
                 meant to be scrolled by the reader. */
              overflow: "hidden",
            }}
          >
            {children}
          </div>
        ) : null}
      </canvas>
      {!native ? (
        <div
          ref={contentRef}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      ) : null}
      <canvas
        ref={outputRef}
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
