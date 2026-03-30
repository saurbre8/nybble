/**
 * CritterState — stat model, decay logic, and mood derivation.
 *
 * All four stats run 0–100. Decay rates are per-hour targets; the
 * extension applies them on a per-minute tick so behaviour is smooth
 * even when VS Code is left open for a long time.
 */

export interface CritterState {
    name: string;
    species: string;

    // Core stats (0–100, higher is better)
    hunger: number;      // 0 = starving, 100 = full
    happiness: number;   // 0 = miserable, 100 = ecstatic
    energy: number;      // 0 = exhausted, 100 = fully rested
    cleanliness: number; // 0 = filthy, 100 = squeaky clean

    // Progression
    xp: number;
    level: number;

    // Timestamps (ms since epoch)
    lastUpdated: number;
    createdAt: number;

    // Has the critter been hatched yet?
    hatched: boolean;
}

export type CritterMood =
    | 'ecstatic'
    | 'happy'
    | 'content'
    | 'sad'
    | 'hungry'
    | 'tired'
    | 'dirty'
    | 'miserable'
    | 'sleeping';

/** Decay amounts per hour for each decay rate setting. */
const DECAY_RATES: Record<string, Record<string, number>> = {
    slow: {
        hunger:      1.5,
        happiness:   1.0,
        energy:      0.5,
        cleanliness: 0.8,
    },
    normal: {
        hunger:      3.0,
        happiness:   2.0,
        energy:      1.0,
        cleanliness: 1.5,
    },
    fast: {
        hunger:      6.0,
        happiness:   4.0,
        energy:      2.0,
        cleanliness: 3.0,
    },
};

/** XP required to reach each level (index = level). */
export const XP_PER_LEVEL = [0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 5700, 7500];

export function createDefaultCritterState(name: string, species: string): CritterState {
    const now = Date.now();
    return {
        name,
        species,
        hunger: 80,
        happiness: 80,
        energy: 90,
        cleanliness: 100,
        xp: 0,
        level: 1,
        lastUpdated: now,
        createdAt: now,
        hatched: false,
    };
}

/**
 * Apply time-based stat decay.
 * Mutates a copy of state — does NOT mutate the original.
 */
export function applyDecay(state: CritterState, decayRate: string): CritterState {
    const now = Date.now();
    const elapsedHours = (now - state.lastUpdated) / (1000 * 60 * 60);

    if (elapsedHours <= 0) {
        return state;
    }

    const rates = DECAY_RATES[decayRate] ?? DECAY_RATES.normal;

    // Happiness falls faster when hunger is very low
    const hungerPenalty = state.hunger < 20 ? 2.0 : 1.0;

    const newHunger      = Math.max(0, state.hunger      - rates.hunger      * elapsedHours);
    const newHappiness   = Math.max(0, state.happiness   - rates.happiness   * elapsedHours * hungerPenalty);
    const newEnergy      = Math.max(0, state.energy      - rates.energy      * elapsedHours);
    const newCleanliness = Math.max(0, state.cleanliness - rates.cleanliness * elapsedHours);

    return {
        ...state,
        hunger:      newHunger,
        happiness:   newHappiness,
        energy:      newEnergy,
        cleanliness: newCleanliness,
        lastUpdated: now,
    };
}

/** Derive the critter's current mood from its stats. */
export function deriveMood(state: CritterState): CritterMood {
    const { hunger, happiness, energy, cleanliness } = state;

    if (energy < 15) { return 'sleeping'; }
    if (hunger < 15)  { return 'hungry'; }
    if (cleanliness < 20) { return 'dirty'; }

    const avg = (hunger + happiness + energy + cleanliness) / 4;
    if (avg >= 85) { return 'ecstatic'; }
    if (avg >= 65) { return 'happy'; }
    if (avg >= 45) { return 'content'; }
    if (happiness < 30) { return 'miserable'; }
    if (energy < 30)    { return 'tired'; }
    return 'sad';
}

/** Add XP and handle level-ups. Returns updated state. */
export function addXp(state: CritterState, amount: number): CritterState {
    const newXp = state.xp + amount;
    let level = state.level;
    while (level < XP_PER_LEVEL.length - 1 && newXp >= XP_PER_LEVEL[level]) {
        level++;
    }
    return { ...state, xp: newXp, level };
}

/** Mood-based dialogue lines shown in the critter's speech bubble. */
export const MOOD_DIALOGUE: Record<CritterMood, string[]> = {
    ecstatic:  ['This is the BEST day ever!!', 'I love you so much!', '*happy wiggle*'],
    happy:     ['Life is good!', 'Thanks for the snack~', 'Looking good today!'],
    content:   ['...', '*yawns*', 'Just chillin\''],
    sad:       ['I\'m a little lonely...', 'Could use some attention.', '*sighs*'],
    hungry:    ['My tummy is growling...', 'Feed me, please?', 'So... hungry...'],
    tired:     ['Need... nap...', '*heavy eyelids*', 'Zzz... wait, what?'],
    dirty:     ['I smell like a swamp.', 'Bath time pls?', '*scratches*'],
    miserable: ['Everything is terrible.', 'I don\'t feel good...', '*wimper*'],
    sleeping:  ['Zzz...', '...zzzz...', '*snores softly*'],
};
