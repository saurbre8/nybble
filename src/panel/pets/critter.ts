/**
 * EmojiCritter — a BasePetType subclass that renders using SVG emoji sprites
 * instead of sprite-sheet GIFs. Used as the single critter in Nybble.
 *
 * The img element's src is set to an inline SVG data URI containing the
 * appropriate emoji for the current species + mood combination.
 */
import { PetColor, PetSize, PetSpeed } from '../../common/types';
import { BasePetType } from '../basepettype';
import { States } from '../states';

// ---------------------------------------------------------------------------
// Emoji maps — species → mood → emoji character
// ---------------------------------------------------------------------------

const SPECIES_EMOJI: Record<string, Record<string, string>> = {
    cat: {
        default:   '🐱',
        happy:     '😺',
        ecstatic:  '😸',
        sad:       '😿',
        miserable: '😾',
        hungry:    '😾',
        sleeping:  '😴',
        tired:     '😪',
        excited:   '🙀',
        dirty:     '🐱',
        content:   '🐱',
    },
    dog: {
        default:   '🐶',
        happy:     '🐶',
        ecstatic:  '🐕',
        sad:       '🐶',
        miserable: '🐶',
        hungry:    '🐕',
        sleeping:  '😴',
        tired:     '😪',
        excited:   '🐕',
        dirty:     '🐶',
        content:   '🐶',
    },
    bunny: {
        default:   '🐰',
        happy:     '🐇',
        ecstatic:  '🐇',
        sad:       '🐰',
        miserable: '🐰',
        hungry:    '🐰',
        sleeping:  '😴',
        tired:     '😪',
        excited:   '🐇',
        dirty:     '🐰',
        content:   '🐰',
    },
    fox: {
        default:   '🦊',
        happy:     '🦊',
        ecstatic:  '🦊',
        sad:       '🦊',
        miserable: '🦊',
        hungry:    '🦊',
        sleeping:  '😴',
        tired:     '😪',
        excited:   '🦊',
        dirty:     '🦊',
        content:   '🦊',
    },
    frog: {
        default:   '🐸',
        happy:     '🐸',
        ecstatic:  '🐸',
        sad:       '🐸',
        miserable: '🐸',
        hungry:    '🐸',
        sleeping:  '😴',
        tired:     '😪',
        excited:   '🐸',
        dirty:     '🐸',
        content:   '🐸',
    },
};

/** State names that map to an "excited" emoji (running/chasing). */
const EXCITED_STATES = new Set([
    'runLeft', 'runRight', 'chase', 'chaseFriend', 'swipe',
]);

// ---------------------------------------------------------------------------
// EmojiCritter
// ---------------------------------------------------------------------------

export class EmojiCritter extends BasePetType {
    label = 'critter';

    static possibleColors = [PetColor.brown];

    // Simple walk-left/right/idle sequence
    sequence = {
        startingState: States.sitIdle,
        sequenceStates: [
            {
                state: States.sitIdle,
                possibleNextStates: [
                    States.walkRight,
                    States.walkLeft,
                    States.sitIdle,
                ],
            },
            {
                state: States.walkRight,
                possibleNextStates: [States.walkLeft, States.sitIdle],
            },
            {
                state: States.walkLeft,
                possibleNextStates: [States.walkRight, States.sitIdle],
            },
            {
                state: States.runRight,
                possibleNextStates: [States.walkLeft, States.sitIdle],
            },
            {
                state: States.runLeft,
                possibleNextStates: [States.walkRight, States.sitIdle],
            },
            {
                state: States.chase,
                possibleNextStates: [States.idleWithBall],
            },
            {
                state: States.idleWithBall,
                possibleNextStates: [States.walkRight, States.walkLeft],
            },
        ],
    };

    private readonly _imgEl: HTMLImageElement;
    private _species: string;
    private _mood: string = 'content';
    private _lastSrc = '';

    constructor(
        species: string,
        el: HTMLImageElement,
        collision: HTMLDivElement,
        speech: HTMLDivElement,
        size: PetSize,
        left: number,
        bottom: number,
        petRoot: string,
        floor: number,
        name: string,
        speed: number,
    ) {
        super(el, collision, speech, size, left, bottom, petRoot, floor, name, speed);
        this._imgEl = el;
        this._species = species;
        // Render initial emoji
        this.setAnimation('idle');
    }

    /** Called every frame by BasePetType.nextFrame() */
    setAnimation(face: string): void {
        const emojiKey = EXCITED_STATES.has(face) ? 'excited'
            : (this._mood === 'sleeping' || face === 'sleep') ? 'sleeping'
            : this._mood;

        const map   = SPECIES_EMOJI[this._species] ?? SPECIES_EMOJI.cat;
        const emoji = map[emojiKey] ?? map['default'] ?? '🐱';
        const px    = 96; // SVG viewport size — scaled by CSS max-width

        const svg = [
            `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${px} ${px}'>`,
            `<text y='${Math.round(px * 0.88)}' font-size='${Math.round(px * 0.9)}' `,
            `font-family='Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,serif'>`,
            emoji,
            `</text></svg>`,
        ].join('');

        const newSrc = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        if (newSrc !== this._lastSrc) {
            this._imgEl.src = newSrc;
            this._lastSrc   = newSrc;
        }

        // Drive CSS animation class on the img element
        const isRunning = face.startsWith('run') || face === 'chase';
        const isWalking = face.startsWith('walk');
        this._imgEl.classList.toggle('running', isRunning);
        this._imgEl.classList.toggle('walking', isWalking && !isRunning);
    }

    /** Called by the webview when a stateUpdate message arrives. */
    updateMood(mood: string): void {
        this._mood = mood;
    }

    get emoji(): string {
        return SPECIES_EMOJI[this._species]?.['default'] ?? '🐱';
    }

    get hello(): string {
        return `Hi! I'm ${this.name}.`;
    }
}
