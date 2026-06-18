/* ============================================================
   ROSTER — fighter archetypes.
   Each has distinct colours and tuned stats so match-ups feel
   different (speed vs power vs balance).
   ============================================================ */
export const ROSTER = [
  {
    id: 'blaze', name: 'BLAZE', style: 'Balanced',
    colors: { skin: 0xe6a16b, suit: 0xff3b5c, trim: 0xffcf4d, hair: 0x2a1810 },
    stats: { speed: 4.6, jump: 7.2, power: 1.0, defense: 1.0 }
  },
  {
    id: 'frost', name: 'FROST', style: 'Speedster',
    colors: { skin: 0xcfd6e6, suit: 0x2ee6d6, trim: 0xffffff, hair: 0x123b4a },
    stats: { speed: 5.6, jump: 8.0, power: 0.85, defense: 0.9 }
  },
  {
    id: 'titan', name: 'TITAN', style: 'Powerhouse',
    colors: { skin: 0x8a6b50, suit: 0x6b7bff, trim: 0x2a2f4a, hair: 0x101018 },
    stats: { speed: 3.8, jump: 6.2, power: 1.3, defense: 1.25 }
  },
  {
    id: 'viper', name: 'VIPER', style: 'Technical',
    colors: { skin: 0x9fae7a, suit: 0x7f3fc8, trim: 0xb46bff, hair: 0x1a1a1a },
    stats: { speed: 5.0, jump: 7.6, power: 1.05, defense: 0.95 }
  }
];

export function getCharacter(id) {
  return ROSTER.find(c => c.id === id) || ROSTER[0];
}
