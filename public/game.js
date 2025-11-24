const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const socket = io();

// UI Elements
const loginScreen = document.getElementById('login-screen');
const usernameInput = document.getElementById('username');
const roomInput = document.getElementById('room-code');
const playBtn = document.getElementById('play-btn');
const scoreBoard = document.getElementById('score-board');

let myId = null;
let players = {}; // Current interpolated state
let targetPlayers = {}; // State from server
let food = [];
let mapSize = 2000;
let camera = { x: 0, y: 0 };
let isPlaying = false;

// Resize canvas
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// Input Handling
playBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim() || 'Guest';
    const room = roomInput.value.trim() || '1';

    socket.emit('joinRoom', { roomId: room, playerName: name });
    loginScreen.style.display = 'none';
    isPlaying = true;
});

canvas.addEventListener('mousemove', (e) => {
    if (!isPlaying) return;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    socket.emit('input', angle);
});

canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Left click
        socket.emit('boost', true);
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) {
        socket.emit('boost', false);
    }
});

// Keyboard Input (Space to boost)
let isSpacePressed = false;
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isSpacePressed) {
        isSpacePressed = true;
        socket.emit('boost', true);
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        isSpacePressed = false;
        socket.emit('boost', false);
    }
});

// Socket Events
socket.on('connect', () => {
    myId = socket.id;
});

socket.on('roomJoined', (data) => {
    mapSize = data.mapSize;
});

socket.on('gameState', (state) => {
    targetPlayers = state.players;
    food = state.food;

    // Initialize players if empty (first connect)
    if (Object.keys(players).length === 0) {
        players = JSON.parse(JSON.stringify(targetPlayers));
    }
});

socket.on('dead', () => {
    loginScreen.style.display = 'flex';
    isPlaying = false;
    myId = socket.id; // Ensure ID is ready for next join
});

// FPS Counter
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;

// Game Loop
function loop() {
    requestAnimationFrame(loop);

    // Calculate FPS
    const now = performance.now();
    frameCount++;
    if (now - lastTime >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastTime = now;
    }

    update();
    draw();
}
loop();

function update() {
    // Interpolate players towards target
    const lerpFactor = 0.1; // Smoothing factor

    for (const id in targetPlayers) {
        if (!players[id]) {
            players[id] = targetPlayers[id];
            continue;
        }

        const p = players[id];
        const t = targetPlayers[id];

        // Interpolate position
        p.x += (t.x - p.x) * lerpFactor;
        p.y += (t.y - p.y) * lerpFactor;
        p.angle = t.angle; // Direct update for angle usually better or needs smart lerp
        p.score = t.score;
        p.name = t.name;
        p.color = t.color;

        // Interpolate body
        // For body, it's complex to interpolate every segment. 
        // We can just take the target body for simplicity or lerp head and shift body.
        // For now, let's just copy body to avoid visual glitches with lerp
        p.body = t.body;
    }

    // Remove disconnected players
    for (const id in players) {
        if (!targetPlayers[id]) {
            delete players[id];
        }
    }

    // Update camera
    if (isPlaying && players[myId]) {
        scoreBoard.innerText = `Score: ${players[myId].score}`;
        camera.x = players[myId].x;
        camera.y = players[myId].y;
    }
}

// Rendering
function draw() {
    // Clear screen
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();

    // Camera transform
    ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);

    // Draw Map Boundary
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 5;
    ctx.strokeRect(-mapSize / 2, -mapSize / 2, mapSize, mapSize);

    // Draw Grid
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    for (let x = -mapSize / 2; x <= mapSize / 2; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, -mapSize / 2);
        ctx.lineTo(x, mapSize / 2);
        ctx.stroke();
    }
    for (let y = -mapSize / 2; y <= mapSize / 2; y += 50) {
        ctx.beginPath();
        ctx.moveTo(-mapSize / 2, y);
        ctx.lineTo(mapSize / 2, y);
        ctx.stroke();
    }

    // Draw Food
    food.forEach(f => {
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 5, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw Players
    for (const id in players) {
        const p = players[id];

        // Draw Body
        ctx.lineWidth = 20; // Snake width
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = p.color;

        if (p.body.length > 0) {
            ctx.beginPath();
            ctx.moveTo(p.body[0].x, p.body[0].y);
            for (let i = 1; i < p.body.length; i++) {
                ctx.lineTo(p.body[i].x, p.body[i].y);
            }
            ctx.stroke();
        }

        // Draw Head
        ctx.fillStyle = '#fff'; // Eye color
        const eyeOffX = Math.cos(p.angle - 0.5) * 8;
        const eyeOffY = Math.sin(p.angle - 0.5) * 8;
        const eyeOffX2 = Math.cos(p.angle + 0.5) * 8;
        const eyeOffY2 = Math.sin(p.angle + 0.5) * 8;

        ctx.beginPath();
        ctx.arc(p.x + eyeOffX, p.y + eyeOffY, 4, 0, Math.PI * 2);
        ctx.arc(p.x + eyeOffX2, p.y + eyeOffY2, 4, 0, Math.PI * 2);
        ctx.fill();

        // Draw Name
        ctx.fillStyle = '#fff';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, p.x, p.y - 15);
    }

    ctx.restore();

    // Draw FPS (Top Left)
    ctx.fillStyle = '#0f0';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`FPS: ${fps}`, 10, 20);

    // Draw Minimap (Top Right)
    drawMinimap();
}

function drawMinimap() {
    const mapSizeDisplay = 150;
    const margin = 10;
    const x = canvas.width - mapSizeDisplay - margin;
    const y = margin;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, y, mapSizeDisplay, mapSizeDisplay);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, mapSizeDisplay, mapSizeDisplay);

    // Scale factor
    const scale = mapSizeDisplay / mapSize;

    // Draw players on minimap
    for (const id in players) {
        const p = players[id];

        // Map coordinates (-mapSize/2 to mapSize/2) to (0 to mapSizeDisplay)
        const mx = x + (p.x + mapSize / 2) * scale;
        const my = y + (p.y + mapSize / 2) * scale;

        ctx.fillStyle = id === myId ? '#0f0' : '#f00';
        ctx.beginPath();
        ctx.arc(mx, my, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}
