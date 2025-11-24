const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Game State
const rooms = {};
const TICK_RATE = 30; // Updates per second
const MAP_SIZE = 2000;
const INITIAL_LENGTH = 5;
const SPEED = 5; // Normal speed
const BOOST_SPEED = 10; // 2x Speed
const INITIAL_SCORE = 100; // Start with more score

function createRoom(roomId) {
    rooms[roomId] = {
        players: {},
        food: [],
        lastUpdate: Date.now(),
        tickCount: 0
    };
    // Generate initial food
    for (let i = 0; i < 100; i++) {
        rooms[roomId].food.push(generateFood());
    }
}

function generateFood() {
    return {
        x: Math.random() * MAP_SIZE - MAP_SIZE / 2,
        y: Math.random() * MAP_SIZE - MAP_SIZE / 2,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`
    };
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', ({ roomId, playerName }) => {
        socket.join(roomId);

        if (!rooms[roomId]) {
            createRoom(roomId);
        }

        // Initialize player
        rooms[roomId].players[socket.id] = {
            id: socket.id,
            name: playerName,
            x: Math.random() * 500 - 250,
            y: Math.random() * 500 - 250,
            angle: 0,
            length: INITIAL_LENGTH,
            body: [], // Array of {x, y}
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            score: INITIAL_SCORE,
            isBoosting: false
        };

        // Initialize body segments
        for (let i = 0; i < INITIAL_LENGTH; i++) {
            rooms[roomId].players[socket.id].body.push({
                x: rooms[roomId].players[socket.id].x,
                y: rooms[roomId].players[socket.id].y
            });
        }

        socket.roomId = roomId;
        socket.emit('roomJoined', { roomId, mapSize: MAP_SIZE });
    });

    socket.on('input', (angle) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
            rooms[roomId].players[socket.id].angle = angle;
        }
    });

    socket.on('boost', (isBoosting) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId] && rooms[roomId].players[socket.id]) {
            rooms[roomId].players[socket.id].isBoosting = isBoosting;
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            delete rooms[roomId].players[socket.id];
            if (Object.keys(rooms[roomId].players).length === 0) {
                delete rooms[roomId]; // Clean up empty rooms
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

// Game Loop
setInterval(() => {
    for (const roomId in rooms) {
        const room = rooms[roomId];
        const players = room.players;
        room.tickCount++;

        // Move players
        for (const playerId in players) {
            const player = players[playerId];

            let currentSpeed = SPEED;

            // Handle Boosting
            if (player.isBoosting && player.score > 10) { // Minimum score to boost
                currentSpeed = BOOST_SPEED;

                // Consume score slower (every 5 ticks)
                if (room.tickCount % 5 === 0) {
                    player.score -= 1;

                    // Drop residue (food) behind
                    const tail = player.body[player.body.length - 1];
                    if (tail) {
                        room.food.push({
                            x: tail.x + (Math.random() * 10 - 5),
                            y: tail.y + (Math.random() * 10 - 5),
                            color: player.color
                        });
                    }
                }
            } else {
                player.isBoosting = false; // Stop boosting if score is too low
            }

            // Move head
            player.x += Math.cos(player.angle) * currentSpeed;
            player.y += Math.sin(player.angle) * currentSpeed;

            // Boundary checks
            if (player.x < -MAP_SIZE / 2) player.x = -MAP_SIZE / 2;
            if (player.x > MAP_SIZE / 2) player.x = MAP_SIZE / 2;
            if (player.y < -MAP_SIZE / 2) player.y = -MAP_SIZE / 2;
            if (player.y > MAP_SIZE / 2) player.y = MAP_SIZE / 2;

            // Update body
            player.body.unshift({ x: player.x, y: player.y });
            while (player.body.length > player.length) {
                player.body.pop();
            }

            // Check food collision
            for (let i = room.food.length - 1; i >= 0; i--) {
                const f = room.food[i];
                const dist = Math.hypot(player.x - f.x, player.y - f.y);
                if (dist < 20) { // Food radius + Head radius approx
                    player.length += 1;
                    player.score += 10;
                    room.food.splice(i, 1);
                    room.food.push(generateFood());
                }
            }
        }

        // Collision detection (Player vs Player)
        // Simplified: Check head vs other players' bodies
        const deadPlayers = [];
        for (const playerId in players) {
            const player = players[playerId];
            let dead = false;

            for (const otherId in players) {
                if (playerId === otherId) continue;
                const other = players[otherId];

                for (const segment of other.body) {
                    const dist = Math.hypot(player.x - segment.x, player.y - segment.y);
                    if (dist < 10) { // Collision threshold
                        dead = true;
                        break;
                    }
                }
                if (dead) break;
            }

            if (dead) {
                deadPlayers.push(playerId);
            }
        }

        // Handle deaths
        deadPlayers.forEach(pid => {
            const p = players[pid];
            // Turn body into food
            p.body.forEach((seg, index) => {
                if (index % 2 === 0) { // Don't spawn food for every segment to save perf
                    room.food.push({
                        x: seg.x,
                        y: seg.y,
                        color: p.color
                    });
                }
            });

            // Remove player from room
            delete rooms[roomId].players[pid];

            io.to(pid).emit('dead');
        });

        // Broadcast state
        io.to(roomId).emit('gameState', {
            players: room.players,
            food: room.food
        });
    }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
