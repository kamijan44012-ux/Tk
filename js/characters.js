/* ============================================================
   ROSTER — fighter archetypes.
   All share the same rigged human model but differ by colour tint,
   body scale (silhouette) and tuned stats (speed/power/defense).
   ============================================================ */
export const ROSTER = [
  {
    id: 'blaze', name: 'BLAZE', style: 'Balanced',
    colors: { suit: 0xff3b5c, trim: 0xffcf4d },
    bodyScale: 1.0,
    stats: { speed: 4.6, jump: 7.4, power: 1.0, defense: 1.0 }
  },
  {
    id: 'frost', name: 'FROST', style: 'Speedster',
    colors: { suit: 0x2ee6d6, trim: 0xffffff },
    bodyScale: 0.94,
    stats: { speed: 5.6, jump: 8.2, power: 0.85, defense: 0.9 }
  },
  {
    id: 'titan', name: 'TITAN', style: 'Powerhouse',
    colors: { suit: 0x6b7bff, trim: 0x2a2f4a },
    bodyScale: 1.12,
    stats: { speed: 3.9, jump: 6.4, power: 1.3, defense: 1.25 }
  },
  {
    id: 'viper', name: 'VIPER', style: 'Technical',
    colors: { suit: 0x9b3fc8, trim: 0xb46bff },
    bodyScale: 1.0,
    stats: { speed: 5.0, jump: 7.8, power: 1.05, defense: 0.95 }
  }
];

export function getCharacter(id) {
  return ROSTER.find(c => c.id === id) || ROSTER[0];
}
