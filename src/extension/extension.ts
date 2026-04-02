import * as vscode from 'vscode';
import { ColorThemeKind } from 'vscode';
import {
    Theme,
    ExtPosition,
    ALL_THEMES,
} from '../common/types';
import {
    CritterState,
    createDefaultCritterState,
    applyDecay,
    deriveMood,
    addXp,
    MOOD_DIALOGUE,
} from '../critterState';
import {
    Inventory,
    createDefaultInventory,
    addItem,
    removeItem,
    getQuantity,
    ITEMS,
    rewardForLines,
    rewardForFixingErrors,
    milestoneReward,
    CodingReward,
} from '../inventory';
import {
    HabitatGrid,
    createEmptyHabitat,
    placeItem,
    removeItem as removeHabitatItem,
} from '../habitat';

// ---------------------------------------------------------------------------
// Persistence keys
// ---------------------------------------------------------------------------

const KEY_STATE     = 'nybble.state';
const KEY_INVENTORY = 'nybble.inventory';
const KEY_HABITAT   = 'nybble.habitat';
const KEY_LOC       = 'nybble.sessionLoc';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getPosition(): ExtPosition {
    return vscode.workspace
        .getConfiguration('nybble')
        .get<ExtPosition>('position', ExtPosition.explorer);
}

function getDecayRate(): string {
    return vscode.workspace
        .getConfiguration('nybble')
        .get<string>('statDecayRate', 'normal');
}

function getTheme(): Theme {
    const t = vscode.workspace
        .getConfiguration('nybble')
        .get<Theme>('theme', Theme.none);
    return ALL_THEMES.includes(t) ? t : Theme.none;
}

function getThemeKind(): ColorThemeKind {
    return vscode.window.activeColorTheme.kind as unknown as ColorThemeKind;
}

function getCritterType(): string {
    return vscode.workspace
        .getConfiguration('nybble')
        .get<string>('critterType', 'cat');
}

function getShowStatusBar(): boolean {
    return vscode.workspace
        .getConfiguration('nybble')
        .get<boolean>('showStatusBar', true);
}

// ---------------------------------------------------------------------------
// Webview message types (extension ↔ webview protocol)
// ---------------------------------------------------------------------------

interface StateUpdateMessage {
    type: 'stateUpdate';
    state: CritterState;
    mood: string;
    dialogue: string;
}

interface InventoryUpdateMessage {
    type: 'inventoryUpdate';
    inventory: Inventory;
}

interface HabitatUpdateMessage {
    type: 'habitatUpdate';
    habitat: HabitatGrid;
}

type ToWebviewMessage = StateUpdateMessage | InventoryUpdateMessage | HabitatUpdateMessage;

interface FeedMessage    { type: 'feedCritter'; itemId: string; }
interface PlaceMessage   { type: 'placeItem';   itemId: string; x: number; y: number; }
interface RemoveMessage  { type: 'removeItem';  x: number; y: number; }
interface PlayMessage    { type: 'playFetch'; }
interface RenameMessage  { type: 'rename'; name: string; }

type FromWebviewMessage = FeedMessage | PlaceMessage | RemoveMessage | PlayMessage | RenameMessage;

// ---------------------------------------------------------------------------
// Panel / view provider (webview infrastructure)
// ---------------------------------------------------------------------------

let webviewViewProvider: NybbleWebviewViewProvider | undefined;
let statusBarItem: vscode.StatusBarItem;

function getWebview(): vscode.Webview | undefined {
    if (getPosition() === ExtPosition.explorer && webviewViewProvider) {
        return webviewViewProvider.getWebview();
    }
    if (NybblePanel.currentPanel) {
        return NybblePanel.currentPanel.getWebview();
    }
    return undefined;
}

function postToWebview(msg: ToWebviewMessage): void {
    void getWebview()?.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Extension state (in-memory, loaded from globalState on activate)
// ---------------------------------------------------------------------------

let critterState: CritterState;
let inventory: Inventory;
let habitat: HabitatGrid;
let sessionLoc = 0;

// Lines-written tracking (per document, reset when saved)
const lineCounters = new Map<string, number>();

// Diagnostics tracking (per file, watch for drops to zero)
const prevDiagnostics = new Map<string, number>();

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function loadState(context: vscode.ExtensionContext): void {
    critterState = context.globalState.get<CritterState>(KEY_STATE)
        ?? createDefaultCritterState('', getCritterType());
    inventory    = context.globalState.get<Inventory>(KEY_INVENTORY)
        ?? createDefaultInventory();
    habitat      = context.globalState.get<HabitatGrid>(KEY_HABITAT)
        ?? createEmptyHabitat();
    sessionLoc   = context.globalState.get<number>(KEY_LOC, 0);
}

async function saveState(context: vscode.ExtensionContext): Promise<void> {
    await context.globalState.update(KEY_STATE,     critterState);
    await context.globalState.update(KEY_INVENTORY, inventory);
    await context.globalState.update(KEY_HABITAT,   habitat);
    await context.globalState.update(KEY_LOC,       sessionLoc);
    context.globalState.setKeysForSync([KEY_STATE, KEY_INVENTORY, KEY_HABITAT]);
}

// ---------------------------------------------------------------------------
// Reward helpers
// ---------------------------------------------------------------------------

function applyReward(context: vscode.ExtensionContext, reward: CodingReward): void {
    inventory = addItem(inventory, reward.itemId, reward.quantity);
    void saveState(context);
    postToWebview({ type: 'inventoryUpdate', inventory });

    const def = ITEMS[reward.itemId];
    if (def) {
        void vscode.window.setStatusBarMessage(
            `$(gift) ${def.icon} +${reward.quantity} ${def.name} — ${reward.reason}`,
            4000,
        );
    }
}

function applyXpReward(context: vscode.ExtensionContext, xp: number): void {
    const before = critterState.level;
    critterState = addXp(critterState, xp);
    if (critterState.level > before) {
        void vscode.window.showInformationMessage(
            `🎉 ${critterState.name || 'Your critter'} reached level ${critterState.level}!`,
        );
    }
    void saveState(context);
    broadcastState();
}

// ---------------------------------------------------------------------------
// Broadcast current state to webview
// ---------------------------------------------------------------------------

function broadcastState(): void {
    const mood = deriveMood(critterState);
    const lines = MOOD_DIALOGUE[mood];
    const dialogue = lines[Math.floor(Math.random() * lines.length)];
    postToWebview({ type: 'stateUpdate', state: critterState, mood, dialogue });
    updateStatusBar();
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

const MOOD_ICONS: Record<string, string> = {
    ecstatic:  '$(star-full)',
    happy:     '$(smiley)',
    content:   '$(circle-outline)',
    sad:       '$(circle-slash)',
    hungry:    '$(warning)',
    tired:     '$(watch)',
    dirty:     '$(dash)',
    miserable: '$(error)',
    sleeping:  '$(eye-closed)',
};

function updateStatusBar(): void {
    if (!getShowStatusBar()) {
        statusBarItem.hide();
        return;
    }
    const mood = deriveMood(critterState);
    const icon = MOOD_ICONS[mood] ?? '$(circle-outline)';
    const name = critterState.name || 'Critter';
    statusBarItem.text = `${icon} ${name}`;
    statusBarItem.tooltip = `${name} is ${mood} | Lv.${critterState.level} | Click to open Nybble`;
    statusBarItem.show();
}

// ---------------------------------------------------------------------------
// Stat decay timer (runs every minute)
// ---------------------------------------------------------------------------

function startDecayTimer(context: vscode.ExtensionContext): NodeJS.Timeout {
    return setInterval(() => {
        critterState = applyDecay(critterState, getDecayRate());
        void saveState(context);
        broadcastState();
    }, 60_000);
}

// ---------------------------------------------------------------------------
// Webview message handler (incoming from webview)
// ---------------------------------------------------------------------------

function handleWebviewMessage(
    message: FromWebviewMessage,
    context: vscode.ExtensionContext,
): void {
    switch (message.type) {
        case 'feedCritter': {
            const { itemId } = message;
            if (getQuantity(inventory, itemId) < 1) {
                void vscode.window.showWarningMessage(`No ${ITEMS[itemId]?.name ?? itemId} left.`);
                return;
            }
            const def = ITEMS[itemId];
            if (!def) { return; }

            inventory = removeItem(inventory, itemId);
            critterState = {
                ...critterState,
                hunger:      Math.min(100, critterState.hunger      + def.hungerRestore),
                happiness:   Math.min(100, critterState.happiness   + def.happinessRestore),
                energy:      Math.min(100, critterState.energy      + def.energyRestore),
                cleanliness: Math.min(100, critterState.cleanliness + def.cleanlinessRestore),
            };
            void saveState(context);
            broadcastState();
            postToWebview({ type: 'inventoryUpdate', inventory });
            break;
        }

        case 'placeItem': {
            const { itemId, x, y } = message;
            const def = ITEMS[itemId];
            if (!def || getQuantity(inventory, itemId) < 1) { return; }
            inventory = removeItem(inventory, itemId);
            habitat   = placeItem(habitat, x, y, { itemId, label: def.name });
            void saveState(context);
            postToWebview({ type: 'habitatUpdate', habitat });
            postToWebview({ type: 'inventoryUpdate', inventory });
            break;
        }

        case 'removeItem': {
            const { x, y } = message;
            habitat = removeHabitatItem(habitat, x, y);
            void saveState(context);
            postToWebview({ type: 'habitatUpdate', habitat });
            break;
        }

        case 'playFetch': {
            // Happiness boost, energy cost
            critterState = {
                ...critterState,
                happiness: Math.min(100, critterState.happiness + 15),
                energy:    Math.max(0,   critterState.energy    - 10),
            };
            void saveState(context);
            broadcastState();
            break;
        }

        case 'rename': {
            const { name } = message;
            if (name.trim().length === 0) { return; }
            critterState = { ...critterState, name: name.trim() };
            void saveState(context);
            broadcastState();
            updateStatusBar();
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Editor hooks
// ---------------------------------------------------------------------------

function registerEditorHooks(context: vscode.ExtensionContext): void {
    // Text changes → count lines written; every 50 earns food + XP
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            const uri = e.document.uri.toString();
            let added = 0;
            for (const change of e.contentChanges) {
                const newLines = (change.text.match(/\n/g) ?? []).length;
                const removedLines = change.range.end.line - change.range.start.line;
                added += Math.max(0, newLines - removedLines);
            }
            if (added > 0) {
                lineCounters.set(uri, (lineCounters.get(uri) ?? 0) + added);
                const total = lineCounters.get(uri)!;

                // Award in 50-line chunks
                if (total >= 50) {
                    applyReward(context, rewardForLines());
                    applyXpReward(context, 5);
                    lineCounters.set(uri, 0);

                    // Milestone drops based on cumulative session LOC
                    sessionLoc += 50;
                    const milestone = milestoneReward(sessionLoc);
                    if (milestone) {
                        applyReward(context, milestone);
                        void vscode.window.showInformationMessage(
                            `🏆 Milestone! ${milestone.reason}: +${milestone.quantity} ${ITEMS[milestone.itemId]?.name}`,
                        );
                    }
                }
            }
        }),
    );

    // Diagnostics → reward for fixing errors
    context.subscriptions.push(
        vscode.languages.onDidChangeDiagnostics((e) => {
            for (const uri of e.uris) {
                const key = uri.toString();
                const errors = vscode.languages
                    .getDiagnostics(uri)
                    .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
                    .length;

                const prev = prevDiagnostics.get(key) ?? 0;
                if (prev > 0 && errors === 0) {
                    applyReward(context, rewardForFixingErrors());
                    applyXpReward(context, 15);
                }
                prevDiagnostics.set(key, errors);
            }
        }),
    );
}

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
    loadState(context);

    // Apply any offline decay since last session
    critterState = applyDecay(critterState, getDecayRate());
    void saveState(context);

    // Status bar
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100,
    );
    statusBarItem.command = 'nybble.start';
    context.subscriptions.push(statusBarItem);
    updateStatusBar();

    // Decay timer
    const decayTimer = startDecayTimer(context);
    context.subscriptions.push({ dispose: () => clearInterval(decayTimer) });

    // Editor hooks
    registerEditorHooks(context);

    // Position context
    void updatePositionContext();
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => updatePositionContext()),
    );

    // ----- Commands --------------------------------------------------------

    context.subscriptions.push(
        vscode.commands.registerCommand('nybble.start', async () => {
            if (getPosition() === ExtPosition.explorer && webviewViewProvider) {
                await vscode.commands.executeCommand('nybbleView.focus');
            } else {
                NybblePanel.createOrShow(context);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('nybble.feed', async () => {
            const foodItems = inventory.slots
                .filter((s) => {
                    const def = ITEMS[s.itemId];
                    return def && (def.category === 'food' || def.category === 'treat') && s.quantity > 0;
                })
                .map((s) => {
                    const def = ITEMS[s.itemId]!;
                    return {
                        label: `${def.icon} ${def.name} (×${s.quantity})`,
                        description: def.description,
                        itemId: s.itemId,
                    };
                });

            if (foodItems.length === 0) {
                void vscode.window.showWarningMessage(
                    'No food in inventory! Write some code to earn kibble.',
                );
                return;
            }

            const picked = await vscode.window.showQuickPick(foodItems, {
                placeHolder: `Feed ${critterState.name || 'your critter'}`,
            });
            if (picked) {
                handleWebviewMessage({ type: 'feedCritter', itemId: picked.itemId }, context);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('nybble.play', () => {
            handleWebviewMessage({ type: 'playFetch' }, context);
            // Also tell webview to animate
            void getWebview()?.postMessage({ command: 'throw-ball' });
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('nybble.rename', async () => {
            const name = await vscode.window.showInputBox({
                prompt: 'Give your critter a name',
                placeHolder: critterState.name || 'Enter a name...',
                value: critterState.name,
            });
            if (name !== undefined) {
                handleWebviewMessage({ type: 'rename', name }, context);
            }
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('nybble.status', () => {
            const mood = deriveMood(critterState);
            const name = critterState.name || 'Your critter';
            void vscode.window.showInformationMessage(
                `${name} (Lv.${critterState.level}) — ${mood}\n` +
                `🍖 Hunger: ${Math.round(critterState.hunger)}  ` +
                `😊 Happiness: ${Math.round(critterState.happiness)}  ` +
                `⚡ Energy: ${Math.round(critterState.energy)}  ` +
                `🛁 Clean: ${Math.round(critterState.cleanliness)}`,
            );
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('nybble.resetCritter', async () => {
            const confirm = await vscode.window.showWarningMessage(
                'Reset your critter? This clears all stats, inventory, and habitat.',
                { modal: true },
                'Reset',
            );
            if (confirm === 'Reset') {
                critterState = createDefaultCritterState('', getCritterType());
                inventory    = createDefaultInventory();
                habitat      = createEmptyHabitat();
                sessionLoc   = 0;
                void saveState(context);
                broadcastState();
                postToWebview({ type: 'inventoryUpdate', inventory });
                postToWebview({ type: 'habitatUpdate', habitat });
            }
        }),
    );

    // ----- Webview view provider (Explorer sidebar) ------------------------

    webviewViewProvider = new NybbleWebviewViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            NybbleWebviewViewProvider.viewType,
            webviewViewProvider,
        ),
    );

    // ----- Panel serializer -----------------------------------------------

    if (vscode.window.registerWebviewPanelSerializer) {
        vscode.window.registerWebviewPanelSerializer(NybblePanel.viewType, {
            async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
                panel.webview.options = getWebviewOptions(context.extensionUri);
                NybblePanel.revive(panel, context);
            },
        });
    }

    // Config change listener
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('nybble.position')) {
                void updatePositionContext();
            }
            if (e.affectsConfiguration('nybble.showStatusBar')) {
                updateStatusBar();
            }
        }),
    );
}

async function updatePositionContext(): Promise<void> {
    await vscode.commands.executeCommand(
        'setContext',
        'nybble.position',
        getPosition(),
    );
}

export function deactivate() {
    statusBarItem?.dispose();
}

// ---------------------------------------------------------------------------
// Webview helpers
// ---------------------------------------------------------------------------

function getWebviewOptions(
    extensionUri: vscode.Uri,
): vscode.WebviewOptions & vscode.WebviewPanelOptions {
    return {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    };
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

function getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'main-bundle.js'),
    );
    const stylesResetUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'reset.css'),
    );
    const stylesMainUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'pets.css'),
    );
    const silkscreenUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'Silkscreen-Regular.ttf'),
    );
    const basePetUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media'),
    );
    const nonce = getNonce();

    // Pass initial data as JSON in the HTML so the webview bootstraps correctly
    const initData = JSON.stringify({
        state:     critterState,
        inventory: inventory,
        habitat:   habitat,
        mood:      deriveMood(critterState),
        theme:     getTheme(),
        themeKind: getThemeKind(),
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${stylesResetUri}" rel="stylesheet" nonce="${nonce}">
    <link href="${stylesMainUri}" rel="stylesheet" nonce="${nonce}">
    <style nonce="${nonce}">
        @font-face { font-family: 'silkscreen'; src: url('${silkscreenUri}') format('truetype'); }
    </style>
    <title>Nybble</title>
</head>
<body>
    <!-- Stat overlay (top) -->
    <div id="statPanel">
        <div id="critterInfo">
            <span id="critterName">...</span>
            <span id="critterLevel">Lv.1</span>
            <span id="critterMood">😐</span>
        </div>
        <div class="stat-row">
            <span class="stat-icon">🍖</span>
            <div class="stat-track"><div class="stat-fill" id="fill-hunger" style="width:80%"></div></div>
        </div>
        <div class="stat-row">
            <span class="stat-icon">😊</span>
            <div class="stat-track"><div class="stat-fill" id="fill-happiness" style="width:80%"></div></div>
        </div>
        <div class="stat-row">
            <span class="stat-icon">⚡</span>
            <div class="stat-track"><div class="stat-fill" id="fill-energy" style="width:90%"></div></div>
        </div>
        <div class="stat-row">
            <span class="stat-icon">🛁</span>
            <div class="stat-track"><div class="stat-fill" id="fill-cleanliness" style="width:100%"></div></div>
        </div>
    </div>

    <!-- Canvas layers -->
    <div id="petCanvasContainer">
        <canvas id="ballCanvas"></canvas>
        <canvas id="foregroundEffectCanvas"></canvas>
        <canvas id="backgroundEffectCanvas"></canvas>
    </div>

    <!-- Critter (emoji img + collision + speech bubble) -->
    <div id="petsContainer"></div>

    <!-- Persistent mood speech bubble -->
    <div id="moodBubble"></div>

    <!-- Toast notification -->
    <div id="rewardToast"></div>

    <!-- Theme backgrounds -->
    <div id="foreground"></div>
    <div id="background"></div>

    <!-- Inventory panel (bottom, collapsible) -->
    <div id="inventoryPanel">
        <div id="inventoryHeader">
            <span id="inventoryToggle">🎒</span>
            <span id="inventoryTitle">Inventory</span>
            <span id="inventoryChevron">▲</span>
        </div>
        <div id="inventoryItems"><span class="inv-empty">Write code to earn food!</span></div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
    <script nonce="${nonce}">
        const __nybbleInit = ${initData};
        petApp.petPanelApp(
            "${basePetUri}",
            __nybbleInit.theme,
            __nybbleInit.themeKind,
            "${getCritterType()}",
            "large",
            "${getCritterType()}",
            false,
            false
        );
    </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// NybblePanel (standalone webview panel)
// ---------------------------------------------------------------------------

class NybblePanel {
    public static currentPanel: NybblePanel | undefined;
    public static readonly viewType = 'nybblePanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _context: vscode.ExtensionContext;
    private readonly _disposables: vscode.Disposable[] = [];

    public static createOrShow(context: vscode.ExtensionContext): void {
        const column = vscode.window.activeTextEditor?.viewColumn;
        if (NybblePanel.currentPanel) {
            NybblePanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            NybblePanel.viewType,
            'Nybble',
            vscode.ViewColumn.Two,
            getWebviewOptions(context.extensionUri),
        );
        NybblePanel.currentPanel = new NybblePanel(panel, context);
    }

    public static revive(panel: vscode.WebviewPanel, context: vscode.ExtensionContext): void {
        NybblePanel.currentPanel = new NybblePanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel  = panel;
        this._context = context;

        this._panel.webview.html = getHtmlForWebview(panel.webview, context.extensionUri);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            (msg: FromWebviewMessage) => handleWebviewMessage(msg, context),
            null,
            this._disposables,
        );

        // Push initial state after the webview has loaded
        setTimeout(() => {
            broadcastState();
            postToWebview({ type: 'inventoryUpdate', inventory });
            postToWebview({ type: 'habitatUpdate', habitat });
        }, 500);
    }

    public getWebview(): vscode.Webview {
        return this._panel.webview;
    }

    public dispose(): void {
        NybblePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}

// ---------------------------------------------------------------------------
// NybbleWebviewViewProvider (Explorer sidebar view)
// ---------------------------------------------------------------------------

class NybbleWebviewViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'nybbleView';
    private _view?: vscode.WebviewView;

    constructor(private readonly _context: vscode.ExtensionContext) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;
        webviewView.webview.options = getWebviewOptions(this._context.extensionUri);
        webviewView.webview.html = getHtmlForWebview(webviewView.webview, this._context.extensionUri);

        webviewView.webview.onDidReceiveMessage(
            (msg: FromWebviewMessage) => handleWebviewMessage(msg, this._context),
        );

        setTimeout(() => {
            broadcastState();
            postToWebview({ type: 'inventoryUpdate', inventory });
            postToWebview({ type: 'habitatUpdate', habitat });
        }, 500);
    }

    getWebview(): vscode.Webview | undefined {
        return this._view?.webview;
    }
}
