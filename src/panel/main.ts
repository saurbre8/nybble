/**
 * Nybble webview — main entry point.
 *
 * Bundled by webpack → media/main-bundle.js and run inside the VS Code webview.
 *
 * Responsibilities:
 *  - Render the single emoji critter and drive its animation via the existing
 *    BasePetType state machine.
 *  - Maintain the stat-bar overlay and inventory panel (DOM, not canvas).
 *  - Bridge messages between the VS Code extension and the webview UI.
 */
import {
    PetSize,
    PetColor,
    PetType,
    Theme,
    ColorThemeKind,
    WebviewMessage,
} from '../common/types';
import { IPetType } from './states';
import { PetCollection, PetElement, IPetCollection } from './pets';
import { PetElementState, PetPanelState } from './states';
import { THEMES } from './themes';
import {
    dynamicThrowOff,
    dynamicThrowOn,
    setupBallThrowing,
    throwAndChase,
} from './ball';
import { EmojiCritter } from './pets/critter';

// ── Canvas IDs ──────────────────────────────────────────────────────────────

const PET_CANVAS_ID                = 'ballCanvas';
const FOREGROUND_EFFECT_CANVAS_ID  = 'foregroundEffectCanvas';
const BACKGROUND_EFFECT_CANVAS_ID  = 'backgroundEffectCanvas';

// ── VS Code API ─────────────────────────────────────────────────────────────

declare global {
    interface VscodeStateApi {
        getState(): PetPanelState | undefined;
        setState(state: PetPanelState): void;
        postMessage(message: WebviewMessage): void;
    }
    function acquireVsCodeApi(): VscodeStateApi;
}

let vscodeApi: VscodeStateApi;

function postToExtension(msg: object) {
    vscodeApi.postMessage(msg as WebviewMessage);
}

// ── Critter reference ───────────────────────────────────────────────────────

export var allPets: IPetCollection = new PetCollection();
let activeCritter: EmojiCritter | undefined;

// ── Mouse swipe handler ─────────────────────────────────────────────────────

function handleMouseOver(e: MouseEvent) {
    const el = e.currentTarget as HTMLDivElement;
    allPets.pets.forEach((element) => {
        if (element.collision === el && element.pet.canSwipe) {
            element.pet.swipe();
        }
    });
}

function startAnimations(collision: HTMLDivElement, _pet: IPetType) {
    collision.addEventListener('mouseover', handleMouseOver);
}

// ── Critter initialisation ──────────────────────────────────────────────────

function addCritterToPanel(
    species: string,
    left: number,
    bottom: number,
    floor: number,
    stateApi: VscodeStateApi,
): PetElement {
    const container = document.getElementById('petsContainer') as HTMLDivElement;

    const el = document.createElement('img') as HTMLImageElement;
    el.className = 'pet';
    container.appendChild(el);

    const collision = document.createElement('div') as HTMLDivElement;
    collision.className = 'collision';
    container.appendChild(collision);

    const speech = document.createElement('div') as HTMLDivElement;
    speech.className = 'bubble bubble-large';
    container.appendChild(speech);

    const critter = new EmojiCritter(
        species,
        el,
        collision,
        speech,
        PetSize.large,
        left,
        bottom,
        '',        // petRoot — not used for emoji
        floor,
        '',        // name comes from stateUpdate
        3,         // speed (normal)
    );

    activeCritter = critter;
    startAnimations(collision, critter);

    return new PetElement(el, collision, speech, critter, PetColor.brown, PetType.cat);
}

// ── Canvas helpers ──────────────────────────────────────────────────────────

function initCanvas(name: string): HTMLCanvasElement | null {
    const canvas = document.getElementById(name) as HTMLCanvasElement;
    if (!canvas) { return null; }
    const ctx = canvas.getContext('2d');
    if (!ctx)   { return null; }
    ctx.canvas.width  = window.innerWidth;
    ctx.canvas.height = window.innerHeight;
    return canvas;
}

function randomStartPosition(): number {
    return Math.floor(Math.random() * (window.innerWidth * 0.6));
}

// ── Stat bar UI ─────────────────────────────────────────────────────────────

const STAT_IDS: Array<{ key: string; icon: string; fillId: string }> = [
    { key: 'hunger',      icon: '🍖', fillId: 'fill-hunger' },
    { key: 'happiness',   icon: '😊', fillId: 'fill-happiness' },
    { key: 'energy',      icon: '⚡', fillId: 'fill-energy' },
    { key: 'cleanliness', icon: '🛁', fillId: 'fill-cleanliness' },
];

function updateStatBar(fillId: string, value: number) {
    const el = document.getElementById(fillId);
    if (!el) { return; }
    el.style.width = `${Math.max(0, Math.min(100, value))}%`;
    el.classList.toggle('critical', value < 20);
}

interface CritterStateMsg {
    name:       string;
    level:      number;
    hunger:     number;
    happiness:  number;
    energy:     number;
    cleanliness: number;
}

function handleStateUpdate(state: CritterStateMsg, mood: string, dialogue: string) {
    // Stat bars
    updateStatBar('fill-hunger',      state.hunger);
    updateStatBar('fill-happiness',   state.happiness);
    updateStatBar('fill-energy',      state.energy);
    updateStatBar('fill-cleanliness', state.cleanliness);

    // Critter info
    const nameEl  = document.getElementById('critterName');
    const levelEl = document.getElementById('critterLevel');
    const moodEl  = document.getElementById('critterMood');
    if (nameEl)  { nameEl.textContent  = state.name || 'Your Critter'; }
    if (levelEl) { levelEl.textContent = `Lv.${state.level}`; }
    if (moodEl)  { moodEl.textContent  = moodEmoji(mood); }

    // Update critter's displayed emoji
    activeCritter?.updateMood(mood);

    // Mood speech bubble
    showMoodBubble(dialogue);
}

function moodEmoji(mood: string): string {
    const map: Record<string, string> = {
        ecstatic: '🤩', happy: '😊', content: '😐',
        sad: '😢', hungry: '😤', tired: '😴',
        dirty: '🤢', miserable: '😭', sleeping: '😴',
    };
    return map[mood] ?? '😐';
}

// ── Mood speech bubble ───────────────────────────────────────────────────────

let moodBubbleTimer: ReturnType<typeof setTimeout> | undefined;

function showMoodBubble(text: string) {
    const el = document.getElementById('moodBubble');
    if (!el) { return; }
    el.textContent = text;
    el.classList.add('visible');
    if (moodBubbleTimer) { clearTimeout(moodBubbleTimer); }
    moodBubbleTimer = setTimeout(() => {
        el.classList.remove('visible');
    }, 5000);
}

// ── Inventory UI ─────────────────────────────────────────────────────────────

interface InventorySlot { itemId: string; quantity: number; }
interface InventoryMsg  { slots: InventorySlot[]; coins: number; }

const ITEM_DEFS: Record<string, { name: string; icon: string; category: string }> = {
    basic_food:  { name: 'Kibble',      icon: '🍖', category: 'food'      },
    mega_meal:   { name: 'Mega Meal',   icon: '🍱', category: 'food'      },
    snack:       { name: 'Snack',       icon: '🍪', category: 'food'      },
    treat:       { name: 'Treat',       icon: '⭐', category: 'treat'     },
    ball:        { name: 'Ball',        icon: '🔴', category: 'toy'       },
    bed:         { name: 'Bed',         icon: '🛏️', category: 'furniture' },
    food_bowl:   { name: 'Food Bowl',   icon: '🥣', category: 'furniture' },
    toy_box:     { name: 'Toy Box',     icon: '📦', category: 'furniture' },
    plant:       { name: 'Plant',       icon: '🪴', category: 'furniture' },
    window:      { name: 'Window',      icon: '🪟', category: 'furniture' },
};

const FEEDABLE_CATEGORIES = new Set(['food', 'treat']);

function handleInventoryUpdate(inv: InventoryMsg) {
    const container = document.getElementById('inventoryItems');
    if (!container) { return; }

    if (!inv.slots.length) {
        container.innerHTML = `<span class="inv-empty">No items yet — save some files!</span>`;
        return;
    }

    container.innerHTML = '';
    inv.slots.forEach((slot) => {
        if (slot.quantity <= 0) { return; }
        const def = ITEM_DEFS[slot.itemId];
        if (!def) { return; }

        const feedable = FEEDABLE_CATEGORIES.has(def.category);
        const div = document.createElement('div');
        div.className = `inv-item${feedable ? '' : ' no-feed'}`;
        div.dataset['itemId'] = slot.itemId;
        div.title = feedable ? `Click to feed ${def.name}` : def.name;
        div.innerHTML = [
            `<span class="inv-item-icon">${def.icon}</span>`,
            `<span class="inv-item-name">${def.name}</span>`,
            `<span class="inv-item-count">×${slot.quantity}</span>`,
        ].join('');

        if (feedable) {
            div.addEventListener('click', () => {
                postToExtension({ type: 'feedCritter', itemId: slot.itemId });
            });
        }
        container.appendChild(div);
    });
}

// ── Reward toast ──────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showRewardToast(text: string) {
    const el = document.getElementById('rewardToast');
    if (!el) { return; }
    el.textContent = text;
    el.classList.add('visible');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(() => el.classList.remove('visible'), 3500);
}

// ── Main app entry point ──────────────────────────────────────────────────────

export function petPanelApp(
    basePetUri: string,
    theme: Theme,
    themeKind: ColorThemeKind,
    critterSpecies: string,   // e.g. 'cat', 'dog', 'bunny'
    _petSize: PetSize,        // unused — critter is always 'large' for emoji
    _petType: PetType,        // unused — kept for API compat
    throwBallWithMouse: boolean,
    disableEffects: boolean,
    stateApi?: VscodeStateApi,
) {
    vscodeApi = stateApi ?? acquireVsCodeApi();

    // ── Theme backgrounds ──────────────────────────────────────────────────
    const themeInfo = THEMES[theme];

    // Lift the floor above the inventory panel so the critter is always visible.
    // Measure at runtime so it works regardless of content height.
    const inventoryEl   = document.getElementById('inventoryPanel');
    const inventoryH    = inventoryEl ? inventoryEl.offsetHeight || 65 : 65;
    const themeFloor    = themeInfo.floor(PetSize.large);
    const floor         = themeFloor + inventoryH + 8; // 8px breathing room

    const bgEl = document.getElementById('background');
    const fgEl = document.getElementById('foreground');
    if (bgEl) { bgEl.style.backgroundImage = themeInfo.backgroundImageUrl(basePetUri, themeKind, PetSize.large); }
    if (fgEl) { fgEl.style.backgroundImage = themeInfo.foregroundImageUrl(basePetUri, themeKind, PetSize.large); }

    // ── Spawn the critter ──────────────────────────────────────────────────
    const critterEl = addCritterToPanel(
        critterSpecies,
        randomStartPosition(),
        floor,
        floor,
        vscodeApi,
    );
    allPets.push(critterEl);

    // ── Inventory toggle ───────────────────────────────────────────────────
    const invHeader = document.getElementById('inventoryHeader');
    invHeader?.addEventListener('click', () => {
        const panel = document.getElementById('inventoryPanel');
        if (!panel) { return; }
        panel.classList.toggle('collapsed');
        // Re-measure floor after layout settles so critter position updates
        setTimeout(() => {
            const newH = panel.offsetHeight || 65;
            const newFloor = themeFloor + newH + 8;
            activeCritter?.positionBottom(newFloor);
        }, 270); // matches CSS transition duration
    });

    // ── Canvas + ball throwing ─────────────────────────────────────────────
    initCanvas(PET_CANVAS_ID);
    setupBallThrowing(PET_CANVAS_ID, PetSize.large, floor);
    if (throwBallWithMouse) {
        dynamicThrowOn(allPets.pets);
    } else {
        dynamicThrowOff();
    }

    // ── Theme effects ──────────────────────────────────────────────────────
    if (themeInfo.effect) {
        const fgCanvas = initCanvas(FOREGROUND_EFFECT_CANVAS_ID);
        const bgCanvas = initCanvas(BACKGROUND_EFFECT_CANVAS_ID);
        if (fgCanvas && bgCanvas) {
            themeInfo.effect.init(fgCanvas, bgCanvas, PetSize.large, floor, themeKind);
            if (!disableEffects) { themeInfo.effect.enable(); }
        }
    }

    // ── Animation loop (driven by 'tick' messages from extension) ──────────
    let windowLoaded = false;
    const onTick = () => {
        if (!windowLoaded) { return; }
        allPets.pets.forEach((p) => p.pet.nextFrame());
    };
    window.addEventListener('load', () => { windowLoaded = true; });

    // ── Message handler ────────────────────────────────────────────────────
    window.addEventListener('message', (event): void => {
        const message = event.data;

        // New typed protocol (extension → webview)
        if (message.type) {
            switch (message.type) {
                case 'stateUpdate':
                    handleStateUpdate(message.state, message.mood, message.dialogue);
                    return;
                case 'inventoryUpdate':
                    handleInventoryUpdate(message.inventory);
                    return;
                case 'habitatUpdate':
                    // Phase 3 — grid rendering
                    return;
            }
        }

        // Legacy command protocol
        switch (message.command) {
            case 'throw-with-mouse':
                if (message.enabled) { dynamicThrowOn(allPets.pets); }
                else                 { dynamicThrowOff(); }
                break;

            case 'throw-ball':
                throwAndChase(allPets.pets);
                break;

            case 'tick':
                onTick();
                break;

            case 'disable-effects':
                if (themeInfo.effect) {
                    message.disabled ? themeInfo.effect.disable() : themeInfo.effect.enable();
                }
                break;
        }
    });

    // ── Resize ─────────────────────────────────────────────────────────────
    window.addEventListener('resize', () => {
        initCanvas(PET_CANVAS_ID);
        initCanvas(FOREGROUND_EFFECT_CANVAS_ID);
        initCanvas(BACKGROUND_EFFECT_CANVAS_ID);
        if (themeInfo.effect) { themeInfo.effect.handleResize(); }
    });
}
