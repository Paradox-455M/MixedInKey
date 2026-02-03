/**
 * DJ Audio Engine using Web Audio API
 * Provides EQ, Effects, and Mixing capabilities
 */

class DJAudioEngine {
    constructor() {
        this.context = null;
        this.decks = {
            A: null,
            B: null
        };
        this.masterGain = null;
        this.crossfaderValue = 0.5; // 0 = full A, 1 = full B
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        this.context = new (window.AudioContext || window.webkitAudioContext)();

        // Create master output
        this.masterGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);

        // Initialize both decks
        this.decks.A = this._createDeckChain('A');
        this.decks.B = this._createDeckChain('B');

        this.initialized = true;
        console.log('[AudioEngine] Initialized');
    }

    _createDeckChain(deckId) {
        const deck = {
            id: deckId,
            // Source (will be connected when audio loads)
            source: null,
            mediaElement: null,

            // Input gain (trim)
            inputGain: this.context.createGain(),

            // 3-Band EQ using biquad filters
            eqLow: this.context.createBiquadFilter(),
            eqMid: this.context.createBiquadFilter(),
            eqHigh: this.context.createBiquadFilter(),

            // EQ Kill switches (gain nodes)
            eqLowKill: this.context.createGain(),
            eqMidKill: this.context.createGain(),
            eqHighKill: this.context.createGain(),

            // Effects
            filter: this.context.createBiquadFilter(),
            filterEnabled: false,

            delay: this.context.createDelay(2.0),
            delayFeedback: this.context.createGain(),
            delayWet: this.context.createGain(),
            delayDry: this.context.createGain(),
            delayEnabled: false,

            // Output
            channelGain: this.context.createGain(), // Volume fader
            postFaderGain: this.context.createGain(), // After fader for crossfader

            // Analyzer for VU meter
            analyzer: this.context.createAnalyser(),

            // State
            eqValues: { low: 0, mid: 0, high: 0 }, // -24 to +12 dB
            eqKills: { low: false, mid: false, high: false },
            filterFreq: 1000,
            filterType: 'lowpass',
            filterQ: 1,
            delayTime: 0.25,
            delayFeedbackAmount: 0.3,
            delayMix: 0,
            volume: 1,
            gain: 1
        };

        // Configure EQ filters
        // Low shelf: affects frequencies below 320Hz
        deck.eqLow.type = 'lowshelf';
        deck.eqLow.frequency.value = 320;
        deck.eqLow.gain.value = 0;

        // Mid peaking: affects frequencies around 1kHz
        deck.eqMid.type = 'peaking';
        deck.eqMid.frequency.value = 1000;
        deck.eqMid.Q.value = 0.5;
        deck.eqMid.gain.value = 0;

        // High shelf: affects frequencies above 3.2kHz
        deck.eqHigh.type = 'highshelf';
        deck.eqHigh.frequency.value = 3200;
        deck.eqHigh.gain.value = 0;

        // Configure filter
        deck.filter.type = 'lowpass';
        deck.filter.frequency.value = 20000;
        deck.filter.Q.value = 1;

        // Configure delay
        deck.delay.delayTime.value = 0.25;
        deck.delayFeedback.gain.value = 0.3;
        deck.delayWet.gain.value = 0;
        deck.delayDry.gain.value = 1;

        // Configure analyzer
        deck.analyzer.fftSize = 256;
        deck.analyzer.smoothingTimeConstant = 0.8;

        // Connect the chain:
        // input -> EQ Low -> EQ Mid -> EQ High -> Filter -> Delay -> Volume -> Analyzer -> Master

        // EQ chain with kill switches
        deck.inputGain.connect(deck.eqLow);
        deck.eqLow.connect(deck.eqLowKill);
        deck.eqLowKill.connect(deck.eqMid);
        deck.eqMid.connect(deck.eqMidKill);
        deck.eqMidKill.connect(deck.eqHigh);
        deck.eqHigh.connect(deck.eqHighKill);

        // Filter (bypass when disabled)
        deck.eqHighKill.connect(deck.filter);

        // Delay with dry/wet mix
        deck.filter.connect(deck.delayDry);
        deck.filter.connect(deck.delay);
        deck.delay.connect(deck.delayFeedback);
        deck.delayFeedback.connect(deck.delay);
        deck.delay.connect(deck.delayWet);
        deck.delayDry.connect(deck.channelGain);
        deck.delayWet.connect(deck.channelGain);

        // Output
        deck.channelGain.connect(deck.postFaderGain);
        deck.postFaderGain.connect(deck.analyzer);
        deck.analyzer.connect(this.masterGain);

        return deck;
    }

    connectMediaElement(deckId, audioElement) {
        const deck = this.decks[deckId];
        if (!deck || !audioElement) return;

        // Disconnect previous source if exists
        if (deck.source) {
            try {
                deck.source.disconnect();
            } catch (e) {
                // Ignore if already disconnected
            }
        }

        // Create new source from audio element
        deck.mediaElement = audioElement;
        deck.source = this.context.createMediaElementSource(audioElement);
        deck.source.connect(deck.inputGain);

        console.log(`[AudioEngine] Connected media element to Deck ${deckId}`);
    }

    // EQ Controls
    setEQ(deckId, band, value) {
        const deck = this.decks[deckId];
        if (!deck) return;

        // Value in dB: -24 to +12
        const clampedValue = Math.max(-24, Math.min(12, value));
        deck.eqValues[band] = clampedValue;

        switch (band) {
            case 'low':
                deck.eqLow.gain.setValueAtTime(clampedValue, this.context.currentTime);
                break;
            case 'mid':
                deck.eqMid.gain.setValueAtTime(clampedValue, this.context.currentTime);
                break;
            case 'high':
                deck.eqHigh.gain.setValueAtTime(clampedValue, this.context.currentTime);
                break;
        }
    }

    setEQKill(deckId, band, killed) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.eqKills[band] = killed;
        const gainNode = band === 'low' ? deck.eqLowKill :
                        band === 'mid' ? deck.eqMidKill : deck.eqHighKill;

        // Instant cut to avoid clicks
        gainNode.gain.setValueAtTime(killed ? 0 : 1, this.context.currentTime);
    }

    // Filter Controls
    setFilter(deckId, frequency, type = 'lowpass', q = 1) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.filterFreq = frequency;
        deck.filterType = type;
        deck.filterQ = q;
        deck.filter.type = type;
        deck.filter.frequency.setValueAtTime(frequency, this.context.currentTime);
        deck.filter.Q.setValueAtTime(q, this.context.currentTime);
    }

    setFilterEnabled(deckId, enabled) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.filterEnabled = enabled;
        if (!enabled) {
            // Bypass: set to full range
            deck.filter.frequency.setValueAtTime(20000, this.context.currentTime);
        } else {
            deck.filter.frequency.setValueAtTime(deck.filterFreq, this.context.currentTime);
        }
    }

    // Delay Controls
    setDelay(deckId, time, feedback, mix) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.delayTime = time;
        deck.delayFeedbackAmount = feedback;
        deck.delayMix = mix;

        deck.delay.delayTime.setValueAtTime(time, this.context.currentTime);
        deck.delayFeedback.gain.setValueAtTime(Math.min(0.9, feedback), this.context.currentTime);
        deck.delayWet.gain.setValueAtTime(mix, this.context.currentTime);
        deck.delayDry.gain.setValueAtTime(1 - mix * 0.5, this.context.currentTime);
    }

    setDelayEnabled(deckId, enabled) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.delayEnabled = enabled;
        if (!enabled) {
            deck.delayWet.gain.setValueAtTime(0, this.context.currentTime);
            deck.delayDry.gain.setValueAtTime(1, this.context.currentTime);
        } else {
            deck.delayWet.gain.setValueAtTime(deck.delayMix, this.context.currentTime);
            deck.delayDry.gain.setValueAtTime(1 - deck.delayMix * 0.5, this.context.currentTime);
        }
    }

    // Volume Controls
    setVolume(deckId, volume) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.volume = Math.max(0, Math.min(1, volume));
        deck.channelGain.gain.setValueAtTime(deck.volume, this.context.currentTime);
    }

    setGain(deckId, gain) {
        const deck = this.decks[deckId];
        if (!deck) return;

        // Gain in dB converted to linear
        deck.gain = gain;
        const linearGain = Math.pow(10, gain / 20);
        deck.inputGain.gain.setValueAtTime(linearGain, this.context.currentTime);
    }

    // Crossfader
    setCrossfader(value) {
        // value: 0 = full A, 0.5 = center, 1 = full B
        this.crossfaderValue = Math.max(0, Math.min(1, value));

        // Equal power crossfade
        const angleA = (1 - this.crossfaderValue) * Math.PI / 2;
        const angleB = this.crossfaderValue * Math.PI / 2;

        const gainA = Math.cos(angleA);
        const gainB = Math.cos(angleB);

        if (this.decks.A) {
            this.decks.A.postFaderGain.gain.setValueAtTime(gainA, this.context.currentTime);
        }
        if (this.decks.B) {
            this.decks.B.postFaderGain.gain.setValueAtTime(gainB, this.context.currentTime);
        }
    }

    // Get VU meter level
    getLevel(deckId) {
        const deck = this.decks[deckId];
        if (!deck || !deck.analyzer) return 0;

        const dataArray = new Uint8Array(deck.analyzer.frequencyBinCount);
        deck.analyzer.getByteFrequencyData(dataArray);

        // Calculate RMS
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / dataArray.length);
        return rms / 255; // Normalize to 0-1
    }

    // Get deck state
    getDeckState(deckId) {
        const deck = this.decks[deckId];
        if (!deck) return null;

        return {
            eqValues: { ...deck.eqValues },
            eqKills: { ...deck.eqKills },
            filterFreq: deck.filterFreq,
            filterType: deck.filterType,
            filterEnabled: deck.filterEnabled,
            delayTime: deck.delayTime,
            delayFeedback: deck.delayFeedbackAmount,
            delayMix: deck.delayMix,
            delayEnabled: deck.delayEnabled,
            volume: deck.volume,
            gain: deck.gain
        };
    }

    // Resume context (needed for browsers that suspend by default)
    async resume() {
        if (this.context && this.context.state === 'suspended') {
            await this.context.resume();
        }
    }

    // Cleanup
    destroy() {
        if (this.context) {
            this.context.close();
            this.context = null;
        }
        this.initialized = false;
    }
}

// Singleton instance
const audioEngine = new DJAudioEngine();

export default audioEngine;
