import { useReducedMotion, type Transition } from "motion/react";

/** Shared motion vocabulary: quick, springy, never bouncy enough to feel toy-like. */
export const spring = {
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as Transition,
  soft: { type: "spring", stiffness: 300, damping: 32 } as Transition,
  sheet: { type: "spring", stiffness: 380, damping: 40 } as Transition,
  layout: { type: "spring", stiffness: 420, damping: 36 } as Transition,
};
export const fade = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as Transition;

/** Transition that collapses to instant when the user asked for reduced motion. */
export function useTransition(t: Transition = spring.snappy): Transition {
  return useReducedMotion() ? { duration: 0 } : t;
}

export function useReduced() {
  return !!useReducedMotion();
}
