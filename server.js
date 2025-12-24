const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve static files - try both root and public folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Fallback route cho index.html
app.get('/', (req, res) => {
    const publicPath = path.join(__dirname, 'public', 'index.html');
    const rootPath = path.join(__dirname, 'index.html');
    const fs = require('fs');

    if (fs.existsSync(publicPath)) {
        res.sendFile(publicPath);
    } else if (fs.existsSync(rootPath)) {
        res.sendFile(rootPath);
    } else {
        res.send('<h1>Flappy Heart Server đang chạy! File index.html không tìm thấy.</h1>');
    }
});


// Game Constants
const GRAVITY = 0.4;
const JUMP_FORCE = -9;
const PIPE_SPEED = 4;
const PIPE_GAP = 200;
const PIPE_WIDTH = 70;

const rooms = {};

io.on('connection', (socket) => {
    console.log('💖 Player connected:', socket.id);

    socket.on('join', ({ name, avatar }) => {
        // Find or create room
        let roomId = Object.keys(rooms).find(id =>
            rooms[id].players.length < 2 && !rooms[id].started
        );

        if (!roomId) {
            roomId = 'room_' + Date.now();
            rooms[roomId] = {
                players: [],
                pipes: [],
                started: false,
                lastPipe: 0,
                countdown: 3
            };
        }

        const player = {
            id: socket.id,
            name: name || 'Player',
            avatar: avatar || '💖',
            x: 150,
            y: 300,
            velocity: 0,
            score: 0,
            alive: true
        };

        rooms[roomId].players.push(player);
        socket.join(roomId);
        socket.roomId = roomId;

        socket.emit('joined', {
            roomId,
            playerId: socket.id,
            playerNum: rooms[roomId].players.length
        });

        io.to(roomId).emit('players', rooms[roomId].players);

        // Start when 2 players
        if (rooms[roomId].players.length === 2) {
            startCountdown(roomId);
        }
    });

    socket.on('flap', () => {
        const room = rooms[socket.roomId];
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player && player.alive && room.started) {
            player.velocity = JUMP_FORCE;
        }
    });

    socket.on('disconnect', () => {
        console.log('💔 Player disconnected:', socket.id);
        const room = rooms[socket.roomId];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[socket.roomId];
            } else {
                io.to(socket.roomId).emit('playerLeft');
            }
        }
    });
});

function startCountdown(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    io.to(roomId).emit('countdown', 3);

    let count = 3;
    const countInterval = setInterval(() => {
        count--;
        if (count > 0) {
            io.to(roomId).emit('countdown', count);
        } else {
            clearInterval(countInterval);
            room.started = true;
            io.to(roomId).emit('start');
            gameLoop(roomId);
        }
    }, 1000);
}

function gameLoop(roomId) {
    const room = rooms[roomId];
    if (!room || !room.started) return;

    const loop = setInterval(() => {
        if (!rooms[roomId] || !room.started) {
            clearInterval(loop);
            return;
        }

        const now = Date.now();

        // Spawn pipes
        if (now - room.lastPipe > 2000) {
            room.lastPipe = now;
            const gapY = 120 + Math.random() * 280;
            room.pipes.push({
                x: 900,
                gapY,
                passed: false
            });
        }

        // Update pipes
        for (let i = room.pipes.length - 1; i >= 0; i--) {
            room.pipes[i].x -= PIPE_SPEED;

            // Score when passed
            if (!room.pipes[i].passed && room.pipes[i].x + PIPE_WIDTH < 150) {
                room.pipes[i].passed = true;
                room.players.forEach(p => {
                    if (p.alive) p.score++;
                });
            }

            // Remove off-screen pipes
            if (room.pipes[i].x < -PIPE_WIDTH) {
                room.pipes.splice(i, 1);
            }
        }

        // Update players
        room.players.forEach(player => {
            if (!player.alive) return;

            player.velocity += GRAVITY;
            player.y += player.velocity;

            // Bounds check
            if (player.y < 30 || player.y > 570) {
                player.alive = false;
            }

            // Pipe collision
            room.pipes.forEach(pipe => {
                if (player.x > pipe.x - 25 && player.x < pipe.x + PIPE_WIDTH) {
                    if (player.y < pipe.gapY || player.y > pipe.gapY + PIPE_GAP) {
                        player.alive = false;
                    }
                }
            });
        });

        // Send state
        io.to(roomId).emit('state', {
            players: room.players,
            pipes: room.pipes
        });

        // Check game over
        const alive = room.players.filter(p => p.alive);
        if (alive.length === 0 || (room.players.length === 2 && alive.length === 1)) {
            const winner = alive[0] || room.players.reduce((a, b) =>
                a.score > b.score ? a : b
            );

            io.to(roomId).emit('gameOver', {
                winner: winner.name,
                winnerAvatar: winner.avatar,
                scores: room.players.map(p => ({
                    name: p.name,
                    avatar: p.avatar,
                    score: p.score,
                    isWinner: p.id === winner.id
                }))
            });

            room.started = false;
            clearInterval(loop);
        }
    }, 1000 / 60); // 60 FPS
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`💖 Flappy Heart Multiplayer Server on port ${PORT}`);
});
