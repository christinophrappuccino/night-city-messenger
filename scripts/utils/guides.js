/**
 * The PDF guides that ship in docs/ (built by dev/tools/build-guide.cjs).
 */
const GUIDES = Object.freeze({
  gm: 'modules/night-city-messenger/docs/NCM-Getting-Started.pdf',
  player: 'modules/night-city-messenger/docs/NCM-Player-Guide.pdf',
});

/** Open a guide in a new browser tab. @param {'gm'|'player'} kind */
export function openGuide(kind) {
  const path = GUIDES[kind];
  if (!path) return;
  const route = (typeof foundry !== 'undefined' && foundry.utils?.getRoute) ? foundry.utils.getRoute(path) : `/${path}`;
  window.open(route, '_blank', 'noopener');
}
