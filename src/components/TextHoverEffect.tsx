import { useEffect, useId, useRef } from "react";
import gsap from "gsap";
import "./TextHoverEffect.css";

/* ---------------------------------------------------------------------- */
/* TextHoverEffect — a wordmark drawn in outline, revealed by the cursor   */
/* ---------------------------------------------------------------------- */

/* Four stacked copies of the same <text>:
 *   1. a static outline at low opacity, so the word reads as a background
 *      mark even when nobody is pointing at it,
 *   2. the same outline with a stroke-dash draw-on, played once when the
 *      block scrolls into view,
 *   3. a thick, blurred, gradient-stroked copy — the bloom,
 *   4. the same gradient stroked sharp on top of its own bloom.
 * Both of the last two are clipped by a radial gradient that chases the
 * pointer, so the colour only exists where the cursor is.
 *
 * The gradient repeats and slides sideways forever while the pointer is in
 * the section, which is what makes the mark cycle hues instead of sitting on
 * one. Ported off framer-motion: attributes are tweened with GSAP's attr
 * plugin (in core) and hover state is a class toggle rather than React state,
 * so a pointermove never re-renders the tree. */

interface TextHoverEffectProps {
  text: string;
  /** Element whose pointer decides the reveal. Lets the effect sit inside a
   *  pointer-events:none background layer while still tracking a whole
   *  section. Defaults to the svg itself. */
  targetRef?: React.RefObject<HTMLElement | null>;
  /** Seconds the mask takes to catch up with the pointer. */
  duration?: number;
  /** Seconds for one full pass of the colour cycle. */
  cycle?: number;
  className?: string;
  /** Play the stroke draw-on once the svg enters the viewport. */
  drawOnReveal?: boolean;
}

/* One period of the colour ramp, in user units. The gradient is set to repeat,
   so sliding it by exactly this much loops seamlessly — which also means the
   first and last stop have to be the same colour. */
const RAMP = 200;

export default function TextHoverEffect({
  text,
  targetRef,
  duration = 0.4,
  /* Slow. The temperature shift should be something you notice only if you
     keep the cursor still, not a colour cycle you can watch. */
  cycle = 14,
  className,
  drawOnReveal = true,
}: TextHoverEffectProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const maskRef = useRef<SVGRadialGradientElement>(null);
  const rampRef = useRef<SVGLinearGradientElement>(null);
  const drawRef = useRef<SVGTextElement>(null);

  /* useId keeps the gradient/mask/filter ids unique if the effect is used
     twice on one page — SVG refs are document-global. Colons are legal in ids
     but not inside a url() reference, so strip them. */
  const uid = useId().replace(/:/g, "");
  const rampId = `the-${uid}-ramp`;
  const revealId = `the-${uid}-reveal`;
  const maskId = `the-${uid}-mask`;
  const bloomId = `the-${uid}-bloom`;

  /* Pointer tracking + the colour cycle. */
  useEffect(() => {
    const svg = svgRef.current;
    const mask = maskRef.current;
    const ramp = rampRef.current;
    if (!svg || !mask || !ramp) return;

    const target: HTMLElement | SVGSVGElement = targetRef?.current ?? svg;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;

    /* Built paused: the hue cycle only costs anything while somebody is
       actually looking at colour, and reduced-motion never starts it. */
    const hues = reduced
      ? null
      : gsap.fromTo(
          ramp,
          { attr: { x1: 0, x2: RAMP } },
          {
            attr: { x1: RAMP, x2: RAMP * 2 },
            duration: cycle,
            ease: "none",
            repeat: -1,
            paused: true,
          },
        );

    /* Typed as Event so the listener stays assignable across the
       HTMLElement | SVGSVGElement union of possible targets. */
    const move = (event: Event) => {
      const { clientX, clientY } = event as PointerEvent;

      /* Read the rect per event rather than caching it: the footer sits at the
         end of a smooth-scrolled page, so its box moves under the cursor. */
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const cx = ((clientX - rect.left) / rect.width) * 100;
      const cy = ((clientY - rect.top) / rect.height) * 100;

      gsap.to(mask, {
        attr: { cx: `${cx}%`, cy: `${cy}%` },
        duration: reduced ? 0 : duration,
        ease: "power2.out",
        overwrite: true,
      });
    };

    const enter = () => {
      svg.classList.add("is-lit");
      hues?.play();
    };

    const leave = () => {
      svg.classList.remove("is-lit");
      /* Let the fade-out finish before the cycle stops, or the colours freeze
         mid-dissolve and the exit reads as a stall. */
      hues?.pause();
    };

    /* pointer* rather than mouse*: on a touch device the reveal follows a drag
       and then fades out, instead of latching on to wherever the tap landed. */
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerenter", enter);
    target.addEventListener("pointerleave", leave);
    target.addEventListener("pointercancel", leave);

    return () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerenter", enter);
      target.removeEventListener("pointerleave", leave);
      target.removeEventListener("pointercancel", leave);
      hues?.kill();
      gsap.killTweensOf(mask);
    };
  }, [cycle, duration, targetRef]);

  /* Draw-on, once, when the word is actually on screen. */
  useEffect(() => {
    const svg = svgRef.current;
    const draw = drawRef.current;
    if (!svg || !draw || !drawOnReveal) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw.style.strokeDashoffset = "0";
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        gsap.to(draw, {
          strokeDashoffset: 0,
          duration: 3.4,
          ease: "power1.inOut",
        });
      },
      { threshold: 0.2 },
    );

    observer.observe(svg);
    return () => {
      observer.disconnect();
      gsap.killTweensOf(draw);
    };
  }, [drawOnReveal]);

  /* An explicit baseline instead of dominant-baseline:middle. The viewBox is a
     tight band (see the 0 0 300 46 below) so the svg can be sized by width
     alone and the word always fills it — but a middle baseline centres the em
     box, which on an all-caps mark leaves the letters riding high above an
     empty descender zone. y=42 puts Cinzel's cap height 3 units under the
     band's ceiling and the baseline 4 above its floor. */
  const textProps = {
    x: "50%",
    y: 42,
    textAnchor: "middle" as const,
  };

  return (
    <svg
      ref={svgRef}
      className={`the-svg${className ? ` ${className}` : ""}`}
      viewBox="0 0 300 46"
      preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* Six stops plus a repeat of the first, so the ramp can tile. Held
            inside one narrow band — the page's cyan, cooled to steel and warmed
            to champagne and back — rather than run around the wheel. A full
            spectrum on a wordmark reads as a light show; a metal shifting
            temperature under a moving light reads as the mark itself. */}
        <linearGradient
          ref={rampRef}
          id={rampId}
          gradientUnits="userSpaceOnUse"
          spreadMethod="repeat"
          x1="0"
          y1="0"
          x2={RAMP}
          y2="0"
        >
          <stop offset="0%" stopColor="#7fc4dc" />
          <stop offset="17%" stopColor="#a8d6e6" />
          <stop offset="34%" stopColor="#cfe0e6" />
          <stop offset="50%" stopColor="#d8cdb4" />
          <stop offset="67%" stopColor="#a9bfc9" />
          <stop offset="84%" stopColor="#89c2d8" />
          <stop offset="100%" stopColor="#7fc4dc" />
        </linearGradient>

        <radialGradient
          ref={maskRef}
          id={revealId}
          gradientUnits="userSpaceOnUse"
          r="24%"
          cx="50%"
          cy="50%"
        >
          {/* Three stops rather than two: a linear ramp from white to black
              puts half the reveal's radius at better than 50% opacity, which
              is what made the lit area read as a blown-out patch. Pulling the
              midpoint down to 0.35 gives the pool a soft shoulder and a long
              tail — a light falling on the letters instead of a spotlight. */}
          <stop offset="0%" stopColor="white" />
          <stop offset="45%" stopColor="#595959" />
          <stop offset="100%" stopColor="black" />
        </radialGradient>

        <mask id={maskId}>
          <rect x="0" y="0" width="100%" height="100%" fill={`url(#${revealId})`} />
        </mask>

        {/* Bloom. One blur, doubled rather than tripled: stacking the same
            semi-transparent result compounds its alpha, and three passes drove
            the halo to the point where it clipped to white and the letters
            disappeared inside their own light. Two keeps the falloff visible.
            sRGB interpolation holds the tint; linearRGB washes it out. */}
        <filter
          id={bloomId}
          x="-12%"
          y="-60%"
          width="124%"
          height="220%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1.9" result="halo" />
          <feMerge>
            <feMergeNode in="halo" />
            <feMergeNode in="halo" />
          </feMerge>
        </filter>
      </defs>

      {/* 1 — resting outline */}
      <text {...textProps} className="the-text the-text--rest">
        {text}
      </text>

      {/* 2 — draw-on outline */}
      <text {...textProps} ref={drawRef} className="the-text the-text--draw">
        {text}
      </text>

      {/* 3 — bloom, clipped to the pointer */}
      <text
        {...textProps}
        className="the-text the-text--bloom"
        stroke={`url(#${rampId})`}
        mask={`url(#${maskId})`}
        filter={`url(#${bloomId})`}
      >
        {text}
      </text>

      {/* 4 — sharp lit copy, same clip */}
      <text
        {...textProps}
        className="the-text the-text--lit"
        stroke={`url(#${rampId})`}
        mask={`url(#${maskId})`}
      >
        {text}
      </text>
    </svg>
  );
}
