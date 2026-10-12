import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";

/** Scroll-linked reveal: rises out of a soft blur once in view. */
export function Reveal({ children, delay = 0, className, y = 28 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Big display type whose words rise in sequence (the parent watches the viewport; words are clipped children). */
export function BigTitle({ text, className, as: Tag = "h2" }: { text: string; className?: string; as?: "h1" | "h2" }) {
  const reduced = useReducedMotion();
  const words = text.split(" ");
  const M = Tag === "h1" ? motion.h1 : motion.h2;
  return (
    <M className={className} initial={reduced ? false : "hidden"} whileInView="shown" viewport={{ once: true, margin: "0px 0px -5% 0px" }} transition={{ staggerChildren: 0.06 }}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((w, i) => (
          <span key={i} className="inline-block overflow-hidden pb-[0.12em] align-bottom">
            <motion.span className="inline-block" variants={{ hidden: { y: "110%" }, shown: { y: 0 } }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}>
              {w}
            </motion.span>
            {i < words.length - 1 ? "\u00a0" : null}
          </span>
        ))}
      </span>
    </M>
  );
}

/** Parallax strip: a row of images drifting sideways as the page scrolls (theplanetco-style). */
export function ParallaxStrip({ children, distance = 160, className }: { children: ReactNode; distance?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const x = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  return (
    <div ref={ref} className={className} style={{ overflow: "hidden" }}>
      <motion.div style={{ x: reduced ? 0 : x }} className="flex w-max gap-3" dir="ltr">
        {children}
      </motion.div>
    </div>
  );
}
