/**
 * Inventory — item definitions and resource management.
 *
 * Resources are earned through coding activity:
 *   Save a file        → Food
 *   Write lines        → XP, occasionally Coins
 *   Fix errors         → Treats
 *   Long sessions      → Habitat Items (milestone drops)
 */

// ---------------------------------------------------------------------------
// Item definitions
// ---------------------------------------------------------------------------

export type ItemCategory = 'food' | 'treat' | 'toy' | 'furniture' | 'cosmetic';

export interface ItemDefinition {
    id: string;
    name: string;
    description: string;
    category: ItemCategory;
    /** How much hunger this restores (0 if not food). */
    hungerRestore: number;
    /** How much happiness this restores. */
    happinessRestore: number;
    /** How much energy this restores. */
    energyRestore: number;
    /** How much cleanliness this restores. */
    cleanlinessRestore: number;
    /** Icon to show in the inventory list (emoji fallback). */
    icon: string;
}

export const ITEMS: Record<string, ItemDefinition> = {
    // ---- Food ----------------------------------------------------------------
    basic_food: {
        id: 'basic_food',
        name: 'Kibble',
        description: 'Standard critter food. Earned from saving files.',
        category: 'food',
        hungerRestore: 20,
        happinessRestore: 0,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '🍖',
    },
    mega_meal: {
        id: 'mega_meal',
        name: 'Mega Meal',
        description: 'A big feast. Rare drop from long coding sessions.',
        category: 'food',
        hungerRestore: 50,
        happinessRestore: 5,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '🍱',
    },
    snack: {
        id: 'snack',
        name: 'Snack',
        description: 'A small bite, good for bonding.',
        category: 'food',
        hungerRestore: 8,
        happinessRestore: 5,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '🍪',
    },

    // ---- Treats (earned from fixing errors) ----------------------------------
    treat: {
        id: 'treat',
        name: 'Treat',
        description: 'A special reward. Earned when you squash bugs.',
        category: 'treat',
        hungerRestore: 10,
        happinessRestore: 15,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '⭐',
    },

    // ---- Toys (used in play interactions) ------------------------------------
    ball: {
        id: 'ball',
        name: 'Rubber Ball',
        description: 'Throw it! The critter loves to chase.',
        category: 'toy',
        hungerRestore: 0,
        happinessRestore: 0,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '🔴',
    },

    // ---- Furniture (placed in habitat) ---------------------------------------
    bed: {
        id: 'bed',
        name: 'Cozy Bed',
        description: 'The critter sleeps here. Restores energy faster.',
        category: 'furniture',
        hungerRestore: 0,
        happinessRestore: 0,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '🛏️',
    },
    food_bowl: {
        id: 'food_bowl',
        name: 'Food Bowl',
        description: 'Required to feed your critter in the habitat.',
        category: 'furniture',
        hungerRestore: 0,
        happinessRestore: 0,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '🥣',
    },
    toy_box: {
        id: 'toy_box',
        name: 'Toy Box',
        description: 'Stores toys and boosts happiness passively.',
        category: 'furniture',
        hungerRestore: 0,
        happinessRestore: 0,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '📦',
    },
    plant: {
        id: 'plant',
        name: 'Plant',
        description: 'A nice plant. Purely decorative.',
        category: 'furniture',
        hungerRestore: 0,
        happinessRestore: 0,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '🪴',
    },
    window: {
        id: 'window',
        name: 'Window',
        description: 'Your critter loves looking outside.',
        category: 'furniture',
        hungerRestore: 0,
        happinessRestore: 0,
        energyRestore: 0,
        cleanlinessRestore: 0,
        icon: '🪟',
    },
};

// ---------------------------------------------------------------------------
// Inventory data structure
// ---------------------------------------------------------------------------

export interface InventorySlot {
    itemId: string;
    quantity: number;
}

export interface Inventory {
    slots: InventorySlot[];
    coins: number;
}

export function createDefaultInventory(): Inventory {
    return {
        slots: [
            { itemId: 'basic_food', quantity: 3 },
            { itemId: 'ball',       quantity: 1 },
        ],
        coins: 0,
    };
}

// ---------------------------------------------------------------------------
// Inventory helpers
// ---------------------------------------------------------------------------

export function getQuantity(inventory: Inventory, itemId: string): number {
    return inventory.slots.find((s) => s.itemId === itemId)?.quantity ?? 0;
}

export function addItem(inventory: Inventory, itemId: string, qty = 1): Inventory {
    const slots = inventory.slots.map((s) => ({ ...s }));
    const existing = slots.find((s) => s.itemId === itemId);
    if (existing) {
        existing.quantity += qty;
    } else {
        slots.push({ itemId, quantity: qty });
    }
    return { ...inventory, slots };
}

export function removeItem(inventory: Inventory, itemId: string, qty = 1): Inventory {
    const slots = inventory.slots
        .map((s) => s.itemId === itemId ? { ...s, quantity: s.quantity - qty } : { ...s })
        .filter((s) => s.quantity > 0);
    return { ...inventory, slots };
}

// ---------------------------------------------------------------------------
// Reward logic — what the player earns from coding events
// ---------------------------------------------------------------------------

export interface CodingReward {
    itemId: string;
    quantity: number;
    reason: string;
}

/** Called whenever the user saves a file. */
export function rewardForSave(): CodingReward {
    return { itemId: 'basic_food', quantity: 1, reason: 'You saved a file' };
}

/** Called when a batch of new lines have been written. */
export function rewardForLines(lineCount: number): CodingReward | null {
    // Every 50 lines earns a snack; every 200 lines earns a treat
    if (lineCount >= 200) {
        return { itemId: 'treat', quantity: 1, reason: `Wrote ${lineCount} lines` };
    }
    if (lineCount >= 50) {
        return { itemId: 'snack', quantity: 1, reason: `Wrote ${lineCount} lines` };
    }
    return null;
}

/** Called when diagnostics (errors/warnings) in a file drop to zero. */
export function rewardForFixingErrors(): CodingReward {
    return { itemId: 'treat', quantity: 1, reason: 'Fixed all errors in a file' };
}

/** Milestone drops for long sessions (pass total saves in session). */
export function milestoneReward(totalSaves: number): CodingReward | null {
    // At 10, 50, 100 saves — drop furniture or mega meal
    if (totalSaves === 10)  { return { itemId: 'snack',     quantity: 3,  reason: '10 saves milestone' }; }
    if (totalSaves === 50)  { return { itemId: 'mega_meal', quantity: 1,  reason: '50 saves milestone' }; }
    if (totalSaves === 100) { return { itemId: 'plant',     quantity: 1,  reason: '100 saves milestone' }; }
    if (totalSaves === 200) { return { itemId: 'toy_box',   quantity: 1,  reason: '200 saves milestone' }; }
    if (totalSaves === 500) { return { itemId: 'bed',       quantity: 1,  reason: '500 saves milestone' }; }
    return null;
}
