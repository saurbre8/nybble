/**
 * Habitat — 8×6 grid-based room the player furnishes with items.
 *
 * The grid is stored as a flat array (row-major order).
 * Each cell holds null (empty) or a placed item reference.
 *
 * Functional furniture effects (e.g. bed restores energy faster)
 * are derived at runtime from the placed items and applied by
 * critterState decay logic.
 */

export const HABITAT_COLS = 8;
export const HABITAT_ROWS = 6;
export const HABITAT_SIZE = HABITAT_COLS * HABITAT_ROWS; // 48 cells

export interface PlacedItem {
    itemId: string;
    /** Display label shown on hover in the webview. */
    label: string;
}

export type HabitatCell = PlacedItem | null;

/** Flat array, index = row * COLS + col. */
export type HabitatGrid = HabitatCell[];

export function createEmptyHabitat(): HabitatGrid {
    return new Array(HABITAT_SIZE).fill(null);
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

export function cellIndex(col: number, row: number): number {
    return row * HABITAT_COLS + col;
}

export function cellCoords(index: number): { col: number; row: number } {
    return {
        col: index % HABITAT_COLS,
        row: Math.floor(index / HABITAT_COLS),
    };
}

export function getCell(grid: HabitatGrid, col: number, row: number): HabitatCell {
    return grid[cellIndex(col, row)] ?? null;
}

export function placeItem(
    grid: HabitatGrid,
    col: number,
    row: number,
    item: PlacedItem,
): HabitatGrid {
    const next = [...grid];
    next[cellIndex(col, row)] = item;
    return next;
}

export function removeItem(
    grid: HabitatGrid,
    col: number,
    row: number,
): HabitatGrid {
    const next = [...grid];
    next[cellIndex(col, row)] = null;
    return next;
}

/** Returns all placed items (with their coordinates). */
export function listPlacedItems(
    grid: HabitatGrid,
): Array<PlacedItem & { col: number; row: number }> {
    const result: Array<PlacedItem & { col: number; row: number }> = [];
    for (let i = 0; i < grid.length; i++) {
        const cell = grid[i];
        if (cell !== null) {
            result.push({ ...cell, ...cellCoords(i) });
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Functional furniture effects
// Applied by the decay logic in critterState.ts as passive multipliers.
// ---------------------------------------------------------------------------

export interface HabitatEffects {
    /** Energy decay is multiplied by this (< 1 means slower decay). */
    energyDecayMultiplier: number;
    /** Happiness decay is multiplied by this. */
    happinessDecayMultiplier: number;
}

export function computeHabitatEffects(grid: HabitatGrid): HabitatEffects {
    const placed = listPlacedItems(grid).map((p) => p.itemId);
    let energyMulti = 1.0;
    let happinessMulti = 1.0;

    if (placed.includes('bed'))      { energyMulti     *= 0.5; }  // Bed halves energy decay
    if (placed.includes('toy_box'))  { happinessMulti  *= 0.7; }  // Toy box slows happiness decay
    if (placed.includes('plant'))    { happinessMulti  *= 0.9; }  // Plant helps a little
    if (placed.includes('window'))   { happinessMulti  *= 0.85; } // Window helps more

    return {
        energyDecayMultiplier: energyMulti,
        happinessDecayMultiplier: happinessMulti,
    };
}
