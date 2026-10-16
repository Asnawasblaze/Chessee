"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createClouds,
  supportsHtmlInCanvas,
  type CloudsInstance,
  type CloudsOptions,
} from "./cloudsEngine";

export interface CloudsProps extends CloudsOptions {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Freezes the render loop while keeping the GL context, compiled
   * shaders and textures alive, instead of unmounting the component. Use
   * this for a layer that's only visible/relevant for part of the page —
   * unmounting/remounting `<Clouds>` recreates the WebGL context and
   * recompiles every shader from scratch, which is cheap once but shows up
   * as a visible stutter/pop-in the moment the layer needs to reappear. */
  paused?: boolean;
}

const emptySubscribe = () => () => {};

export function Clouds({
  children,
  className,
  style,
  paused = false,
  ...options
}: CloudsProps) {
  const sourceRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLCanvasElement>(null);
  const instanceRef = useRef<CloudsInstance | null>(null);
  const [initialOptions] = useState(options);
  const [failed, setFailed] = useState(false);

  const supported = useSyncExternalStore(
    emptySubscribe,
    supportsHtmlInCanvas,
    () => false,
  );
  const native = supported && !failed;

  useEffect(() => {
    const source = sourceRef.current;
    const content = contentRef.current;
    const output = outputRef.current;
    if (!source || !content || !output) return;
    instanceRef.current = createClouds(
      { source, content, output },
      initialOptions,
    );
    if (native && !instanceRef.current) setFailed(true);
    if (instanceRef.current && paused) instanceRef.current.setPaused(true);
    return () => {
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOptions, native]);

  useEffect(() => {
    instanceRef.current?.setPaused(paused);
  }, [paused]);

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
              overflow: "auto",
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
            overflow: "auto",
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

export default Clouds;
