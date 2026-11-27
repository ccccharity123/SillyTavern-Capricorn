// Fixed artwork. Model content never supplies markup, paths or paint attributes.
// RC23: every object kind has its own drawing (no shared aliases).
const shapes = {
  clue: [
    ['M13 27a14 14 0 1 0 28 0a14 14 0 1 0 -28 0z', 'ct-svg-base'],
    ['M37 37l14 14', 'ct-svg-handle'],
    ['M20 22q4-6 10-6', 'ct-svg-detail'],
    ['M50 10l2 5 5 2-5 2-2 5-2-5-5-2 5-2z', 'ct-svg-reveal'],
  ],
  letter: [
    ['M8 24h48v27H8z M8 49l14-13m34 13L42 36', 'ct-svg-base'],
    ['M19 27V11h26v21H19z M24 16h16m-16 6h12', 'ct-svg-reveal'],
    ['M8 24l24 17 24-17', 'ct-svg-flap'],
    ['M28 36h8v7h-8z', 'ct-svg-seal'],
  ],
  note: [
    ['M14 16l34-5 5 34-34 5z', 'ct-svg-base'],
    ['M24 9l14-2 1 7-14 2z', 'ct-svg-seal'],
    ['M21 26l24-4m-23 11 24-4m-23 11 15-2', 'ct-svg-reveal'],
  ],
  diary: [
    ['M15 9h29a5 5 0 0 1 5 5v37a3 3 0 0 1-3 3H15z', 'ct-svg-base'],
    ['M21 9v45', 'ct-svg-detail'],
    ['M27 21h15m-15 6h11', 'ct-svg-detail'],
    ['M43 30h11v10H43z', 'ct-svg-seal'],
    ['M33 54v7l3-2 3 2v-7', 'ct-svg-detail'],
  ],
  album: [
    ['M9 12h46v40H9z', 'ct-svg-base'],
    ['M14 12v40', 'ct-svg-detail'],
    ['M21 19h28v24H21z', 'ct-svg-page'],
    ['M21 43l8-10 6 6 4-4 10 8', 'ct-svg-detail'],
    ['M41 25a3 3 0 1 0 6 0a3 3 0 1 0-6 0z', 'ct-svg-detail'],
    ['M21 23l4-4m24 4-4-4M21 39l4 4m24-4-4 4', 'ct-svg-detail'],
  ],
  dossier: [
    ['M17 12h24v12H17z', 'ct-svg-reveal'],
    ['M8 18h17l4 5h27v29H8z', 'ct-svg-base'],
    ['M8 27h48', 'ct-svg-detail'],
    ['M32 36a3 3 0 1 0 6 0a3 3 0 1 0-6 0z M32 45a3 3 0 1 0 6 0a3 3 0 1 0-6 0z', 'ct-svg-detail'],
    ['M38 36c7 1 6 6 0 9', 'ct-svg-seal'],
    ['M14 46h10', 'ct-svg-detail'],
  ],
  collection: [
    ['M16 12h12v20H16z M30 9h12v23H30z M44 14h6v18h-6z', 'ct-svg-reveal'],
    ['M9 26h46v26H9z', 'ct-svg-base'],
    ['M9 32h46', 'ct-svg-detail'],
    ['M26 41h12', 'ct-svg-detail'],
  ],
  drawer: [
    ['M9 15h46v35H9z M12 20h40v13H12z M12 36h40v11H12z M26 42h12', 'ct-svg-base'],
    ['M12 22h40v11H12z M27 28h10', 'ct-svg-drawer'],
    ['M23 23l6-6 9 1 3 8z', 'ct-svg-reveal'],
  ],
  gift: [
    ['M13 27h38v24H13z M30 27v24m4-24v24', 'ct-svg-base'],
    ['M32 19c-15 0-17-11-8-10 4 1 7 6 8 10zm0 0c15 0 17-11 8-10-4 1-7 6-8 10z M9 19h46v11H9z', 'ct-svg-drawer'],
    ['M25 39l7-6 7 6-7 5z', 'ct-svg-reveal'],
    ['M29 28h6v6h-6z', 'ct-svg-seal'],
  ],
  lock: [
    ['M22 30v-8a10 10 0 0 1 20 0v8', 'ct-svg-shackle'],
    ['M15 29h34v25H15z', 'ct-svg-base'],
    ['M32 37a3 3 0 1 0 0.1 0z M32 40v7', 'ct-svg-detail'],
  ],
  use: [
    ['M22 8h20v48H22z', 'ct-svg-base'],
    ['M32 20a5 5 0 1 0 0.1 0z', 'ct-svg-detail'],
    ['M30 25l-3 11h10l-3-11', 'ct-svg-detail'],
    ['M37 30h18m-5 0v6m4-6v4 M55 26a4 4 0 1 1 0 8', 'ct-svg-key'],
  ],
  slot: [
    ['M9 12h46v40H9z M17 19h30v26H17z M26 31h12v4H26z', 'ct-svg-base'],
    ['M24 25h16v15H24z', 'ct-svg-lock'],
    ['M32 15v7m0 22v6m-16-18h6m20 0h6', 'ct-svg-rays'],
  ],
  combine: [
    ['M9 30l12-12 11 12-11 12z M32 30l11-12 12 12-12 12z', 'ct-svg-base'],
    ['M21 30l11-11 11 11-11 11z', 'ct-svg-light'],
  ],
  puzzle: [
    ['M12 16h12a5 5 0 0 1 10 0h12v12a5 5 0 0 1 0 10v12H34a5 5 0 0 0-10 0H12V38a5 5 0 0 0 0-10z', 'ct-svg-base'],
    ['M46 28a5 5 0 0 1 0 10', 'ct-svg-light'],
  ],
  wheel: [
    ['M13 32a19 19 0 1138 0 19 19 0 01-38 0z M32 13v38M13 32h38M19 19l26 26m0-26L19 45', 'ct-svg-wheel'],
    ['M27 8h10l-5 10z', 'ct-svg-flap'],
  ],
  recorder: [
    ['M7 15h50v34H7z', 'ct-svg-base'],
    ['M17 22h30v14H17z', 'ct-svg-detail'],
    ['M20 29a4 4 0 1 0 8 0a4 4 0 1 0-8 0z M36 29a4 4 0 1 0 8 0a4 4 0 1 0-8 0z', 'ct-svg-wheel'],
    ['M28 29h8', 'ct-svg-detail'],
    ['M18 49l4-7h20l4 7', 'ct-svg-detail'],
  ],
  lever: [
    ['M10 50h44l-5-9H15z M18 39a14 14 0 0128 0', 'ct-svg-base'],
    ['M32 39l-9-23 M18 15a4 4 0 118 0 4 4 0 01-8 0', 'ct-svg-lever'],
  ],
  lamp: [
    ['M21 35a15 15 0 1122 0l-4 7v7H25v-7z M27 54h10', 'ct-svg-light'],
    ['M32 3v5m19 3-4 6m10 8-6 2M13 11l4 6M6 25l7 2', 'ct-svg-rays'],
    ['M31 19l5 3-7 5 7 2-3 5', 'ct-svg-anomaly'],
  ],
};
const ns = 'http://www.w3.org/2000/svg';

export function propArt(parent, kind) {
  const doc = parent.ownerDocument;
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'ct-prop-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.dataset.art = kind;
  for (const [path, className] of shapes[kind] ?? shapes.clue) {
    const figure = doc.createElementNS(ns, 'path');
    figure.setAttribute('d', path);
    figure.setAttribute('class', className);
    svg.append(figure);
  }
  return svg;
}
