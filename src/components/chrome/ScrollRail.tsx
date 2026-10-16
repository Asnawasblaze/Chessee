import { useRef, useState } from "react";
import { ScrollTrigger, useGSAP } from "../textFx/scramble";
import ScrambleText from "../textFx/ScrambleText";
import "./chrome.css";

/* Left-edge progress line plus a live chapter readout. Chapters are any
   element carrying data-chapter="Name"; the active one is whichever top edge
   last crossed the middle of the viewport. */
export default function ScrollRail() {
  const bar = useRef<HTMLDivElement>(null);
  const [chapter, setChapter] = useState("Intro");
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(0);
  const last = useRef("");

  useGSAP(() => {
    const st = ScrollTrigger.create({
      start: 0,
      end: "max",
      onUpdate: (self) => {
        if (bar.current) bar.current.style.transform = `scaleY(${self.progress})`;
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>("[data-chapter]"),
        );
        let active = -1;
        nodes.forEach((n, i) => {
          if (n.getBoundingClientRect().top <= window.innerHeight * 0.5) active = i;
        });
        const name = active >= 0 ? (nodes[active].dataset.chapter ?? "") : "Intro";
        if (name !== last.current) {
          last.current = name;
          setChapter(name);
          setIndex(Math.max(active, 0) + 1);
          setTotal(nodes.length);
        }
      },
    });
    return () => st.kill();
  });

  return (
    <aside className="rail" aria-hidden="true">
      <div className="rail-track">
        <div ref={bar} className="rail-bar" />
      </div>
      <div className="rail-text">
        <span className="rail-count">
          {String(index).padStart(2, "0")}/{String(total).padStart(2, "0")}
        </span>
        <ScrambleText key={chapter} text={chapter} hover={false} onView={false} className="rail-name" />
      </div>
    </aside>
  );
}
