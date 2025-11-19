/**
 * POKER LOGIC MODULE
 * Handles Deck, Hand Evaluation, and Game State Helpers
 */

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 
    'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

class Deck {
    constructor() {
        this.cards = [];
        this.reset();
    }

    reset() {
        this.cards = [];
        for (let s of SUITS) {
            for (let r of RANKS) {
                this.cards.push({ rank: r, suit: s, value: RANK_VALUE[r] });
            }
        }
        this.shuffle();
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal() {
        return this.cards.pop();
    }
}

// Simplified Hand Evaluator (7 cards input -> Best 5 rank)
// Returns { score: number, name: string, tieBreaker: array }
// Score tiers: 900 (Royal Flush) ... 100 (High Card)
function evaluateHand(holeCards, communityCards) {
    const allCards = [...holeCards, ...communityCards];
    
    // Sort by value descending
    allCards.sort((a, b) => b.value - a.value);

    // Helpers
    const getCounts = (cards) => {
        const counts = {};
        cards.forEach(c => counts[c.rank] = (counts[c.rank] || 0) + 1);
        return counts;
    };
    
    const isFlush = (cards) => {
        const suits = {};
        cards.forEach(c => suits[c.suit] = (suits[c.suit] || []).concat(c));
        for (let s in suits) {
            if (suits[s].length >= 5) return suits[s].slice(0, 5); // Return top 5 flush cards
        }
        return false;
    };

    const isStraight = (cards) => {
        // Remove duplicates for straight check
        const uniqueValues = [...new Set(cards.map(c => c.value))];
        // Handle Ace low (A, 5, 4, 3, 2) -> A is 14, but also 1
        if (uniqueValues.includes(14)) uniqueValues.push(1);
        uniqueValues.sort((a, b) => b - a);

        let streak = [];
        for (let v of uniqueValues) {
            if (streak.length === 0 || streak[streak.length - 1] === v + 1) {
                streak.push(v);
            } else {
                streak = [v];
            }
            if (streak.length === 5) return streak[0]; // Return highest card of straight
        }
        return false;
    };

    // 1. Check Straight Flush
    const flushCards = isFlush(allCards);
    if (flushCards) {
        const straightFlushHigh = isStraight(flushCards);
        if (straightFlushHigh) return { score: 900 + straightFlushHigh, name: "Straight Flush" };
        // 2. Check Flush
        return { score: 600 + flushCards[0].value, name: "Flush", tieBreaker: flushCards.map(c => c.value) };
    }

    // 3. Check Quads, Full House, Trips, Two Pair, Pair
    const counts = getCounts(allCards);
    const keys = Object.keys(counts);
    const quads = keys.filter(k => counts[k] === 4);
    const trips = keys.filter(k => counts[k] === 3);
    const pairs = keys.filter(k => counts[k] === 2);

    if (quads.length > 0) {
        const qVal = RANK_VALUE[quads[0]];
        return { score: 800 + qVal, name: `Four of a Kind (${quads[0]}s)` };
    }

    if (trips.length > 0 && (trips.length >= 2 || pairs.length > 0)) {
        // Full house logic
        const tVal = Math.max(...trips.map(r => RANK_VALUE[r]));
        // Find best pair (could be another trip treated as pair)
        const remaining = keys.filter(k => k !== trips.find(t => RANK_VALUE[t] === tVal));
        const pairCandidates = remaining.filter(k => counts[k] >= 2);
        const pVal = Math.max(...pairCandidates.map(r => RANK_VALUE[r]));
        return { score: 700 + tVal, name: "Full House" };
    }

    const straightHigh = isStraight(allCards);
    if (straightHigh) {
        return { score: 500 + straightHigh, name: "Straight" };
    }

    if (trips.length > 0) {
        const tVal = Math.max(...trips.map(r => RANK_VALUE[r]));
        return { score: 400 + tVal, name: `Three of a Kind (${trips[0]}s)` };
    }

    if (pairs.length >= 2) {
        pairs.sort((a, b) => RANK_VALUE[b] - RANK_VALUE[a]);
        return { score: 300 + RANK_VALUE[pairs[0]], name: "Two Pair" };
    }

    if (pairs.length === 1) {
        return { score: 200 + RANK_VALUE[pairs[0]], name: `Pair of ${pairs[0]}s` };
    }

    return { score: 100 + allCards[0].value, name: "High Card", tieBreaker: allCards.slice(0,5).map(c => c.value) };
}

module.exports = { Deck, evaluateHand };