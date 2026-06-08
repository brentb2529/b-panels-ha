// Touch "ghost click" guard for the PIN pads.
//
// The pads register digits on `pointerdown` (instant kiosk response) and
// auto-submit at the 4th digit. When that submit closes the modal, the SAME tap
// still has a trailing synthesized `click` coming — which now lands on whatever
// element was revealed underneath (a dashboard tile/button), triggering it.
//
// Calling this the moment the 4th digit is entered arms a one-shot, capture-phase
// listener that eats exactly the next `click` (within a short window), so it can't
// fall through. Harmless for hardware-keyboard entry (no click fires; it self-cleans).
export const swallowNextClick = (): void => {
  if (typeof window === 'undefined') return;
  const eat = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener('click', eat, true);
    clearTimeout(timer);
  };
  const timer = window.setTimeout(cleanup, 700);
  window.addEventListener('click', eat, true);
};
