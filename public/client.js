const socket = io();

// State
let mySeatIndex = -1;
let myChips = 0;
let currentTurn = false;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const seatsContainer = document.getElementById('seats-container');
const commCardsContainer = document.getElementById('community-cards');
const notification = document.getElementById('notification');
const actionControls = document.getElementById('action-controls');
const btnStart = document.getElementById('btnStart');
const btnRebuy = document.getElementById('btnRebuy');

// --- JOIN LOGIC ---
document.getElementById('btnJoin').onclick = () => {
    const nickname = document.getElementById('nickname').value;
    const roomName = document.getElementById('roomName').value;
    if(!nickname || !roomName) return alert("Please enter name and room");
    
    socket.emit('joinRoom', { nickname, roomName });
    document.getElementById('room-id-display').innerText = roomName;
    
    loginScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
};

// --- SOCKET EVENTS ---

socket.on('error', (msg) => {
    alert(msg);
    location.reload();
});

socket.on('notification', (msg) => {
    notification.innerText = msg;
    setTimeout(() => { notification.innerText = ''; }, 3000);
});

socket.on('holeCards', (cards) => {
    // These are my private cards
    // We render them inside renderRoomState, but we store them temporarily here?
    // Actually, we can just store them in a global var or rely on them being rendered when state updates
    // But roomStateUpdate usually hides cards. 
    // Let's store them locally to render into my seat.
    window.myHoleCards = cards;
    renderMyCards();
});

socket.on('roomStateUpdate', (state) => {
    renderTable(state);
});

socket.on('yourTurn', (data) => {
    const { callAmount, minRaise, canCheck } = data;
    actionControls.style.display = 'flex';
    document.getElementById('btnCheck').style.display = canCheck ? 'inline-block' : 'none';
    document.getElementById('btnCall').innerText = callAmount > 0 ? `Call ${callAmount}` : 'Call';
    document.getElementById('betAmount').placeholder = minRaise;
    document.getElementById('betAmount').min = minRaise;
});

socket.on('handResult', (data) => {
    notification.innerText = data.message;
    window.myHoleCards = null; // Reset my cards view
});

// --- ACTIONS ---

function sendAction(action) {
    actionControls.style.display = 'none';
    socket.emit('action', { action, amount: 0 });
}

function sendBet() {
    const amt = document.getElementById('betAmount').value;
    if(!amt) return;
    actionControls.style.display = 'none';
    socket.emit('action', { action: 'raise', amount: amt });
    document.getElementById('betAmount').value = '';
}

document.getElementById('btnStart').onclick = () => {
    socket.emit('startGameRequest');
};

document.getElementById('btnRebuy').onclick = () => {
    socket.emit('requestRebuy');
};


// --- RENDERING ---

function renderTable(state) {
    seatsContainer.innerHTML = '';
    document.getElementById('pot-amount').innerText = state.pot;
    document.getElementById('game-status-display').innerText = state.status === 'playing' ? 'In Game' : 'Waiting...';

    // Show Start button if waiting
    if(state.status === 'waiting' && state.players.length >= state.minPlayers) {
        btnStart.style.display = 'block';
    } else {
        btnStart.style.display = 'none';
    }

    // Find me
    const me = state.players.find(p => p.id === socket.id);
    if(me) {
        mySeatIndex = me.seatIndex;
        myChips = me.chips;
        if(me.chips === 0 && state.status === 'waiting') btnRebuy.style.display = 'block';
        else btnRebuy.style.display = 'none';

        if(!me.isTurn) actionControls.style.display = 'none';
    }

    // Render Community Cards
    commCardsContainer.innerHTML = '';
    state.communityCards.forEach(c => {
        commCardsContainer.appendChild(createCardEl(c));
    });

    // Render Players
    state.players.forEach(p => {
        // Calculate relative seat position (0 is bottom/me)
        let relativeSeat = (p.seatIndex - mySeatIndex + 9) % 9;
        
        const seatEl = document.createElement('div');
        seatEl.className = `seat seat-${relativeSeat}`;
        if(p.isTurn) seatEl.classList.add('active-turn');
        if(p.status === 'folded') seatEl.classList.add('folded');

        let cardsHtml = '';
        // If it's me, show my cards (stored locally)
        if(p.id === socket.id && window.myHoleCards) {
             // Render inside a specific container in the seat
        } else if(p.hasCards) {
            // Show back of cards
             cardsHtml = `<div class="player-cards"><div class="card card-back"></div><div class="card card-back"></div></div>`;
        }

        // If Showdown, server sends cards
        if(state.status === 'showdown' && p.cards) {
             cardsHtml = `<div class="player-cards">
                ${createCardString(p.cards[0])}
                ${createCardString(p.cards[1])}
             </div>`;
        }

        seatEl.innerHTML = `
            ${cardsHtml}
            <div><strong>${p.nickname}</strong></div>
            <div>$${p.chips}</div>
            <div style="font-size:10px; color:#ccc;">${p.bet > 0 ? 'Bet: '+p.bet : ''}</div>
            ${p.status === 'all-in' ? '<div style="color:red; font-weight:bold;">ALL IN</div>' : ''}
            ${p.isDealer ? '<div class="dealer-btn">D</div>' : ''}
        `;

        // If it's me, append my real cards if I have them
        if(p.id === socket.id && window.myHoleCards && state.status !== 'showdown' && p.status !== 'folded') {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'player-cards';
            cardDiv.appendChild(createCardEl(window.myHoleCards[0]));
            cardDiv.appendChild(createCardEl(window.myHoleCards[1]));
            seatEl.appendChild(cardDiv);
        }

        seatsContainer.appendChild(seatEl);
    });
}

function renderMyCards() {
    // Triggered by specific socket event, but usually handled by state update loop
}

function createCardEl(cardObj) {
    const el = document.createElement('div');
    const isRed = cardObj.suit === '♥' || cardObj.suit === '♦';
    el.className = `card ${isRed ? 'red' : ''}`;
    el.innerText = `${cardObj.rank}${cardObj.suit}`;
    return el;
}

function createCardString(cardObj) {
    const isRed = cardObj.suit === '♥' || cardObj.suit === '♦';
    return `<div class="card ${isRed ? 'red' : ''}">${cardObj.rank}${cardObj.suit}</div>`;
}