import { Component, type ErrorInfo, type ReactNode } from "react";

/* ---------------------------------------------------------------------- */
/* Containment for the page's effect layers                                */
/* ---------------------------------------------------------------------- */

/* Every chapter on this page has at least one WebGL layer in it — two models,
 * a fibre-optic tunnel, a shatter pass, the fog curtain — and all of them are
 * decoration. None of them is allowed to be the reason the page is blank.
 *
 * Which is exactly what happened without this. React unmounts the whole tree
 * when an error escapes a render or an effect, and there was no boundary above
 * any of it, so a browser that refuses a WebGL context took the entire page
 * with it: three.js throws "Error creating WebGL context" from its constructor
 * and ogl dereferences a null context one line later. Reproduced by stubbing
 * `getContext('webgl2')` to return null — `#root` was left empty and the
 * document was one screen of flat background.
 *
 * That is not a hypothetical configuration. Hardware acceleration off, a
 * blocklisted driver, a GPU process that just crashed, remote desktop, and —
 * most likely of all here — a page that has simply run out of contexts, since
 * browsers cap how many live at once and evict the oldest to make room.
 *
 * So each layer gets wrapped and each one fails alone. `fallback` is for the
 * layers that wrap real content (the shatter pass wraps the Why chapter's
 * background): pass the unwrapped content and the chapter loses the effect
 * rather than the background.
 */
interface EffectBoundaryProps {
  children: ReactNode;
  /** Rendered instead of `children` once the layer has failed. */
  fallback?: ReactNode;
  /** Named in the console warning, so a failure is diagnosable. */
  label: string;
}

interface EffectBoundaryState {
  failed: boolean;
}

export default class EffectBoundary extends Component<
  EffectBoundaryProps,
  EffectBoundaryState
> {
  state: EffectBoundaryState = { failed: false };

  static getDerivedStateFromError(): EffectBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* Warn rather than error: this path is a degraded decoration, not a fault
       the reader needs to know about, and it should not read as a page failure
       in a monitoring tool either. */
    console.warn(
      `[${this.props.label}] effect layer disabled after an error:`,
      error,
      info.componentStack
    );
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
