/**
 * Hand-written theme lists for the daily word search.
 * Every word is 4–12 letters. A theme has enough words for the 25×25 Sunday grid.
 */
export type WordTheme = {
  id: string;
  title: string;
  words: readonly string[];
};

function theme(id: string, title: string, words: readonly string[]): WordTheme {
  const seen = new Set<string>();
  const cleaned = words.map((word) => {
    const upper = word.toUpperCase();
    if (!/^[A-Z]{4,12}$/.test(upper)) throw new Error(`${id} has a bad word: ${word}`);
    if (seen.has(upper)) throw new Error(`${id} repeats ${upper}`);
    seen.add(upper);
    return upper;
  });
  if (cleaned.length < 36) throw new Error(`${id} needs at least 36 words`);
  for (const word of cleaned) {
    for (const other of cleaned) {
      if (word !== other && other.includes(word)) {
        throw new Error(`${id}: ${word} is inside ${other}`);
      }
    }
  }
  return { id, title, words: cleaned };
}

export const WORD_THEMES: readonly WordTheme[] = [
  theme('woodland', 'Woodland', [
    'MOSS', 'FERN', 'BIRCH', 'CEDAR', 'PINES', 'FOXES', 'OWLET', 'DEER', 'BROOK', 'STONE',
    'ACORN', 'MAPLE', 'WILLOW', 'GROVE', 'CANOPY', 'LICHEN', 'SPORE', 'BADGER', 'HEDGE', 'RABBIT',
    'PATHS', 'GATES', 'DUSKY', 'DAWNS', 'MISTY', 'LEAVES', 'ROOTS', 'BARKS', 'NESTS', 'GLADE',
    'CLOVER', 'PEBBLE', 'OTTER', 'HERON', 'WRENS', 'ROBIN', 'THRUSH', 'BEETLE', 'MOTHS', 'STUMP',
    'TRAIL', 'MEADOW', 'HAZEL', 'ROWAN', 'ALDER', 'BRACKEN', 'THICKET', 'HOLLOW', 'LANTERN', 'FIREFLY',
  ]),
  theme('garden', 'Garden', [
    'SEED', 'SOIL', 'BLOOM', 'PETAL', 'TULIP', 'DAISY', 'LILAC', 'ROSES', 'HERBS', 'SAGE',
    'THYME', 'BASIL', 'MINTY', 'CHIVE', 'PEONY', 'DAHLIA', 'IRIS', 'POPPY', 'PANSY', 'VIOLA',
    'MULCH', 'SPADE', 'RAKES', 'HOSES', 'WATER', 'TRELLIS', 'ARBOR', 'BENCH', 'FENCE', 'SHEDS',
    'POTS', 'NECTAR', 'POLLEN', 'HONEY', 'LADYBUG', 'SNAIL', 'WORMS', 'COMPOST', 'SHOVEL', 'GLOVES',
    'BONNET', 'SUNDIAL', 'FOUNTAIN', 'GAZEBO', 'LAWNS', 'BLOSSOM', 'PLANTER', 'GERANIUM', 'BUDS', 'SPRIG',
  ]),
  theme('weather', 'Weather', [
    'RAINDROP', 'WINDY', 'CLOUD', 'STORM', 'GALES', 'BREEZE', 'DRIZZLE', 'SHOWER', 'SUNNY', 'FROST',
    'SNOW', 'HAIL', 'MISTS', 'FOGGY', 'DEWY', 'HUMID', 'CLEAR', 'HAZES', 'AURORA', 'STARS',
    'MOONS', 'COMET', 'PLANET', 'ORBIT', 'NOONS', 'TWILIGHT', 'RAINBOW', 'THUNDER', 'CUMULUS', 'NIMBUS',
    'ZEPHYR', 'SQUALL', 'FLURRY', 'ICICLE', 'SLEET', 'PUDDLE', 'RIPPLE', 'SPRINKLE', 'OVERCAST', 'SUNBEAM',
    'CHILLY', 'MILDER', 'GUSTY', 'CALMS', 'HORIZON', 'DAYLIGHT', 'STARLIT', 'MOONBEAM', 'SKYLARK', 'CIRRUS',
  ]),
  theme('kitchen', 'Kitchen', [
    'BREAD', 'FLOUR', 'YEAST', 'OVENS', 'STEWS', 'SOUPS', 'BROTH', 'APPLE', 'PEARS', 'PLUMS',
    'BERRY', 'HONEY', 'OATS', 'RICE', 'BEANS', 'LENTIL', 'CARROT', 'ONION', 'GARLIC', 'POTATO',
    'TURNIP', 'CELERY', 'LEMON', 'OLIVE', 'PEACH', 'MELON', 'GRAIN', 'BUTTER', 'CREAM', 'SUGAR',
    'SALTY', 'PEPPER', 'CINNAMON', 'NUTMEG', 'VANILLA', 'KETTLE', 'LADLE', 'SPOON', 'PLATE', 'BOWLS',
    'MUGS', 'TEAPOT',     'PICNIC', 'BASKET', 'NAPKIN', 'RECIPE', 'PASTRY', 'BISCUIT', 'WAFFLE', 'MUFFIN',
  ]),
];
