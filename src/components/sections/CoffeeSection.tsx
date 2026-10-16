import { COFFEE_URL } from "../../config/site";
import Headline from "../textFx/Headline";
import PillButton from "../chrome/PillButton";
import "./sections.css";

export default function CoffeeSection() {
  return (
    <section className="coffee" aria-label="Support Chessee">
      <div className="coffee-card">
        <span className="fx-eyebrow fx-eyebrow--bright">Indie made</span>
        <Headline
          as="h2"
          tone="bright"
          className="fx-h1"
          lines={["Like the game?", "Fuel the dev."]}
          accent={["Fuel"]}
        />
        <p className="coffee-body fx-lead">
          Chessee is built by a tiny team. A coffee keeps the servers on and the bots getting meaner.
        </p>
        <PillButton href={COFFEE_URL} label="Buy me a coffee" variant="accent1" big external />
        <span className="coffee-steam" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </section>
  );
}
