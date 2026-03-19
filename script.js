
// Detect touch capability and add class for CSS
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.body.classList.add('has-touch');
}
const bgMusic = document.getElementById('bg-music');
bgMusic.volume = 0.4;
let isMuted = false;

const _audioPool = {};
function playSound(src, volume = 1.0) {
    if (isMuted) return;
    if (!_audioPool[src]) _audioPool[src] = new Audio(src);
    const a = _audioPool[src];
    a.volume = volume;
    a.currentTime = 0;
    a.play().catch(() => {});
}

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const COLS = 10;
const ROWS = 22;

// Detect mobile
const isMobile = /Mobi|Android|iPhone|iPad|iPod|Touch/i.test(navigator.userAgent) || window.innerWidth <= 600;

// Fit board within viewport (leave room for controls hint + padding)
// On mobile, reserve space for top bar (44px) and bottom buttons (70px)
const mobileReserve = isMobile ? 130 : 60;
const maxBlockW = Math.floor((window.innerWidth * (isMobile ? 0.95 : 1) - 40) / COLS);
const maxBlockH = Math.floor((window.innerHeight - mobileReserve) / ROWS);
const BLOCK = Math.max(14, Math.min(maxBlockW, maxBlockH));

// Colors matching Python version
const COLORS = [
    '#00ffff', // I - cyan
    '#0000ff', // J - blue
    '#ffa500', // L - orange
    '#ffff00', // O - yellow
    '#ff0000', // S - red
    '#a000f0', // T - purple
    '#00ff00', // Z - green
];

// Pieces use SRS-standard bounding boxes so rotation centres are stable:
//   I → 4×4,  O → 3×3,  all others → 3×3
const SHAPES = [
    // I  (state-0: row 1 of 4-row box)
    [[0, 0, 0, 0],
     [1, 1, 1, 1],
     [0, 0, 0, 0],
     [0, 0, 0, 0]],
    // J
    [[1, 0, 0],
     [1, 1, 1],
     [0, 0, 0]],
    // L
    [[0, 0, 1],
     [1, 1, 1],
     [0, 0, 0]],
    // O  (3×3 box, minos at cols 1-2 so at spawn x=3 they land on board cols 4-5)
    [[0, 1, 1],
     [0, 1, 1],
     [0, 0, 0]],
    // S
    [[0, 1, 1],
     [1, 1, 0],
     [0, 0, 0]],
    // T
    [[0, 1, 0],
     [1, 1, 1],
     [0, 0, 0]],
    // Z
    [[1, 1, 0],
     [0, 1, 1],
     [0, 0, 0]],
];

// Tetris guideline speed: (0.8 - (level-1)*0.007)^(level-1) seconds, level is 1-based
function getGuidelineSpeed(lv) {
    const l = lv + 1; // lv is 0-based internally
    return Math.pow(0.8 - (l - 1) * 0.007, l - 1) * 1000;
}

// SRS kick tables — states: 0=spawn, 1=CW(R), 2=180, 3=CCW(L)
// dx=right positive, dy=down positive (canvas coords, wiki +y=up is negated)
const KICKS_JLSTZ = {
    '0>1': [[ 0,0],[-1, 0],[-1,-1],[0, 2],[-1, 2]],  // 0->R
    '1>0': [[ 0,0],[ 1, 0],[ 1, 1],[0,-2],[ 1,-2]],  // R->0
    '1>2': [[ 0,0],[ 1, 0],[ 1, 1],[0,-2],[ 1,-2]],  // R->2
    '2>1': [[ 0,0],[-1, 0],[-1,-1],[0, 2],[-1, 2]],  // 2->R
    '2>3': [[ 0,0],[ 1, 0],[ 1,-1],[0, 2],[ 1, 2]],  // 2->L
    '3>2': [[ 0,0],[-1, 0],[-1, 1],[0,-2],[-1,-2]],  // L->2
    '3>0': [[ 0,0],[-1, 0],[-1, 1],[0,-2],[-1,-2]],  // L->0
    '0>3': [[ 0,0],[ 1, 0],[ 1,-1],[0, 2],[ 1, 2]],  // 0->L
};
const KICKS_I = {
    '0>1': [[ 0,0],[-2, 0],[ 1, 0],[-2, 1],[ 1,-2]],  // 0->R
    '1>0': [[ 0,0],[ 2, 0],[-1, 0],[ 2,-1],[-1, 2]],  // R->0
    '1>2': [[ 0,0],[-1, 0],[ 2, 0],[-1,-2],[ 2, 1]],  // R->2
    '2>1': [[ 0,0],[ 1, 0],[-2, 0],[ 1, 2],[-2,-1]],  // 2->R
    '2>3': [[ 0,0],[ 2, 0],[-1, 0],[ 2,-1],[-1, 2]],  // 2->L
    '3>2': [[ 0,0],[-2, 0],[ 1, 0],[-2, 1],[ 1,-2]],  // L->2
    '3>0': [[ 0,0],[ 1, 0],[-2, 0],[ 1, 2],[-2,-1]],  // L->0
    '0>3': [[ 0,0],[-1, 0],[ 2, 0],[-1,-2],[ 2, 1]],  // 0->L
};
const NEXT_QUEUE_SIZE = 3;

// DAS/ARR (guideline: DAS 167ms, ARR 33ms)
const DAS = 167;
const ARR = 33;
const SOFT_DROP_SPEED = 50; // ms per row (guideline: 20× gravity)

// ─── CANVAS SETUP ────────────────────────────────────────────────────────────
const MINI = Math.max(16, Math.round(BLOCK * 0.75));
const SIDE_W = 4 * MINI + 10;
const SIDE_H = 3 * MINI + 10;

const DPR = window.devicePixelRatio || 1;

function setupCanvas(canvas, cssW, cssH) {
    canvas.width  = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    const context = canvas.getContext('2d');
    context.scale(DPR, DPR);
    return context;
}

const boardCanvas = document.getElementById('board-canvas');
const ctx = setupCanvas(boardCanvas, COLS * BLOCK, ROWS * BLOCK);

const holdCanvas = document.getElementById('hold-canvas');
const hctx = setupCanvas(holdCanvas, SIDE_W, SIDE_H);

const nextCanvas = document.getElementById('next-canvas');
const nctx = setupCanvas(nextCanvas, SIDE_W, NEXT_QUEUE_SIZE * SIDE_H);

// Mobile mini canvases for hold/next
const M_MINI = 12;
const M_SIDE_W = 4 * M_MINI + 8;
const M_SIDE_H = 3 * M_MINI + 8;

const mHoldCanvas = document.getElementById('m-hold-canvas');
const mhctx = mHoldCanvas ? setupCanvas(mHoldCanvas, M_SIDE_W, M_SIDE_H) : null;

const mNextCanvas = document.getElementById('m-next-canvas');
const mnctx = mNextCanvas ? setupCanvas(mNextCanvas, M_SIDE_W, M_SIDE_H) : null;

// ─── GAME STATE ──────────────────────────────────────────────────────────────
let grid, piece, nextQueue, heldIdx, canHold;
let score, level, linesCleared, combo, b2b;
let lastActionRotation, pieceRotation;
let bag;
let dropTimer, softDropTimer, lastTime;
let messages = [];
let gameRunning = false;
let gamePaused = false;
let animFrame;

// Lock delay
const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;
let lockTimer = 0, lockDelayActive = false, lockResets = 0;

// Line clear animation
let lineClearAnim = null; // { rows, timer, total, num, lv, prevB2b }

// Board shake
let shakeTimer = 0, shakeAmt = 0, shakeX = 0, shakeY = 0;

// Hard drop trail & lock flash
let hardDropTrail = null;
let lockFlash = null; // { cells, timer, total }
let levelUpFlash = null; // { timer, total }

// Piece enter animation
let pieceEnterAnim = 0; // ms remaining

// Live rank target
let rankTarget = null; // { score, name, rank }

// High score (single best score for the "Best" display)
let highScore = parseInt(localStorage.getItem('tetrisHigh') || '0');

// High scores table data
let highScores = [];
const MAX_HIGH_SCORES = 6; // Limit the number of high scores in the table

// Key state
const keys = {};
const keyHeld = { ArrowLeft: false, ArrowRight: false, ArrowDown: false, a: false, d: false, s: false };
const keyPress = { ArrowLeft: 0, ArrowRight: 0, ArrowDown: 0, a: 0, d: 0, s: 0 };
const keyRepeat = { ArrowLeft: 0, ArrowRight: 0, ArrowDown: 0, a: 0, d: 0, s: 0 };

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24); if (d < 7) return d + 'd ago';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getSpeed() {
    return Math.max(17, getGuidelineSpeed(level));
}

function nextFromBag() {
    if (!bag.length) {
        bag = [...Array(SHAPES.length).keys()];
        // shuffle
        for (let i = bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [bag[i], bag[j]] = [bag[j], bag[i]];
        }
    }
    return bag.pop();
}

function rotateCW(shape) {
    const rows = shape.length, cols = shape[0].length;
    const result = Array.from({ length: cols }, () => Array(rows).fill(0));
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            result[c][rows - 1 - r] = shape[r][c];
    return result;
}

function rotateCCW(shape) {
    const rows = shape.length, cols = shape[0].length;
    const result = Array.from({ length: cols }, () => Array(rows).fill(0));
    for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
            result[cols - 1 - c][r] = shape[r][c];
    return result;
}

function collides(px, py, shape) {
    for (let r = 0; r < shape.length; r++)
        for (let c = 0; c < shape[r].length; c++)
            if (shape[r][c]) {
                const x = px + c, y = py + r;
                if (x < 0 || x >= COLS || y >= ROWS) return true;
                if (y >= 0 && grid[y][x] !== null) return true;
            }
    return false;
}

function cellOccupied(r, c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
    return grid[r][c] !== null;
}

// ─── PIECE MANAGEMENT ────────────────────────────────────────────────────────
function newPiece() {
    const idx = nextQueue.shift();
    nextQueue.push(nextFromBag());
    piece = {
        idx,
        shape: SHAPES[idx].map(r => [...r]),
        x: Math.floor((COLS - SHAPES[idx][0].length) / 2),
        y: 0,
        rot: 0,
    };
    canHold = true;
    lastActionRotation = false;
    pieceRotation = 0;
    lockResets = 0;
    if (collides(piece.x, piece.y, piece.shape)) {
        endGame();
    }
    pieceEnterAnim = 180;
    renderNext();
}

function tryRotate(rotated, newRot) {
    const key = `${pieceRotation}>${newRot}`;
    const kicks = piece.idx === 0 ? KICKS_I[key] : KICKS_JLSTZ[key];
    for (const [dx, dy] of (kicks || [[0,0]])) {
        if (!collides(piece.x + dx, piece.y + dy, rotated)) {
            piece.x += dx; piece.y += dy;
            piece.shape = rotated;
            pieceRotation = newRot;
            lastActionRotation = true;
            if (lockDelayActive && lockResets < MAX_LOCK_RESETS) { lockTimer = 0; lockResets++; }
            return;
        }
    }
}

function rotatePiece(ccw = false) {
    if (lineClearAnim) return;
    if (piece.idx === 3) return; // O – no rotation
    const newRot = ccw ? (pieceRotation + 3) % 4 : (pieceRotation + 1) % 4;
    tryRotate(ccw ? rotateCCW(piece.shape) : rotateCW(piece.shape), newRot);
}

function holdPiece() {
    if (lineClearAnim) return;
    if (!canHold) return;
    canHold = false;
    if (heldIdx === null) {
        heldIdx = piece.idx;
        newPiece();
    } else {
        const tmp = heldIdx;
        heldIdx = piece.idx;
        piece = {
            idx: tmp,
            shape: SHAPES[tmp].map(r => [...r]),
            x: Math.floor((COLS - SHAPES[tmp][0].length) / 2),
            y: 0,
            rot: 0,
        };
        pieceRotation = 0;
        lastActionRotation = false;
        if (collides(piece.x, piece.y, piece.shape)) endGame();
    }
    renderHold();
}

function movePiece(dx, dy) {
    if (lineClearAnim) return false;
    if (!collides(piece.x + dx, piece.y + dy, piece.shape)) {
        piece.x += dx;
        piece.y += dy;
        if (dx !== 0) {
            lastActionRotation = false;
            playSound('./sounds/move.mp3');
            if (lockDelayActive && lockResets < MAX_LOCK_RESETS) {
                lockTimer = 0;
                lockResets++;
            }
        }
        if (dy > 0) { dropTimer = 0; lockDelayActive = false; lockTimer = 0; }
        return true;
    } else if (dy > 0) {
        if (!lockDelayActive) { lockDelayActive = true; lockTimer = 0; }
        return false;
    }
    return false;
}

function hardDrop() {
    if (lineClearAnim) return;
    const startY = piece.y;
    let dist = 0;
    while (!collides(piece.x, piece.y + 1, piece.shape)) { piece.y++; dist++; }
    // Spawn trail cells from start to landing
    if (dist > 0) {
        const cells = [];
        for (let r = 0; r < piece.shape.length; r++)
            for (let c = 0; c < piece.shape[r].length; c++)
                if (piece.shape[r][c])
                    for (let dy = 0; dy < dist; dy++)
                        cells.push({ x: piece.x + c, y: startY + r + dy });
        hardDropTrail = { cells, color: COLORS[piece.idx], timer: 0, total: 60 };
    }
    lockDelayActive = false; lockTimer = 0;
    lockPiece(dist, true);
    playSound('./sounds/hardDrop.mp3');
}

function ghostY() {
    let gy = piece.y;
    while (!collides(piece.x, gy + 1, piece.shape)) gy++;
    return gy;
}

// ─── T-SPIN DETECTION ────────────────────────────────────────────────────────
function detectTspin() {
    if (piece.idx !== 5 || !lastActionRotation) return null;
    const cy = piece.y + 1, cx = piece.x + 1;
    const corners = [
        cellOccupied(cy - 1, cx - 1), cellOccupied(cy - 1, cx + 1),
        cellOccupied(cy + 1, cx - 1), cellOccupied(cy + 1, cx + 1),
    ];
    const count = corners.filter(Boolean).length;
    if (count >= 3) return 'tspin';
    const frontPairs = {
        0: [corners[0], corners[1]], // front = top  (flat side faces up at spawn)
        1: [corners[1], corners[3]], // front = right (after CW)
        2: [corners[2], corners[3]], // front = bottom (after 180)
        3: [corners[0], corners[2]], // front = left (after CCW)
    };
    const [f1, f2] = frontPairs[pieceRotation];
    if (f1 && f2) return 'tspin';
    if (count >= 2) return 'mini';
    return null;
}

// ─── LOCK & CLEAR ────────────────────────────────────────────────────────────
function lockPiece(dropDist, isHard) {
    score += dropDist * (isHard ? 2 : 1);
    lockDelayActive = false; lockTimer = 0;
    const tspin = detectTspin();
    // Collect locked cells for flash
    const flashCells = [];
    for (let r = 0; r < piece.shape.length; r++)
        for (let c = 0; c < piece.shape[r].length; c++)
            if (piece.shape[r][c] && piece.y + r >= 0) {
                grid[piece.y + r][piece.x + c] = COLORS[piece.idx];
                flashCells.push({ x: piece.x + c, y: piece.y + r });
            }
    lockFlash = { cells: flashCells, timer: 0, total: 400 };
    const animStarted = clearLines(tspin);
    if (!animStarted) newPiece();
    dropTimer = 0;
}

function clearLines(tspin) {
    const full = [];
    for (let r = 0; r < ROWS; r++)
        if (grid[r].every(c => c !== null)) full.push(r);
    const num = full.length;
    let lv = level + 1;
    const prevB2b = b2b;

    let actionScore = 0, msg = '', isDifficult = false;

    // Prioritize T-spin detection over TETRIS
    if (tspin === 'tspin') {
        // T-spin line clears (including T-spin triple)
        const sc = { 0: 400, 1: 800, 2: 1200, 3: 1600 };
        const ms = { 0: 'T-SPIN!', 1: 'T-SPIN SINGLE', 2: 'T-SPIN DOUBLE', 3: 'T-SPIN TRIPLE' };
        isDifficult = true;
        actionScore = (sc[num] || 0) * lv;
        msg = ms[num] || 'T-SPIN';
    } else if (tspin === 'mini') {
        // Mini T-spin (guideline: 0 lines=100, 1 line=200; no mini double)
        const sc = { 0: 100, 1: 200 };
        const ms = { 0: 'MINI T-SPIN', 1: 'MINI T-SPIN SINGLE' };
        isDifficult = num > 0;
        actionScore = (sc[num] || 0) * lv;
        msg = ms[num] || 'MINI T-SPIN';
    } else if (num === 4) {
        // Only treat as TETRIS if not a T-spin
        const sc = { 4: 800 };
        const ms = { 4: 'TETRIS!' };
        isDifficult = true;
        actionScore = (sc[num] || 0) * lv;
        msg = ms[num] || '';
    } else {
        // Singles, doubles, triples
        const sc = { 1: 100, 2: 300, 3: 500 };
        const ms = { 1: 'SINGLE', 2: 'DOUBLE', 3: 'TRIPLE' };
        isDifficult = false;
        actionScore = (sc[num] || 0) * lv;
        msg = ms[num] || '';
    }

    if (actionScore > 0 || num > 0) {
        if (isDifficult && prevB2b && num > 0) {
            actionScore = Math.floor(actionScore * 1.5);
            msg += ' B2B!';
        }
        if (isDifficult && num > 0) b2b = true;
        else if (num > 0) b2b = false;

        score += actionScore;

        if (num > 0) {
            combo++;
            if (combo > 0) {
                score += 50 * combo;  // guideline combo bonus is flat (not level-scaled)
                msg += ` COMBO x${combo}`;
            }
        } else {
            combo = -1;
        }
        if (msg) spawnMessage(msg);
    } else {
        combo = -1;
    }

    if (num > 0) {
        // Shake on big clears
        if (num === 4 || tspin === 'tspin') triggerShake(num === 4 ? 8 : 5);
        // Start animation – actual row removal deferred to game loop
        playSound('./sounds/clear.mp3');
        lineClearAnim = { rows: full, timer: 0, total: 300, num, lv, prevB2b };
        linesCleared += num;
        const newLevel = Math.floor(linesCleared / 10);
        if (newLevel !== level) { level = newLevel; playSound('./sounds/levelUp.mp3'); lv = level + 1; levelUpFlash = { timer: 0, total: 600 }; spawnMessage('LEVEL UP!'); }
        updateUI();
        return true; // caller must NOT call newPiece yet
    }

    // Remove rows immediately when no animation (num === 0 case never reaches here, but safe)
    updateUI();
    return false;
}

// ─── FLOATING MESSAGES ───────────────────────────────────────────────────────
function spawnMessage(text) {
    const py = piece ? Math.max(piece.y * BLOCK + 20, BLOCK * 3) : ROWS * BLOCK * 0.35;
    messages.push({ text, x: (COLS * BLOCK) / 2, y: py, alpha: 1, vy: -1.5, life: 70, scale: 1.4 });
}

// ─── SHAKE ───────────────────────────────────────────────────────────────────
function triggerShake(intensity) {
    shakeAmt = intensity;
    shakeTimer = 350;
    shakeX = (Math.random() - 0.5) * 2 * intensity;
    shakeY = (Math.random() - 0.5) * 2 * intensity;
}

// ─── RENDER ──────────────────────────────────────────────────────────────────
function shadeColor(hex, pct) {
    // pct: positive = lighten, negative = darken
    const n = parseInt(hex.replace('#', ''), 16);
    let r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    r = Math.min(255, Math.max(0, r + Math.round(255 * pct)));
    g = Math.min(255, Math.max(0, g + Math.round(255 * pct)));
    b = Math.min(255, Math.max(0, b + Math.round(255 * pct)));
    return `rgb(${r},${g},${b})`;
}

function drawBlockAt(context, px, py, S, color, alpha, outlineOnly) {
    context.globalAlpha = alpha;

    if (outlineOnly) {
        context.strokeStyle = color;
        context.lineWidth = 1;
        context.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1);
        context.globalAlpha = 1;
        return;
    }

    const B = Math.max(1, Math.floor(S * 0.1)); // bevel thickness

    // 1. Dark outer border (1px gap from edge)
    context.fillStyle = 'rgba(0,0,0,0.7)';
    context.fillRect(px, py, S, S);

    // 2. Main color fill (inset by 1px)
    context.fillStyle = color;
    context.fillRect(px + 1, py + 1, S - 2, S - 2);

    // 3. Top-left bright bevel
    context.fillStyle = shadeColor(color, 0.7);
    // top strip
    context.fillRect(px + 1, py + 1, S - 2, B);
    // left strip
    context.fillRect(px + 1, py + 1 + B, B, S - 2 - B);

    // 4. Bottom-right dark bevel
    context.fillStyle = shadeColor(color, -0.35);
    // bottom strip
    context.fillRect(px + 1, py + S - 1 - B, S - 2, B);
    // right strip
    context.fillRect(px + S - 1 - B, py + 1, B, S - 2 - B);

    // 5. NES-style inner face — slightly desaturated center square
    const inner = B + 1;
    context.fillStyle = shadeColor(color, 0.05);
    context.fillRect(px + inner, py + inner, S - inner * 2, S - inner * 2);

    // 6. Small bright specular dot — top-left corner of inner face
    const dotS = Math.max(1, Math.floor(S * 0.12));
    context.fillStyle = shadeColor(color, 0.7);
    context.fillRect(px + inner, py + inner, dotS, dotS);

    context.globalAlpha = 1;
}

function drawBlock(context, x, y, color, alpha = 1, outlineOnly = false) {
    drawBlockAt(context, x * BLOCK, y * BLOCK, BLOCK, color, alpha, outlineOnly);
}

function drawMiniPiece(context, shapeIdx, canvasW, canvasH, miniSize) {
    context.clearRect(0, 0, canvasW, canvasH);
    if (shapeIdx === null) return;
    const shape = SHAPES[shapeIdx];
    const color = COLORS[shapeIdx];
    const mini = miniSize || MINI;
    const offX = Math.floor((canvasW - shape[0].length * mini) / 2);
    const offY = Math.floor((canvasH - shape.length * mini) / 2);
    for (let r = 0; r < shape.length; r++)
        for (let c = 0; c < shape[r].length; c++)
            if (shape[r][c])
                drawBlockAt(context, offX + c * mini, offY + r * mini, mini, color, 1, false);
}

function renderHold() {
    drawMiniPiece(hctx, heldIdx, SIDE_W, SIDE_H);
    if (mhctx) drawMiniPiece(mhctx, heldIdx, M_SIDE_W, M_SIDE_H, M_MINI);
}
function renderNext() {
    const w = SIDE_W;
    const totalH = NEXT_QUEUE_SIZE * SIDE_H;
    nctx.clearRect(0, 0, w, totalH);
    const slotH = Math.floor(totalH / nextQueue.length);
    nextQueue.forEach((idx, i) => {
        const mini = i === 0 ? MINI : Math.round(MINI * 0.72);
        const shape = SHAPES[idx];
        const offX = Math.floor((w - shape[0].length * mini) / 2);
        const offY = i * slotH + Math.floor((slotH - shape.length * mini) / 2);
        for (let r = 0; r < shape.length; r++)
            for (let c = 0; c < shape[r].length; c++)
                if (shape[r][c])
                    drawBlockAt(nctx, offX + c * mini, offY + r * mini, mini, COLORS[idx], 1, false);
    });
    if (mnctx) drawMiniPiece(mnctx, nextQueue[0], M_SIDE_W, M_SIDE_H, M_MINI);
}

function drawMessages() {
    ctx.textAlign = 'center';
    for (const m of messages) {
        ctx.save();
        ctx.globalAlpha = m.alpha;
        ctx.translate(m.x, m.y);
        ctx.scale(m.scale, m.scale);
        ctx.font = 'bold 18px Impact, Arial';
        // Colored glow
        ctx.shadowColor = '#00eeff';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText(m.text, 0, 0);
        ctx.fillText(m.text, 0, 0);
        ctx.shadowBlur = 0;
        ctx.restore();
    }
    ctx.globalAlpha = 1;
}

function render() {
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

    ctx.save();
    if (shakeTimer > 0) ctx.translate(shakeX, shakeY);

    // Grid background + subtle grid lines
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    ctx.strokeStyle = '#1c1c1c';
    ctx.lineWidth = 0.5;
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * BLOCK); ctx.lineTo(COLS * BLOCK, r * BLOCK); ctx.stroke(); }
    for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * BLOCK, 0); ctx.lineTo(c * BLOCK, ROWS * BLOCK); ctx.stroke(); }

    // Placed blocks
    if (grid) {
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++)
                if (grid[r][c]) drawBlock(ctx, c, r, grid[r][c]);
    }

    // Hard drop trail
    if (hardDropTrail) {
        const t = hardDropTrail.timer / hardDropTrail.total;
        const alpha = t < 0.2 ? (t / 0.2) * 0.3 : (1 - t) * 0.3;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = hardDropTrail.color;
        for (const cell of hardDropTrail.cells) {
            ctx.fillRect(cell.x * BLOCK + 2, cell.y * BLOCK + 2, BLOCK - 4, BLOCK - 4);
        }
        ctx.globalAlpha = 1;
    }

    // Lock flash — cells blink white 3 times
    if (lockFlash) {
        const t = lockFlash.timer / lockFlash.total;
        const alpha = Math.max(0, Math.sin(t * Math.PI * 3)) * (1 - t) * 0.85;
        if (alpha > 0) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ffffff';
            for (const cell of lockFlash.cells) {
                ctx.fillRect(cell.x * BLOCK, cell.y * BLOCK, BLOCK, BLOCK);
            }
            ctx.globalAlpha = 1;
        }
    }

    // Level-up flash — whole board pulses twice
    if (levelUpFlash) {
        const t = levelUpFlash.timer / levelUpFlash.total;
        const p1 = Math.max(0, 1 - t / 0.2);
        const p2 = Math.max(0, 1 - Math.abs(t - 0.35) / 0.15);
        const alpha = Math.max(p1, p2 * 0.5) * 0.45;
        if (alpha > 0) {
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, COLS * BLOCK, ROWS * BLOCK);
            ctx.globalAlpha = 1;
        }
    }

    // Line clear animation — flash bright then collapse rows
    if (lineClearAnim) {
        const t = lineClearAnim.timer / lineClearAnim.total;
        for (const r of lineClearAnim.rows) {
            if (t < 0.4) {
                // Phase 1: bright white flash
                const flashT = t / 0.4;
                ctx.globalAlpha = 1 - flashT * 0.3;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, r * BLOCK, COLS * BLOCK, BLOCK);
                ctx.fillStyle = 'rgba(180,230,255,0.6)';
                ctx.fillRect(0, r * BLOCK, COLS * BLOCK, BLOCK);
            } else {
                // Phase 2: collapse inward (shrink height to 0)
                const collapseT = (t - 0.4) / 0.6;
                const h = BLOCK * (1 - collapseT);
                const yOff = r * BLOCK + (BLOCK - h) / 2;
                ctx.globalAlpha = 1 - collapseT * 0.8;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, yOff, COLS * BLOCK, h);
            }
        }
        ctx.globalAlpha = 1;
    }

    if (!gameRunning || lineClearAnim) {
        drawMessages();
        ctx.restore();
        return;
    }

    // Ghost piece
    const gy = ghostY();
    const ghostColor = COLORS[piece.idx];
    if (gy !== piece.y) {
        for (let r = 0; r < piece.shape.length; r++)
            for (let c = 0; c < piece.shape[r].length; c++)
                if (piece.shape[r][c]) {
                    ctx.globalAlpha = 0.28;
                    ctx.fillStyle = ghostColor;
                    ctx.fillRect((piece.x + c) * BLOCK + 1, (gy + r) * BLOCK + 1, BLOCK - 2, BLOCK - 2);
                    ctx.globalAlpha = 1;
                    ctx.strokeStyle = ghostColor;
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect((piece.x + c) * BLOCK + 0.5, (gy + r) * BLOCK + 0.5, BLOCK - 1, BLOCK - 1);
                }
    }

    // Active piece
    for (let r = 0; r < piece.shape.length; r++)
        for (let c = 0; c < piece.shape[r].length; c++)
            if (piece.shape[r][c]) drawBlock(ctx, piece.x + c, piece.y + r, COLORS[piece.idx]);

    // Piece enter flash — quick bright pop, eases out
    if (pieceEnterAnim > 0) {
        const t = pieceEnterAnim / 180;
        const flashAlpha = t * t * 0.75; // quadratic ease-out
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = '#ffffff';
        for (let r = 0; r < piece.shape.length; r++)
            for (let c = 0; c < piece.shape[r].length; c++)
                if (piece.shape[r][c])
                    ctx.fillRect((piece.x + c) * BLOCK + 1, (piece.y + r) * BLOCK + 1, BLOCK - 2, BLOCK - 2);
        ctx.globalAlpha = 1;
    }

    // Floating messages
    drawMessages();
    ctx.restore();
}

function updateUI() {
    const best = highScores.length > 0 ? highScores[0].score : 0;
    spinValue('score-val', score);
    spinValue('level-val', level + 1);
    spinValue('lines-val', linesCleared);
    spinValue('best-val', best);
    updateMobileUI();
}

function spinValue(id, newVal) {
    const container = document.getElementById(id);
    if (!container) return;
    if (typeof gsap === 'undefined') {
        const inner = container.querySelector('.panel-value-inner');
        if (inner) inner.textContent = newVal; else container.textContent = newVal;
        return;
    }

    const newStr = String(newVal);
    const digits = container.querySelectorAll('.digit');

    // First render or digit count changed — rebuild digit spans
    if (!digits.length || digits.length !== newStr.length) {
        container.innerHTML = newStr.split('').map(d =>
            `<span class="digit" style="display:inline-block;overflow:hidden;height:1em;vertical-align:top;"><span class="digit-inner" style="display:block;">${d}</span></span>`
        ).join('');
        return;
    }

    // Spin only the digits that changed
    digits.forEach((digitEl, i) => {
        const inner = digitEl.querySelector('.digit-inner');
        const oldChar = inner.textContent;
        const newChar = newStr[i];
        if (oldChar === newChar) return;
        gsap.killTweensOf(inner);
        gsap.set(inner, { y: '0em', opacity: 1 });
        inner.textContent = newChar;
        gsap.fromTo(inner,
            { y: '1em', opacity: 0 },
            { y: '0em', opacity: 1, duration: 0.13, ease: 'power2.out' }
        );
    });
}

// ─── GAME LOOP ───────────────────────────────────────────────────────────────
function gameLoop(ts) {
    if (!gameRunning) return;
    const dt = lastTime ? Math.min(ts - lastTime, 100) : 0;
    lastTime = ts;

    // Line clear animation (blocks gameplay while running)
    if (lineClearAnim) {
        lineClearAnim.timer += dt;
        if (lineClearAnim.timer >= lineClearAnim.total) {
            const { rows, num, lv, prevB2b } = lineClearAnim;
            // Remove all full rows first (bottom-to-top), then add empty rows at top
            for (const r of [...rows].sort((a, b) => b - a)) {
                grid.splice(r, 1);
            }
            for (let i = 0; i < rows.length; i++) {
                grid.unshift(Array(COLS).fill(null));
            }
            // Perfect clear check (after rows removed)
            if (grid.every(row => row.every(c => c === null))) {
                const pcBase = { 1: 800, 2: 1200, 3: 1800, 4: 2000 };
                let pcScore = (pcBase[num] || 0) * lv;
                if (num === 4 && prevB2b) pcScore = 3200 * lv;
                score += pcScore;
                spawnMessage('PERFECT CLEAR!');
                updateUI();
            }
            lineClearAnim = null;
            newPiece();
        }
    } else {
        // Gravity
        dropTimer += dt;
        if (dropTimer >= getSpeed()) {
            dropTimer = 0;
            movePiece(0, 1);
        }

        // Soft drop (held down key) — fixed 50ms per row, independent of gravity
        const softHeld = keyHeld['ArrowDown'] || keyHeld['s'];
        if (softHeld) {
            softDropTimer += dt;
            while (softDropTimer >= SOFT_DROP_SPEED) {
                softDropTimer -= SOFT_DROP_SPEED;
                if (movePiece(0, 1)) score += 1;
                else break;
            }
        } else {
            softDropTimer = 0;
        }

        // Lock delay
        if (lockDelayActive) {
            lockTimer += dt;
            if (lockTimer >= LOCK_DELAY) {
                lockDelayActive = false; lockTimer = 0;
                if (collides(piece.x, piece.y + 1, piece.shape)) lockPiece(0, false);
            }
        }

        // DAS/ARR
        const now = ts;
        for (const key of ['ArrowLeft', 'ArrowRight', 'a', 'd']) {
            if (keyHeld[key]) {
                if (now - keyPress[key] >= DAS && now - keyRepeat[key] >= ARR) {
                    keyRepeat[key] = now;
                    if (key === 'ArrowLeft' || key === 'a') movePiece(-1, 0);
                    if (key === 'ArrowRight' || key === 'd') movePiece(1, 0);
                }
            }
        }
    }

    // Shake timer — regenerate offset each frame for jitter feel
    if (shakeTimer > 0) {
        shakeTimer = Math.max(0, shakeTimer - dt);
        const decay = shakeTimer / 350;
        shakeX = (Math.random() - 0.5) * 2 * shakeAmt * decay;
        shakeY = (Math.random() - 0.5) * 2 * shakeAmt * decay;
    }
    // Advance trail/flash timers
    if (hardDropTrail) {
        hardDropTrail.timer += dt;
        if (hardDropTrail.timer >= hardDropTrail.total) hardDropTrail = null;
    }
    if (lockFlash) {
        lockFlash.timer += dt;
        if (lockFlash.timer >= lockFlash.total) lockFlash = null;
    }
    if (levelUpFlash) {
        levelUpFlash.timer += dt;
        if (levelUpFlash.timer >= levelUpFlash.total) levelUpFlash = null;
    }
    if (pieceEnterAnim > 0) pieceEnterAnim = Math.max(0, pieceEnterAnim - dt);

    // Update messages — scale pops in then settles to 1
    for (const m of messages) {
        m.y += m.vy;
        m.vy *= 0.92; // decelerate
        m.alpha -= 1 / m.life;
        m.scale = Math.max(1, m.scale - 0.04);
        m.life--;
    }
    messages = messages.filter(m => m.life > 0);

    // Live rank target — check if we just passed someone
    if (rankTarget && score > rankTarget.score) {
        spawnMessage(`YOU PASSED ${rankTarget.name}!`);
        playSound('./sounds/levelUp.mp3', 0.5);
        const nextIdx = rankTarget.rank - 2;
        rankTarget = nextIdx >= 0
            ? { score: highScores[nextIdx].score, name: highScores[nextIdx].name, rank: nextIdx + 1 }
            : null;
    }

    render();
    animFrame = requestAnimationFrame(gameLoop);
}

// ─── INPUT ───────────────────────────────────────────────────────────────────
function togglePause() {
    if (!gameRunning) return;
    gamePaused = !gamePaused;
    const po = document.getElementById('pause-overlay');
    if (gamePaused) {
        po.style.display = 'flex';
        cancelAnimationFrame(animFrame);
        bgMusic.pause();
    } else {
        po.style.display = 'none';
        // Reset confirm state
        document.getElementById('confirm-panel').style.display = 'none';
        document.getElementById('pause-main-btns').style.display = '';
        lastTime = null;
        bgMusic.play().catch(() => { });
        animFrame = requestAnimationFrame(gameLoop);
    }
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { togglePause(); e.preventDefault(); return; }
    if (!gameRunning || gamePaused) return;
    const now = performance.now();

    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'a', 'd', 's'].includes(e.key) && !keyHeld[e.key]) {
        keyHeld[e.key] = true;
        keyPress[e.key] = now;
        keyRepeat[e.key] = now;
        if (e.key === 'ArrowLeft' || e.key === 'a') { movePiece(-1, 0); e.preventDefault(); }
        if (e.key === 'ArrowRight' || e.key === 'd') { movePiece(1, 0); e.preventDefault(); }
        if (e.key === 'ArrowDown' || e.key === 's') { movePiece(0, 1); e.preventDefault(); }
        return;
    }

    switch (e.key) {
        case 'ArrowUp':
        case 'w': if (!e.repeat) rotatePiece(false); e.preventDefault(); break;
        case 'z':
        case 'Z':
        case 'Control': if (!e.repeat) rotatePiece(true); e.preventDefault(); break;
        case ' ': if (!e.repeat) hardDrop(); e.preventDefault(); break;
        case 'Shift':
        case 'ShiftLeft':
        case 'ShiftRight':
        case 'c':
        case 'C': if (!e.repeat) holdPiece(); e.preventDefault(); break;
    }
});

document.addEventListener('keyup', e => {
    if (e.key in keyHeld) keyHeld[e.key] = false;
});

// ─── HIGH SCORE MANAGEMENT ───────────────────────────────────────────────────
function loadHighScores() {
    const rawScores = localStorage.getItem('tetrisHighScores');
    if (rawScores) {
        try {
            highScores = JSON.parse(rawScores);
            // Ensure scores are numbers and sort them
            highScores = highScores
                .map(s => ({ name: s.name, score: parseInt(s.score), date: s.date || null }))
                .filter(s => !isNaN(s.score))
                .sort((a, b) => b.score - a.score);
            // Trim if there are too many (e.g. if MAX_HIGH_SCORES changed)
            if (highScores.length > MAX_HIGH_SCORES) {
                highScores = highScores.slice(0, MAX_HIGH_SCORES);
            }
        } catch (e) {
            console.error("Failed to parse high scores from localStorage", e);
            highScores = [];
        }
    }
    // Update the single 'highScore' value from the top of the list
    highScore = highScores.length > 0 ? highScores[0].score : 0;
    localStorage.setItem('tetrisHigh', highScore); // Keep original best score in sync if needed
}

function saveHighScores() {
    localStorage.setItem('tetrisHighScores', JSON.stringify(highScores));
}

function displayHighScores() {
    const highscoresList = document.getElementById('highscores-list');
    highscoresList.innerHTML = ''; // Clear previous entries
    
    if (highScores.length === 0) {
        const li = document.createElement('li');
        li.style.cssText = 'text-align:center; padding: 20px;';
        li.textContent = 'No high scores yet!';
        highscoresList.appendChild(li);
        return;
    }

    highScores.forEach((entry, index) => {
        const li = document.createElement('li');
        li.className = 'highscore-item';
        
        const rank = document.createElement('span'); rank.className = 'hs-rank'; rank.textContent = (index + 1) + '.';
        const ename = document.createElement('span'); ename.className = 'hs-name'; ename.textContent = entry.name;
        const esc = document.createElement('span'); esc.className = 'hs-score'; esc.textContent = entry.score;
        const edate = document.createElement('span'); edate.className = 'hs-date';
        if (entry.date) {
            const d = new Date(entry.date);
            edate.textContent = timeAgo(entry.date);
            edate.appendChild(document.createElement('br'));
            edate.appendChild(document.createTextNode(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })));
        }
        li.append(rank, ename, esc, edate);
        highscoresList.appendChild(li);
    });
}

// ─── INIT / RESTART ──────────────────────────────────────────────────────────
function initGame() {
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    bag = [];
    nextQueue = Array.from({ length: NEXT_QUEUE_SIZE }, () => nextFromBag());
    heldIdx = null;
    canHold = true;
    score = 0;
    level = 0;
    linesCleared = 0;
    combo = -1;
    b2b = false;
    lastActionRotation = false;
    pieceRotation = 0;
    messages = [];
    dropTimer = 0;
    softDropTimer = 0;
    lastTime = null;
    gameRunning = true;
    gamePaused = false;
    lockDelayActive = false; lockTimer = 0;
    lineClearAnim = null;
    shakeTimer = 0; shakeAmt = 0; shakeX = 0; shakeY = 0;
    hardDropTrail = null;
    lockFlash = null;
    lockResets = 0;
    pieceEnterAnim = 0;
    levelUpFlash = null;
    rankTarget = null;
    if (highScores.length > 0) {
        for (let i = highScores.length - 1; i >= 0; i--) {
            rankTarget = { score: highScores[i].score, name: highScores[i].name, rank: i + 1 };
            break;
        }
    }
    document.getElementById('pause-overlay').style.display = 'none';
    newPiece();
    renderHold();
    updateUI();
    bgMusic.currentTime = 0;
    bgMusic.play().catch(() => { });
}

function endGame() {
    gameRunning = false;
    cancelAnimationFrame(animFrame);
    bgMusic.pause();
    bgMusic.currentTime = 0;

    // Check for new high score for the table
    const highscoresEntryDiv = document.getElementById('new-highscore-entry');
    const playerNameInput = document.getElementById('player-name-input');
    
    // Get the previous best score before we process the current one
    const previousBest = highScores.length > 0 ? highScores[0].score : 0;

    let isNewHighScoreForTable = false;
    if (score > 0 && (highScores.length < MAX_HIGH_SCORES || score > highScores[highScores.length - 1].score)) {
        isNewHighScoreForTable = true;
        const isTopScore = highScores.length === 0 || score > highScores[0].score;
        document.getElementById('highscore-entry-label').textContent = isTopScore ? 'NEW HIGH SCORE!' : 'LEADERBOARD WORTHY!';
        highscoresEntryDiv.style.display = 'block';
        playerNameInput.value = '';
        playerNameInput.focus();
        document.getElementById('start-btn').style.display = 'none';
    } else {
        highscoresEntryDiv.style.display = 'none';
    }

    // --- UPDATED LOGIC HERE ---
    const finalScoreElement = document.getElementById('final-score');
    finalScoreElement.style.display = 'flex';

    finalScoreElement.textContent = '';
    const makeNum = v => { const s = document.createElement('span'); s.className = 'num'; s.textContent = v; return s; };
    const scoreLabel = document.createTextNode('Score: ');
    if (score > previousBest) {
        const bestSpan = document.createElement('span');
        bestSpan.append(document.createTextNode('New Best: '), makeNum(score));
        finalScoreElement.append(scoreLabel, makeNum(score), document.createTextNode('  │  '), bestSpan);
    } else {
        finalScoreElement.append(scoreLabel, makeNum(score), document.createTextNode('  │  Best: '), makeNum(previousBest));
    }
    // --------------------------

    const overlayH1 = document.getElementById('overlay').querySelector('h1');
    overlayH1.dataset.state = 'gameover';
    overlayH1.querySelectorAll('span').forEach((s, i) => {
        s.textContent = 'GAME OVER'[i] ?? '';
    });
    document.getElementById('start-btn').textContent = 'PLAY AGAIN';
    document.getElementById('overlay').style.display = 'flex';

    // GSAP game-over entrance
    if (typeof gsap !== 'undefined') {
        const h1  = document.querySelector('#overlay h1');
        const fs  = document.getElementById('final-score');
        const btns = Array.from(document.querySelectorAll('#overlay button')).filter(b => b.style.display !== 'none');
        gsap.fromTo(h1,  { scale: 1.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' });
        if (fs)           gsap.fromTo(fs,   { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, delay: 0.25, ease: 'power2.out' });
        if (btns.length)  gsap.fromTo(btns, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.3, delay: 0.4, stagger: 0.08, ease: 'power2.out', clearProps: 'transform' });
    }

    document.getElementById('highscores-display').style.display = 'block';
    displayHighScores();

    if (!isNewHighScoreForTable) {
        document.getElementById('start-btn').style.display = 'block';
    }
}

document.getElementById('resume-btn').addEventListener('click', () => {
    togglePause();
});

document.getElementById('new-game-btn').addEventListener('click', () => {
    document.getElementById('confirm-panel').style.display = 'block';
    document.getElementById('pause-main-btns').style.display = 'none';
});

document.getElementById('confirm-yes').addEventListener('click', () => {
    document.getElementById('confirm-panel').style.display = 'none';
    document.getElementById('pause-main-btns').style.display = '';
    document.getElementById('pause-overlay').style.display = 'none';
    gamePaused = false;
    cancelAnimationFrame(animFrame);
    initGame();
    animFrame = requestAnimationFrame(gameLoop);
});

document.getElementById('confirm-no').addEventListener('click', () => {
    document.getElementById('confirm-panel').style.display = 'none';
    document.getElementById('pause-main-btns').style.display = '';
});

document.getElementById('mute-btn').addEventListener('click', () => {
    isMuted = !isMuted;
    bgMusic.muted = isMuted;
    document.getElementById('mute-icon-on').style.display = isMuted ? 'none' : '';
    document.getElementById('mute-icon-off').style.display = isMuted ? '' : 'none';
    document.getElementById('mute-btn').lastChild.textContent = isMuted ? 'SOUND OFF' : 'SOUND ON';
    document.getElementById('mute-btn').classList.toggle('muted', isMuted);
});

document.getElementById('skip-save-btn').addEventListener('click', () => {
    document.getElementById('new-highscore-entry').style.display = 'none';
    document.getElementById('start-btn').style.display = 'block';
});

document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('final-score').style.display = 'none';
    const overlayH1 = document.getElementById('overlay').querySelector('h1');
    if (overlayH1.dataset.state === 'gameover') {
        const letters = ['T','E','T','R','I','S'];
        overlayH1.querySelectorAll('span').forEach((s, i) => { s.textContent = letters[i]; });
        overlayH1.dataset.state = '';
    }
    document.getElementById('new-highscore-entry').style.display = 'none';
    document.getElementById('highscores-display').style.display = 'none';
    initGame();
    animFrame = requestAnimationFrame(gameLoop);
});

// Event listener for submitting player name with duplicate/case-insensitive check
document.getElementById('submit-name-btn').addEventListener('click', () => {
    const playerNameInput = document.getElementById('player-name-input');
    let playerName = playerNameInput.value.trim();
    
    if (!playerName) {
        playerName = 'Anonymous'; 
    }
    if (playerName.length > 10) playerName = playerName.substring(0, 10);

    // 1. Check for case-insensitive duplicate
    const normalizedName = playerName.toLowerCase();
    const existingEntryIndex = highScores.findIndex(s => s.name.toLowerCase() === normalizedName);

    if (existingEntryIndex !== -1) {
        // Name exists: Only update if the new score is strictly higher
        if (score > highScores[existingEntryIndex].score) {
            highScores[existingEntryIndex].score = score;
            highScores[existingEntryIndex].name = playerName; // Update casing to latest entry
        } else {
            // New score is lower or equal, don't do anything to the list
            // Just move on to showing the table
            spawnMessage("Personal best not beaten");
        }
    } else {
        // Name does not exist: Add as new entry
        highScores.push({ name: playerName, score: score, date: Date.now() });
    }

    // 2. Sort and Trim
    highScores.sort((a, b) => b.score - a.score);
    if (highScores.length > MAX_HIGH_SCORES) {
        highScores = highScores.slice(0, MAX_HIGH_SCORES);
    }

    // 3. Save and UI update
    saveHighScores();
    displayHighScores();

    document.getElementById('new-highscore-entry').style.display = 'none';
    document.getElementById('start-btn').style.display = 'block';
    updateUI();
});

// Initial setup on page load
loadHighScores();
displayHighScores();
document.getElementById('highscores-display').style.display = 'block';
spinValue('best-val', highScore);
render();

// GSAP entrance animation for the title overlay
(function animateOverlay() {
    if (typeof gsap === 'undefined') return;
    const letters = Array.from(document.querySelectorAll('#overlay h1 span'));
    const sub     = document.querySelector('#overlay .sub');
    const btns    = Array.from(document.querySelectorAll('#overlay button'));
    gsap.set(letters, { y: -60, opacity: 0, rotationX: 90 });
    gsap.set([sub, ...btns], { opacity: 0, y: 20 });
    gsap.to(letters, { y: 0, opacity: 1, rotationX: 0, duration: 0.5, ease: 'back.out(1.4)', stagger: 0.07, delay: 0.1 });
    gsap.to([sub, ...btns], { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', stagger: 0.1, delay: 0.65, clearProps: 'transform' });
})();

// ─── MOBILE CONTROLS (BUTTONS ONLY) ─────────────────────────────────────────
(function () {
    // ─── ON-SCREEN BUTTONS ───────────────────────────────────────────────────
    function setupBtn(id, action, repeatable) {
        const btn = document.getElementById(id);
        if (!btn) return;
        let dasTimer = null;
        let repeatId = null;
        let capturedId = null;

        function stopRepeat() {
            clearTimeout(dasTimer);
            clearInterval(repeatId);
            dasTimer = null;
            repeatId = null;
            capturedId = null;
            btn.classList.remove('pressed');
        }

        // Pointer events – unified touch + mouse
        btn.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (capturedId !== null) return; // already tracking a touch
            btn.setPointerCapture(e.pointerId);
            capturedId = e.pointerId;
            btn.classList.add('pressed');
            if (!gameRunning || gamePaused) return;
            action();
            if (repeatable) {
                // Mirror keyboard DAS: wait DAS ms, then repeat every ARR ms
                dasTimer = setTimeout(() => {
                    repeatId = setInterval(() => {
                        if (!gameRunning || gamePaused) { stopRepeat(); return; }
                        action();
                    }, ARR);
                }, DAS);
            }
        });

        btn.addEventListener('pointerup', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.pointerId !== capturedId) return;
            stopRepeat();
        });

        btn.addEventListener('pointercancel', (e) => {
            if (capturedId !== null && e.pointerId !== capturedId) return;
            stopRepeat();
        });

        // Block long-press context menu
        btn.addEventListener('contextmenu', (e) => { e.preventDefault(); });

        // Prevent touch events from propagating to the board canvas handler
        btn.addEventListener('touchstart', (e) => { e.stopPropagation(); }, { passive: false });
        btn.addEventListener('touchend', (e) => { e.stopPropagation(); }, { passive: false });
    }

    setupBtn('tb-left', () => movePiece(-1, 0), true);
    setupBtn('tb-right', () => movePiece(1, 0), true);
    setupBtn('tb-down', () => movePiece(0, 1), true);
    setupBtn('tb-rotate', () => rotatePiece(false), false);
    setupBtn('tb-hard', () => hardDrop(), false);
    setupBtn('tb-hold', () => holdPiece(), false);

    // Mobile pause button
    const mPause = document.getElementById('m-pause');
    if (mPause) {
        mPause.addEventListener('click', (e) => { e.preventDefault(); togglePause(); });
    }
})();

// Update mobile stat bar alongside desktop UI — patched into updateUI directly
function updateMobileUI() {
    const ms = document.getElementById('m-score');
    const ml = document.getElementById('m-level');
    const mn = document.getElementById('m-lines');
    if (ms) ms.textContent = score;
    if (ml) ml.textContent = level + 1;
    if (mn) mn.textContent = linesCleared;
}

// Prevent default touch behavior on game area to stop scrolling/zooming
// but allow buttons/controls to work normally
document.body.addEventListener('touchmove', e => {
    const t = e.target;
    if (t.closest('#mobile-controls') || t.closest('#mobile-top-bar') || t.closest('#overlay') || t.closest('#pause-overlay')) return;
    if (gameRunning) e.preventDefault();
}, { passive: false });