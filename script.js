// Detect touch capability and add class for CSS
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
    document.body.classList.add('has-touch');
}
const bgMusic = document.getElementById('bg-music');
bgMusic.volume = 0.5;

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
    '#00bfff', // I - light blue
    '#0000ff', // J - blue
    '#ffa500', // L - orange
    '#ffff00', // O - yellow
    '#ff0000', // S - red
    '#ee35ff', // T - lavender
    '#00ff00', // Z - green
];

const SHAPES = [
    [[1, 1, 1, 1]],               // I
    [[1, 0, 0], [1, 1, 1]],         // J
    [[0, 0, 1], [1, 1, 1]],         // L
    [[1, 1], [1, 1]],             // O
    [[0, 1, 1], [1, 1, 0]],         // S
    [[0, 1, 0], [1, 1, 1]],         // T
    [[1, 1, 0], [0, 1, 1]],         // Z
];

// NES speed table (ms per row)
const SPEED = {
    0: 800, 1: 717, 2: 633, 3: 550, 4: 467, 5: 383, 6: 300, 7: 217, 8: 133, 9: 100,
    10: 83, 11: 83, 12: 83, 13: 67, 14: 67, 15: 67, 16: 50, 17: 50, 18: 50,
    19: 33, 20: 33, 21: 33, 22: 33, 23: 33, 24: 33, 25: 33, 26: 33, 27: 33, 28: 33, 29: 17
};

// SRS kick tables
const KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
};
const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
};

// DAS/ARR
const DAS = 150;
const ARR = 40;

// ─── CANVAS SETUP ────────────────────────────────────────────────────────────
const MINI = Math.max(16, Math.round(BLOCK * 0.75));
const SIDE_W = 4 * MINI + 10;
const SIDE_H = 3 * MINI + 10;

const boardCanvas = document.getElementById('board-canvas');
boardCanvas.width = COLS * BLOCK;
boardCanvas.height = ROWS * BLOCK;
const ctx = boardCanvas.getContext('2d');

const holdCanvas = document.getElementById('hold-canvas');
holdCanvas.width = SIDE_W;
holdCanvas.height = SIDE_H;
const hctx = holdCanvas.getContext('2d');

const nextCanvas = document.getElementById('next-canvas');
nextCanvas.width = SIDE_W;
nextCanvas.height = SIDE_H;
const nctx = nextCanvas.getContext('2d');

// Mobile mini canvases for hold/next
const M_MINI = 12;
const M_SIDE_W = 4 * M_MINI + 8;
const M_SIDE_H = 3 * M_MINI + 8;

const mHoldCanvas = document.getElementById('m-hold-canvas');
if (mHoldCanvas) { mHoldCanvas.width = M_SIDE_W; mHoldCanvas.height = M_SIDE_H; }
const mhctx = mHoldCanvas ? mHoldCanvas.getContext('2d') : null;

const mNextCanvas = document.getElementById('m-next-canvas');
if (mNextCanvas) { mNextCanvas.width = M_SIDE_W; mNextCanvas.height = M_SIDE_H; }
const mnctx = mNextCanvas ? mNextCanvas.getContext('2d') : null;

// ─── GAME STATE ──────────────────────────────────────────────────────────────
let grid, piece, nextIdx, heldIdx, canHold;
let score, level, linesCleared, combo, b2b;
let lastActionRotation, pieceRotation;
let bag;
let dropTimer, lastTime;
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
let shakeTimer = 0, shakeAmt = 0;

// Piece enter animation
let pieceEnterAnim = 0; // ms remaining

// High score
let highScore = parseInt(localStorage.getItem('tetrisHigh') || '0');

// Key state
const keys = {};
const keyHeld = { ArrowLeft: false, ArrowRight: false, ArrowDown: false };
const keyPress = { ArrowLeft: 0, ArrowRight: 0, ArrowDown: 0 };
const keyRepeat = { ArrowLeft: 0, ArrowRight: 0, ArrowDown: 0 };

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getSpeed() {
    let spd = SPEED[0];
    for (const k of Object.keys(SPEED).map(Number).sort((a, b) => a - b)) {
        if (level >= k) spd = SPEED[k];
    }
    return spd;
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
    piece = {
        idx: nextIdx,
        shape: SHAPES[nextIdx].map(r => [...r]),
        x: Math.floor(COLS / 2) - Math.floor(SHAPES[nextIdx][0].length / 2),
        y: 0,
        rot: 0,
    };
    nextIdx = nextFromBag();
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

function rotatePiece() {
    if (lineClearAnim) return;
    const rotated = rotateCW(piece.shape);
    const newRot = (pieceRotation + 1) % 4;
    const key = `${pieceRotation}>${newRot}`;
    let kicks;
    if (piece.idx === 0) kicks = KICKS_I[key] || [[0, 0]];
    else if (piece.idx === 3) return; // O – no rotation
    else kicks = KICKS_JLSTZ[key] || [[0, 0]];

    for (const [dx, dy] of kicks) {
        if (!collides(piece.x + dx, piece.y + dy, rotated)) {
            piece.x += dx;
            piece.y += dy;
            piece.shape = rotated;
            pieceRotation = newRot;
            lastActionRotation = true;
            if (lockDelayActive && lockResets < MAX_LOCK_RESETS) {
                lockTimer = 0;
                lockResets++;
            }
            return;
        }
    }
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
            x: Math.floor(COLS / 2) - Math.floor(SHAPES[tmp][0].length / 2),
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
            if (lockDelayActive && lockResets < MAX_LOCK_RESETS) {
                lockTimer = 0;
                lockResets++;
                if (!collides(piece.x, piece.y + 1, piece.shape)) lockDelayActive = false;
            }
        }
        if (dy > 0) { lockDelayActive = false; lockTimer = 0; lockResets = 0; }
        return true;
    } else if (dy > 0) {
        if (!lockDelayActive) { lockDelayActive = true; lockTimer = 0; }
        return false;
    }
    return false;
}

function hardDrop() {
    if (lineClearAnim) return;
    let dist = 0;
    while (!collides(piece.x, piece.y + 1, piece.shape)) { piece.y++; dist++; }
    lockDelayActive = false; lockTimer = 0;
    lockPiece(dist, true);
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
        0: [corners[2], corners[3]],
        1: [corners[0], corners[2]],
        2: [corners[0], corners[1]],
        3: [corners[1], corners[3]],
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
    for (let r = 0; r < piece.shape.length; r++)
        for (let c = 0; c < piece.shape[r].length; c++)
            if (piece.shape[r][c] && piece.y + r >= 0)
                grid[piece.y + r][piece.x + c] = COLORS[piece.idx];
    const animStarted = clearLines(tspin);
    if (!animStarted) newPiece();
    dropTimer = 0;
}

function clearLines(tspin) {
    const full = [];
    for (let r = 0; r < ROWS; r++)
        if (grid[r].every(c => c !== null)) full.push(r);
    const num = full.length;
    const lv = level + 1;
    const prevB2b = b2b;

    let actionScore = 0, msg = '', isDifficult = false;

    if (tspin === 'tspin') {
        const sc = { 0: 400, 1: 800, 2: 1200, 3: 1600 };
        const ms = { 0: 'T-SPIN!', 1: 'T-SPIN SINGLE', 2: 'T-SPIN DOUBLE', 3: 'T-SPIN TRIPLE' };
        isDifficult = true;
        actionScore = (sc[num] || 0) * lv;
        msg = ms[num] || 'T-SPIN';
    } else if (tspin === 'mini') {
        const sc = { 0: 100, 1: 200, 2: 400 };
        const ms = { 0: 'MINI T-SPIN', 1: 'MINI T-SPIN SINGLE', 2: 'MINI T-SPIN DOUBLE' };
        isDifficult = num > 0;
        actionScore = (sc[num] || 0) * lv;
        msg = ms[num] || 'MINI T-SPIN';
    } else {
        const sc = { 1: 100, 2: 300, 3: 500, 4: 800 };
        const ms = { 1: 'SINGLE', 2: 'DOUBLE', 3: 'TRIPLE', 4: 'TETRIS!' };
        isDifficult = num === 4;
        actionScore = (sc[num] || 0) * lv;
        msg = ms[num] || '';
    }

    if (actionScore > 0 || num > 0) {
        if (isDifficult && prevB2b && num > 0) {
            actionScore = Math.floor(actionScore * 1.5);
            msg += ' B2B!';
        }
        if (isDifficult) b2b = true;
        else if (num > 0) b2b = false;

        score += actionScore;

        if (num > 0) {
            combo++;
            if (combo > 0) {
                score += 50 * combo * lv;
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
        lineClearAnim = { rows: full, timer: 0, total: 300, num, lv, prevB2b };
        linesCleared += num;
        const newLevel = Math.floor(linesCleared / 10);
        if (newLevel !== level) level = newLevel;
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
    messages.push({ text, x: (COLS * BLOCK) / 2, y: py, alpha: 1, vy: -1.2, life: 80 });
}

// ─── SHAKE ───────────────────────────────────────────────────────────────────
function triggerShake(intensity) {
    shakeAmt = intensity;
    shakeTimer = 350;
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
    const B = Math.max(1, Math.floor(S * 0.15)); // bevel size

    if (outlineOnly) {
        context.strokeStyle = color;
        context.lineWidth = 1;
        context.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1);
    } else {
        // Main face
        context.fillStyle = color;
        context.fillRect(px, py, S, S);

        // Top-left highlight (trapezoid)
        context.fillStyle = shadeColor(color, 0.45);
        context.beginPath();
        context.moveTo(px, py);
        context.lineTo(px + S, py);
        context.lineTo(px + S - B, py + B);
        context.lineTo(px + B, py + B);
        context.lineTo(px + B, py + S - B);
        context.lineTo(px, py + S);
        context.closePath();
        context.fill();

        // Bottom-right shadow (trapezoid)
        context.fillStyle = shadeColor(color, -0.35);
        context.beginPath();
        context.moveTo(px + S, py);
        context.lineTo(px + S, py + S);
        context.lineTo(px, py + S);
        context.lineTo(px + B, py + S - B);
        context.lineTo(px + S - B, py + S - B);
        context.lineTo(px + S - B, py + B);
        context.closePath();
        context.fill();

        // Inner face (slightly darker center to give depth)
        context.fillStyle = shadeColor(color, -0.08);
        context.fillRect(px + B, py + B, S - B * 2, S - B * 2);

        // Thin dark border
        context.strokeStyle = 'rgba(0,0,0,0.55)';
        context.lineWidth = 1;
        context.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1);
    }
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
    drawMiniPiece(hctx, heldIdx, holdCanvas.width, holdCanvas.height);
    if (mhctx) drawMiniPiece(mhctx, heldIdx, mHoldCanvas.width, mHoldCanvas.height, M_MINI);
}
function renderNext() {
    drawMiniPiece(nctx, nextIdx, nextCanvas.width, nextCanvas.height);
    if (mnctx) drawMiniPiece(mnctx, nextIdx, mNextCanvas.width, mNextCanvas.height, M_MINI);
}

function render() {
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

    // Board shake
    ctx.save();
    if (shakeTimer > 0) {
        const mag = shakeAmt * (shakeTimer / 350);
        ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
    }

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

    // Line clear animation flash
    if (lineClearAnim) {
        const t = lineClearAnim.timer / lineClearAnim.total;
        const flash = Math.abs(Math.sin(t * Math.PI * 4)) * (1 - t * 0.4);
        ctx.globalAlpha = flash;
        ctx.fillStyle = '#fff';
        for (const r of lineClearAnim.rows) {
            ctx.fillRect(0, r * BLOCK, COLS * BLOCK, BLOCK);
        }
        ctx.globalAlpha = 1;
    }

    if (!gameRunning || lineClearAnim) {
        ctx.textAlign = 'center';
        for (const m of messages) {
            ctx.globalAlpha = m.alpha;
            ctx.font = 'bold 18px Impact, Arial';
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.strokeText(m.text, m.x, m.y);
            ctx.fillText(m.text, m.x, m.y);
        }
        ctx.globalAlpha = 1;
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
                    ctx.globalAlpha = 0.18;
                    ctx.fillStyle = ghostColor;
                    ctx.fillRect((piece.x + c) * BLOCK, (gy + r) * BLOCK, BLOCK, BLOCK);
                    ctx.globalAlpha = 1;
                    ctx.strokeStyle = ghostColor;
                    ctx.lineWidth = 1;
                    ctx.strokeRect((piece.x + c) * BLOCK + 0.5, (gy + r) * BLOCK + 0.5, BLOCK - 1, BLOCK - 1);
                }
    }

    // Active piece
    for (let r = 0; r < piece.shape.length; r++)
        for (let c = 0; c < piece.shape[r].length; c++)
            if (piece.shape[r][c]) drawBlock(ctx, piece.x + c, piece.y + r, COLORS[piece.idx]);

    // Piece enter flash
    if (pieceEnterAnim > 0) {
        const flashAlpha = (pieceEnterAnim / 180) * 0.7;
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = '#ffffff';
        for (let r = 0; r < piece.shape.length; r++)
            for (let c = 0; c < piece.shape[r].length; c++)
                if (piece.shape[r][c])
                    ctx.fillRect((piece.x + c) * BLOCK + 1, (piece.y + r) * BLOCK + 1, BLOCK - 2, BLOCK - 2);
        ctx.globalAlpha = 1;
    }

    // Floating messages
    if (!lineClearAnim){
        ctx.textAlign = 'center';
        for (const m of messages) {
            ctx.globalAlpha = m.alpha;
            ctx.font = 'bold 18px Impact, Arial';
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.strokeText(m.text, m.x, m.y);
            ctx.fillText(m.text, m.x, m.y);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }
}

function updateUI() {
    document.getElementById('score-val').textContent = score;
    document.getElementById('level-val').textContent = level;
    document.getElementById('lines-val').textContent = linesCleared;
    document.getElementById('best-val').textContent = highScore;
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
        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown']) {
            if (keyHeld[key]) {
                if (now - keyPress[key] >= DAS && now - keyRepeat[key] >= ARR) {
                    keyRepeat[key] = now;
                    if (key === 'ArrowLeft') movePiece(-1, 0);
                    if (key === 'ArrowRight') movePiece(1, 0);
                    if (key === 'ArrowDown') movePiece(0, 1);
                }
            }
        }
    }

    // Shake timer
    if (shakeTimer > 0) shakeTimer = Math.max(0, shakeTimer - dt);
    if (pieceEnterAnim > 0) pieceEnterAnim = Math.max(0, pieceEnterAnim - dt);

    // Update messages
    for (const m of messages) { m.y += m.vy; m.alpha -= 1 / m.life; m.life--; }
    messages = messages.filter(m => m.life > 0);

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
        document.getElementById('new-game-btn').style.display = 'block';
        document.getElementById('resume-btn').style.display = 'block';
        lastTime = null;
        bgMusic.play().catch(() => { });
        animFrame = requestAnimationFrame(gameLoop);
    }
}

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { togglePause(); e.preventDefault(); return; }
    if (!gameRunning || gamePaused) return;
    const now = performance.now();

    if (['ArrowLeft', 'ArrowRight', 'ArrowDown'].includes(e.key) && !keyHeld[e.key]) {
        keyHeld[e.key] = true;
        keyPress[e.key] = now;
        keyRepeat[e.key] = now;
        if (e.key === 'ArrowLeft') { movePiece(-1, 0); e.preventDefault(); }
        if (e.key === 'ArrowRight') { movePiece(1, 0); e.preventDefault(); }
        if (e.key === 'ArrowDown') { movePiece(0, 1); e.preventDefault(); }
        return;
    }

    switch (e.key) {
        case 'ArrowUp': if (!e.repeat) rotatePiece(); e.preventDefault(); break;
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

// ─── INIT / RESTART ──────────────────────────────────────────────────────────
function initGame() {
    grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    bag = [];
    nextIdx = nextFromBag();
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
    lastTime = null;
    gameRunning = true;
    gamePaused = false;
    lockDelayActive = false; lockTimer = 0;
    lineClearAnim = null;
    shakeTimer = 0; shakeAmt = 0;
    lockResets = 0;
    pieceEnterAnim = 0;
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
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('tetrisHigh', highScore);
    }
    // Clear any save since the game is over
    localStorage.removeItem('tetrisSave');
    document.getElementById('load-btn').style.display = 'none';
    document.getElementById('overlay').querySelector('h1').textContent = 'GAME OVER';
    document.getElementById('final-score').style.display = 'block';
    document.getElementById('final-score').textContent = `Score: ${score}  │  Best: ${highScore}`;
    document.getElementById('start-btn').textContent = 'PLAY AGAIN';
    document.getElementById('overlay').style.display = 'flex';
}

// ─── SAVE / LOAD ──────────────────────────────────────────────────────────────
function saveGame() {
    if (!gameRunning) return;
    const state = {
        grid: grid.map(r => [...r]),
        piece: { ...piece, shape: piece.shape.map(r => [...r]) },
        nextIdx,
        heldIdx,
        canHold,
        score,
        level,
        linesCleared,
        combo,
        b2b,
        bag: [...bag],
        lastActionRotation,
        pieceRotation,
        lockResets,
        dropTimer,
    };
    localStorage.setItem('tetrisSave', JSON.stringify(state));
    document.getElementById('load-btn').style.display = 'block';
    const btn = document.getElementById('save-game-btn');
    if (btn) {
        btn.textContent = 'SAVED ✓';
        btn.disabled = true;
        setTimeout(() => { btn.textContent = 'SAVE GAME'; btn.disabled = false; }, 1500);
    }
}

function loadGame() {
    const raw = localStorage.getItem('tetrisSave');
    if (!raw) return;
    let state;
    try { state = JSON.parse(raw); } catch (e) { return; }

    grid = state.grid;
    piece = state.piece;
    nextIdx = state.nextIdx;
    heldIdx = state.heldIdx;
    canHold = state.canHold;
    score = state.score;
    level = state.level;
    linesCleared = state.linesCleared;
    combo = state.combo;
    b2b = state.b2b;
    bag = state.bag;
    lastActionRotation = state.lastActionRotation;
    pieceRotation = state.pieceRotation;
    lockResets = state.lockResets;
    dropTimer = state.dropTimer;

    messages = [];
    lastTime = null;
    gameRunning = true;
    gamePaused = false;
    lockDelayActive = false;
    lockTimer = 0;
    lineClearAnim = null;
    shakeTimer = 0;
    shakeAmt = 0;
    pieceEnterAnim = 0;

    document.getElementById('overlay').style.display = 'none';
    document.getElementById('final-score').style.display = 'none';
    document.getElementById('overlay').querySelector('h1').textContent = 'TETRIS';
    document.getElementById('pause-overlay').style.display = 'none';

    renderHold();
    renderNext();
    updateUI();
    bgMusic.currentTime = 0;
    bgMusic.play().catch(() => { });
}

document.getElementById('resume-btn').addEventListener('click', () => {
    togglePause();
});

document.getElementById('new-game-btn').addEventListener('click', () => {
    document.getElementById('confirm-panel').style.display = 'block';
    document.getElementById('new-game-btn').style.display = 'none';
    document.getElementById('resume-btn').style.display = 'none';
    document.getElementById('save-game-btn').style.display = 'none';
});

document.getElementById('confirm-yes').addEventListener('click', () => {
    document.getElementById('confirm-panel').style.display = 'none';
    document.getElementById('new-game-btn').style.display = 'block';
    document.getElementById('resume-btn').style.display = 'block';
    document.getElementById('save-game-btn').style.display = 'block';
    document.getElementById('pause-overlay').style.display = 'none';
    gamePaused = false;
    cancelAnimationFrame(animFrame);
    // Clear save since user explicitly started a new game
    localStorage.removeItem('tetrisSave');
    document.getElementById('load-btn').style.display = 'none';
    initGame();
    animFrame = requestAnimationFrame(gameLoop);
});

document.getElementById('confirm-no').addEventListener('click', () => {
    document.getElementById('confirm-panel').style.display = 'none';
    document.getElementById('new-game-btn').style.display = 'block';
    document.getElementById('resume-btn').style.display = 'block';
    document.getElementById('save-game-btn').style.display = 'block';
});

document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('final-score').style.display = 'none';
    document.getElementById('overlay').querySelector('h1').textContent = 'TETRIS';
    initGame();
    animFrame = requestAnimationFrame(gameLoop);
});

document.getElementById('save-game-btn').addEventListener('click', () => {
    saveGame();
});

document.getElementById('load-btn').addEventListener('click', () => {
    loadGame();
    animFrame = requestAnimationFrame(gameLoop);
});

// Initial render of empty board + show saved best score
document.getElementById('best-val').textContent = highScore;
// Show load button if a save exists
if (localStorage.getItem('tetrisSave')) {
    document.getElementById('load-btn').style.display = 'block';
}
render();

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
    setupBtn('tb-rotate', () => rotatePiece(), false);
    setupBtn('tb-hard', () => hardDrop(), false);
    setupBtn('tb-hold', () => holdPiece(), false);

    // Mobile pause button
    const mPause = document.getElementById('m-pause');
    if (mPause) {
        mPause.addEventListener('click', (e) => { e.preventDefault(); togglePause(); });
    }
})();

// Update mobile stat bar alongside desktop UI
const origUpdateUI = updateUI;
updateUI = function () {
    origUpdateUI();
    const ms = document.getElementById('m-score');
    const ml = document.getElementById('m-level');
    const mn = document.getElementById('m-lines');
    if (ms) ms.textContent = score;
    if (ml) ml.textContent = level;
    if (mn) mn.textContent = linesCleared;
};

// Prevent default touch behavior on game area to stop scrolling/zooming
// but allow buttons/controls to work normally
document.body.addEventListener('touchmove', e => {
    const t = e.target;
    if (t.closest('#mobile-controls') || t.closest('#mobile-top-bar') || t.closest('#overlay') || t.closest('#pause-overlay')) return;
    if (gameRunning) e.preventDefault();
}, { passive: false });