const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Deck, evaluateHand } = require('./poker');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// --- GAME STATE ---
const rooms = {}; 

// Constants
const STARTING_CHIPS = 200;
const SMALL_BLIND = 1;
const BIG_BLIND = 2;
const TURN_TIMEOUT_SEC = 20;

// --- HELPER FUNCTIONS ---

function getRoom(roomId) {
    return rooms[roomId];
}

function broadcastRoomState(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // Sanitize state for clients
    const publicPlayers = room.players.map(p => ({
        id: p.id,
        nickname: p.nickname,
        chips: p.chips,
        seatIndex: p.seatIndex,
        status: p.status, // 'active', 'folded', 'all-in', 'sitting-out'
        bet: p.currentBet,
        isDealer: p.seatIndex === room.dealerIndex,
        isSB: p.seatIndex === room.sbIndex,
        isBB: p.seatIndex === room.bbIndex,
        isTurn: room.gameStatus === 'playing' && p.seatIndex === room.currentTurnIndex,
        cards: room.gameStatus === 'showdown' ? p.hand : null, // Show cards only at showdown
        hasCards: p.hand.length > 0
    }));

    io.to(roomId).emit('roomStateUpdate', {
        roomId: room.id,
        status: room.gameStatus, // 'waiting', 'playing'
        communityCards: room.communityCards,
        pot: room.pot,
        currentBet: room.highestBet,
        players: publicPlayers,
        minPlayers: room.minPlayers
    });
}

function nextTurn(room) {
    if(room.gameStatus !== 'playing') return;

    clearTimeout(room.turnTimer);

    // Find next active player
    let playersChecked = 0;
    let nextIndex = (room.currentTurnIndex + 1) % 9; // Max seats 9

    while (playersChecked < 9) {
        const p = room.players.find(pl => pl.seatIndex === nextIndex);
        if (p && p.status === 'active' && p.chips > 0) {
            room.currentTurnIndex = nextIndex;
            startTurnTimer(room, p);
            return;
        }
        nextIndex = (nextIndex + 1) % 9;
        playersChecked++;
    }

    // If loop finishes, round might be over
    checkRoundEnd(room);
}

function checkRoundEnd(room) {
    if (room.gameStatus !== 'playing') return true;

    // Are all active players bets equal to highest bet?
    const activePlayers = room.players.filter(p => p.status === 'active' || p.status === 'all-in');
    const bettingPlayers = activePlayers.filter(p => p.status === 'active'); // Not all-in

    // If only 1 player left (everyone else folded)
    const foldedCount = room.players.filter(p => p.status === 'folded').length;
    const totalInHand = room.players.filter(p => p.hand.length > 0).length;
    
    if (totalInHand - foldedCount === 1) {
        endHand(room);
        return true;
    }

    // Check if betting is done
    const allMatched = bettingPlayers.every(p => p.currentBet === room.highestBet);
    
    // Check if everyone checked (bet 0) or everyone matched bets
    // Also make sure everyone had a chance to act if there was no raise? 
    // Simplified: If all matched and we circled back to the original raiser/BB
    
    // We use a simplified flag 'actionClosed' which we would need to track more complexly.
    // Instead, let's assume if everyone matched and last actor wasn't a raise that requires response.
    
    // Easier: Count actions. If everyone acted >= 1 time and bets match -> Next Street.
    const pendingAction = bettingPlayers.some(p => p.actedInRound === false || p.currentBet < room.highestBet);
    
    if (!pendingAction) {
        nextStreet(room);
        return true;
    }

    return false;
}

function startTurnTimer(room, player) {
    broadcastRoomState(room.id);
    
    // Send specific turn event to active player
    const minRaise = (room.highestBet - player.currentBet) + (room.lastRaiseAmount || BIG_BLIND);
    const callAmount = room.highestBet - player.currentBet;
    
    io.to(player.id).emit('yourTurn', {
        callAmount: callAmount,
        minRaise: room.highestBet + (room.lastRaiseAmount || BIG_BLIND),
        canCheck: callAmount === 0
    });

    room.turnTimer = setTimeout(() => {
        console.log(`Turn timeout for ${player.nickname}`);
        handlePlayerAction(room, player, { action: 'fold' });
    }, TURN_TIMEOUT_SEC * 1000);
}

function nextStreet(room) {
    // Gather bets into pot
    room.players.forEach(p => {
        room.pot += p.currentBet;
        p.currentBet = 0;
        p.actedInRound = false;
    });
    room.highestBet = 0;
    room.lastRaiseAmount = BIG_BLIND;

    if (room.roundName === 'preflop') {
        room.roundName = 'flop';
        room.communityCards = room.deck.deal() ? [room.deck.deal(), room.deck.deal(), room.deck.deal()] : []; // Deal 3
    } else if (room.roundName === 'flop') {
        room.roundName = 'turn';
        room.communityCards.push(room.deck.deal());
    } else if (room.roundName === 'turn') {
        room.roundName = 'river';
        room.communityCards.push(room.deck.deal());
    } else if (room.roundName === 'river') {
        endHand(room);
        return;
    }

    // Reset turn to first active player left of Dealer
    let nextIdx = (room.dealerIndex + 1) % 9;
    room.currentTurnIndex = nextIdx - 1; // -1 because nextTurn adds 1
    
    // Check if hand ended during street transition (e.g. all all-in)
    const active = room.players.filter(p => p.status === 'active');
    if (active.length < 2) {
        // Auto-run remaining streets
        while(room.communityCards.length < 5) {
            room.communityCards.push(room.deck.deal());
        }
        endHand(room);
        return;
    }

    nextTurn(room);
    broadcastRoomState(room.id);
}

function endHand(room) {
    room.gameStatus = 'showdown';
    clearTimeout(room.turnTimer);

    // 1. Determine candidates
    const candidates = room.players.filter(p => p.status !== 'folded' && p.status !== 'sitting-out' && p.hand.length > 0);
    
    if (candidates.length === 1) {
        // Winner by default
        const winner = candidates[0];
        winner.chips += room.pot;
        io.to(room.id).emit('handResult', { 
            message: `${winner.nickname} wins ${room.pot} chips (everyone else folded).`
        });
    } else {
        // Showdown
        let results = candidates.map(p => {
            const eval = evaluateHand(p.hand, room.communityCards);
            return { player: p, score: eval.score, name: eval.name, handName: eval.name };
        });

        // Sort by score descending
        results.sort((a, b) => b.score - a.score);
        
        const winnerResult = results[0];
        // Handle ties (simplified: if scores equal, split pot)
        const winners = results.filter(r => r.score === winnerResult.score);
        
        const splitAmount = Math.floor(room.pot / winners.length);
        const winnerNames = [];

        winners.forEach(w => {
            w.player.chips += splitAmount;
            winnerNames.push(`${w.player.nickname} (${w.handName})`);
        });

        io.to(room.id).emit('handResult', { 
            message: `Winner(s): ${winnerNames.join(', ')}. Pot: ${room.pot}`,
            winners: winners.map(w => w.player.id)
        });
    }

    // Reset for next hand
    setTimeout(() => {
        startNextHandOrWait(room);
    }, 8000); // 8 seconds to see results

    broadcastRoomState(room.id);
}

function startNextHandOrWait(room) {
    // Reset player states
    room.players.forEach(p => {
        p.hand = [];
        p.currentBet = 0;
        p.actedInRound = false;
        if (p.status !== 'sitting-out') {
            p.status = p.chips > 0 ? 'waiting' : 'busted';
        }
    });
    room.pot = 0;
    room.communityCards = [];
    room.gameStatus = 'waiting';

    // Check conditions to start new hand
    const readyPlayers = room.players.filter(p => p.status === 'waiting' || p.status === 'active' || p.status === 'ready');
    
    // Need min 5 players with chips
    const playersWithChips = readyPlayers.filter(p => p.chips > 0);

    if (playersWithChips.length >= room.minPlayers) {
        startGame(room);
    } else {
        broadcastRoomState(room.id);
        io.to(room.id).emit('notification', "Waiting for more players or rebuys (Min 5)...");
    }
}

function startGame(room) {
    room.gameStatus = 'playing';
    room.deck = new Deck();
    room.pot = 0;
    room.communityCards = [];
    room.highestBet = 0;
    room.roundName = 'preflop';
    
    // Move dealer button
    // Find next seated player
    let attempts = 0;
    do {
        room.dealerIndex = (room.dealerIndex + 1) % 9;
        attempts++;
    } while (!room.players.find(p => p.seatIndex === room.dealerIndex) && attempts < 9);

    // Identify players in this hand
    const playersInHand = room.players.filter(p => p.chips > 0 && p.status !== 'sitting-out');
    
    if (playersInHand.length < 2) {
        room.gameStatus = 'waiting';
        broadcastRoomState(room.id);
        return;
    }

    playersInHand.forEach(p => {
        p.status = 'active';
        p.hand = [room.deck.deal(), room.deck.deal()];
        p.currentBet = 0;
        p.actedInRound = false;
        // Send private cards
        io.to(p.id).emit('holeCards', p.hand);
    });

    // Blinds
    // Sort players by seat index to find SB/BB logic relative to dealer
    // Simplified: find active player closest to left of dealer
    const sortedSeats = playersInHand.sort((a, b) => a.seatIndex - b.seatIndex);
    
    const getNextPlayer = (fromIndex) => {
        // Circular find next active player
        let seats = [0,1,2,3,4,5,6,7,8];
        // Shift array so fromIndex is at end, search from start
        // Actually easier: just loop 1 to 9
        for(let i=1; i<=9; i++) {
            let idx = (fromIndex + i) % 9;
            let p = playersInHand.find(pl => pl.seatIndex === idx);
            if (p) return p;
        }
        return playersInHand[0];
    };

    const dealer = playersInHand.find(p => p.seatIndex === room.dealerIndex) || playersInHand[0];
    const sbPlayer = getNextPlayer(dealer.seatIndex);
    const bbPlayer = playersInHand.length === 2 ? dealer : getNextPlayer(sbPlayer.seatIndex); // Headsup rules different usually, but stick to standard
    
    room.sbIndex = sbPlayer.seatIndex;
    room.bbIndex = bbPlayer.seatIndex;

    // Post Blinds
    // SB
    let sbAmt = Math.min(sbPlayer.chips, SMALL_BLIND);
    sbPlayer.chips -= sbAmt;
    sbPlayer.currentBet = sbAmt;
    
    // BB
    let bbAmt = Math.min(bbPlayer.chips, BIG_BLIND);
    bbPlayer.chips -= bbAmt;
    bbPlayer.currentBet = bbAmt;

    room.highestBet = BIG_BLIND;
    room.lastRaiseAmount = BIG_BLIND;

    // Start turn: Under the Gun (left of BB)
    const utgPlayer = getNextPlayer(bbPlayer.seatIndex);
    room.currentTurnIndex = utgPlayer.seatIndex;

    broadcastRoomState(room.id);
    startTurnTimer(room, utgPlayer);
}

function handlePlayerAction(room, player, data) {
    const { action, amount } = data;
    
    if (room.gameStatus !== 'playing') return;
    if (player.seatIndex !== room.currentTurnIndex) return;

    clearTimeout(room.turnTimer);

    // Validation logic
    const toCall = room.highestBet - player.currentBet;

    if (action === 'fold') {
        player.status = 'folded';
        io.to(room.id).emit('notification', `${player.nickname} folds.`);
    } else if (action === 'check') {
        if (toCall > 0) {
            // Tried to check but needs to call -> reject or force fold? Force fold for simplicity
             player.status = 'folded'; 
        } else {
            io.to(room.id).emit('notification', `${player.nickname} checks.`);
        }
    } else if (action === 'call') {
        const contribution = Math.min(player.chips, toCall);
        player.chips -= contribution;
        player.currentBet += contribution;
        if (player.chips === 0) player.status = 'all-in';
        io.to(room.id).emit('notification', `${player.nickname} calls.`);
    } else if (action === 'bet' || action === 'raise') {
        let raiseTotal = parseInt(amount);
        if (isNaN(raiseTotal)) raiseTotal = room.highestBet + BIG_BLIND; // Fallback
        
        // Check min raise
        const minTotal = room.highestBet + (room.lastRaiseAmount || BIG_BLIND);
        if (raiseTotal < minTotal && raiseTotal < (player.chips + player.currentBet)) {
            // Invalid raise, treat as call
            raiseTotal = minTotal; 
        }

        const needed = raiseTotal - player.currentBet;
        if (needed > player.chips) {
            // Not enough chips, treat as All-in
            const actualBet = player.chips + player.currentBet;
            player.chips = 0;
            player.currentBet = actualBet;
            player.status = 'all-in';
            if (actualBet > room.highestBet) {
                room.lastRaiseAmount = actualBet - room.highestBet;
                room.highestBet = actualBet;
            }
            io.to(room.id).emit('notification', `${player.nickname} is All-in!`);
        } else {
            player.chips -= needed;
            player.currentBet += needed;
            const diff = player.currentBet - room.highestBet;
            if (diff > 0) room.lastRaiseAmount = diff;
            room.highestBet = player.currentBet;
            io.to(room.id).emit('notification', `${player.nickname} raises to ${room.highestBet}.`);
        }
        
        // Re-open betting for others
        room.players.filter(p => p.status === 'active' && p.id !== player.id).forEach(p => p.actedInRound = false);
    } else if (action === 'all-in') {
         const total = player.chips + player.currentBet;
         player.chips = 0;
         player.currentBet = total;
         player.status = 'all-in';
         if (total > room.highestBet) {
             room.lastRaiseAmount = total - room.highestBet;
             room.highestBet = total;
             // Re-open betting
             room.players.filter(p => p.status === 'active' && p.id !== player.id).forEach(p => p.actedInRound = false);
         }
         io.to(room.id).emit('notification', `${player.nickname} goes All-in!`);
    }

    player.actedInRound = true;
    broadcastRoomState(room.id);

    // Advance betting round if everyone has acted; otherwise continue to the next player
    const roundClosed = checkRoundEnd(room);
    if (!roundClosed) {
        nextTurn(room);
    }
}


// --- SOCKET IO HANDLERS ---

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    socket.on('joinRoom', ({ roomName, nickname }) => {
        let room = rooms[roomName];
        if (!room) {
            // Create Room
            room = {
                id: roomName,
                players: [],
                gameStatus: 'waiting', // waiting, playing, showdown
                minPlayers: 5,
                dealerIndex: 0,
                pot: 0,
                communityCards: [],
                deck: null,
                turnTimer: null
            };
            rooms[roomName] = room;
        }

        if (room.players.length >= 9) {
            socket.emit('error', 'Room is full');
            return;
        }

        // Assign Seat
        const takenSeats = room.players.map(p => p.seatIndex);
        let seat = 0;
        while (takenSeats.includes(seat)) seat++;

        const player = {
            id: socket.id,
            nickname: nickname.substring(0, 12),
            chips: STARTING_CHIPS,
            seatIndex: seat,
            status: 'waiting',
            hand: [],
            currentBet: 0,
            actedInRound: false
        };

        room.players.push(player);
        socket.join(room.id);

        // Broadcast
        io.to(room.id).emit('notification', `${player.nickname} joined the table.`);
        broadcastRoomState(room.id);
    });

    socket.on('startGameRequest', () => {
        // Any player can request start if min players met
        const room = Object.values(rooms).find(r => r.players.find(p => p.id === socket.id));
        if (!room) return;
        
        if (room.gameStatus !== 'waiting') return;
        if (room.players.length < room.minPlayers) {
             socket.emit('error', `Need at least ${room.minPlayers} players.`);
             return;
        }

        startGame(room);
    });

    socket.on('action', (data) => {
        const room = Object.values(rooms).find(r => r.players.find(p => p.id === socket.id));
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            handlePlayerAction(room, player, data);
        }
    });

    socket.on('requestRebuy', () => {
        const room = Object.values(rooms).find(r => r.players.find(p => p.id === socket.id));
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        
        // Only rebuy between hands
        if (room.gameStatus !== 'waiting' && room.gameStatus !== 'showdown') { // Actually showdown is technically playing, safest is waiting
             // Allow queued rebuy or just reject?
             if(player.chips === 0) {
                 // If player is busted, they are sitting waiting. 
                 // We can allow rebuy if they are not in a hand.
                 if (player.status === 'busted' || player.status === 'waiting') {
                    player.chips += 200;
                    player.status = 'waiting';
                    io.to(room.id).emit('notification', `${player.nickname} rebought 200 chips.`);
                    broadcastRoomState(room.id);
                 }
             }
             return;
        }

        if (player.chips <= 0) {
            player.chips += 200;
            io.to(room.id).emit('notification', `${player.nickname} rebought 200 chips.`);
            broadcastRoomState(room.id);
        }
    });

    socket.on('disconnect', () => {
        const room = Object.values(rooms).find(r => r.players.find(p => p.id === socket.id));
        if (room) {
            const pIndex = room.players.findIndex(p => p.id === socket.id);
            if (pIndex !== -1) {
                const p = room.players[pIndex];
                // If game is playing, just mark as folded/sitting out
                if (room.gameStatus === 'playing') {
                    p.status = 'folded';
                    // If it was their turn, advance
                    if (p.seatIndex === room.currentTurnIndex) {
                        handlePlayerAction(room, p, { action: 'fold' });
                    }
                    // Remove from room eventually? For now just leave 'ghost' until hand ends or restart
                    room.players.splice(pIndex, 1); 
                } else {
                    room.players.splice(pIndex, 1);
                }
                
                io.to(room.id).emit('notification', `${p.nickname} left.`);
                broadcastRoomState(room.id);
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
