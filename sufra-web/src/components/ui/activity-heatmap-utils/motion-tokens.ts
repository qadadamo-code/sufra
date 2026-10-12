// Motion tokens for ActivityHeatmap (not provided in the paste — written from the spec).
export const ease = {
  enter: [0.16, 1, 0.3, 1] as const,
  standard: [0.22, 1, 0.36, 1] as const,
};
export const blur = { soft: 4, subtle: 2 } as const;
export const spring = {
  snappy: { type: "spring", stiffness: 500, damping: 38 } as const,
  morph: { type: "spring", stiffness: 300, damping: 32 } as const,
};
export const duration = { fast: 0.16 } as const;
