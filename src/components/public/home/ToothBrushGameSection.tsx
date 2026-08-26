import ToothBrushGameClient from "./ToothBrushGameClient";
import Reveal from "../motion/Reveal";

export default function ToothBrushGameSection() {
  return (
    <section className="py-20 max-w-4xl mx-auto px-4">
      <Reveal>
        <ToothBrushGameClient />
      </Reveal>
    </section>
  );
}
