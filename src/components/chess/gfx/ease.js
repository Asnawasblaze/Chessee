export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));

export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const easeInCubic = (t) => t * t * t;

export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Slight overshoot, used when a piece lands on its square. */
export const easeOutBack = (t, overshoot = 1.7) => {
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
};

/** Damped spring settle, for the little bounce after a capture. */
export const easeOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/** Frame-rate independent exponential smoothing. */
export const damp = (current, target, lambda, dt) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

export const lerp = (a, b, t) => a + (b - a) * t;
