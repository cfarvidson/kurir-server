/**
 * Shared mutable flag for multi-key sequences (e.g. g+i go-to navigation).
 * When true, other keyboard handlers should ignore the current keypress
 * because it's the second key of a pending sequence.
 */
export const keyboardState = {
  /** True when waiting for the second key of a g+X sequence */
  gSequenceActive: false,
};
