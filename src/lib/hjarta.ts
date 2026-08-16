/**
 * The shortlist heart.
 *
 * One definition shared by the server-rendered pages and the client-side list
 * rendering, so the outline never differs by a pixel between the first paint
 * and the first re-render.
 *
 * Filled versus empty is not encoded here: it comes from CSS keyed on the
 * button's aria-pressed, which means toggling a name never touches the DOM.
 */
/*
 * Drawn to stay inside the 24-unit box even once stroked: the extremes sit at
 * x=2 and x=22, y=3 and y=21.35, leaving room for the 1.7 stroke the CSS puts
 * on it without the outline being clipped at the edges.
 */
const PATH =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

/** For the save buttons: colour comes from the button state. */
export const HJARTA = `<svg class="hjarta" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${PATH}"/></svg>`;

/** For running prose, where it is always shown filled as an illustration. */
export const HJARTA_INLINE = `<svg class="hjarta-inline" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${PATH}"/></svg>`;
