// One line flower per room. 24×24, 1.25 stroke, drawn to sit beside 13px type.
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const petals = (n, rx, ry, dist) => Array.from({length: n}, (_, i) => {
  const a = (360 / n) * i;
  return `<ellipse cx="12" cy="${12 - dist}" rx="${rx}" ry="${ry}" transform="rotate(${a} 12 12)"/>`;
}).join('');

export const FLOWERS = {
  camellia: svg(`${petals(8, 2.4, 4.0, 3.2)}${petals(5, 1.5, 2.5, 1.6)}<circle cx="12" cy="12" r="1.1"/>`),
  // SALON — marguerite: many slim petals, an open face
  marguerite: svg(`${petals(10, 1.35, 3.6, 5.2)}<circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none"/>`),
  // ATELIER — iris: three standards up, two falls down, a straight stem
  iris: svg(`<path d="M12 4.2c-1.9 1.9-2.3 4.4-.0 6.8 2.3-2.4 1.9-4.9 0-6.8Z"/><path d="M11.4 9.8C9.6 7.6 6.6 7.5 5 8.6c1.3 2 3.9 3 6.4 2.2"/><path d="M12.6 9.8c1.8-2.2 4.8-2.3 6.4-1.2-1.3 2-3.9 3-6.4 2.2"/><path d="M11.2 11.3c-2.2.6-3.6 2.4-3.4 4.3 1.9-.3 3.2-1.8 3.6-3.4"/><path d="M12.8 11.3c2.2.6 3.6 2.4 3.4 4.3-1.9-.3-3.2-1.8-3.6-3.4"/><path d="M12 12.4V20.4"/>`),
  // NOCTURNE — moonflower: a round trumpet with folded star, a thin crescent above
  moonflower: svg(`<circle cx="12" cy="13.2" r="5.6"/><path d="M12 7.6v2.5M17.3 11.5l-2.3.8M15.3 17.9l-1.4-2M8.7 17.9l1.4-2M6.7 11.5l2.3.8"/><circle cx="12" cy="13.2" r="1.3"/><path d="M17.6 3.3a2.6 2.6 0 1 0 2.6 3.4 2.1 2.1 0 1 1-2.6-3.4Z"/>`),
  // ÉTUDE — forget-me-not: five round petals, a small ring at the heart (memory)
  myosotis: svg(`${petals(5, 2.55, 2.55, 3.55)}<circle cx="12" cy="12" r="1.15"/>`),
  // INFINI — the brand flower, alone, with a point of light
  fleur: svg(`${petals(5, 2.1, 3.1, 3.7)}<circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><path d="M12 15.8V21.2M12 18.6c1.4-.2 2.4-1 2.8-2.1"/>`),
};
