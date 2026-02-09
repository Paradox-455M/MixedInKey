/**
 * DJ Audio Engine using Web Audio API
 * Enhanced with Mixxx-style effects: Filter, Echo, Flanger, Phaser, Reverb, Bitcrush
 */

class DJAudioEngine {
    constructor() {
        this.context = null;
        this.decks = { A: null, B: null };
        this.masterGain = null;
        this.crossfaderValue = 0.5;
        this.initialized = false;
        this.lfoTimers = { A: {}, B: {} };
    }

    async initialize() {
        if (this.initialized) return;

        this.context = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.context.createGain();
        this.masterGain.connect(this.context.destination);

        this.decks.A = this._createDeckChain('A');
        this.decks.B = this._createDeckChain('B');

        this.initialized = true;
        console.log('[AudioEngine] Initialized with extended effects');
    }

    _createDeckChain(deckId) {
        const ctx = this.context;

        const deck = {
            id: deckId,
            source: null,
            mediaElement: null,

            // Input
            inputGain: ctx.createGain(),

            // 3-Band EQ
            eqLow: ctx.createBiquadFilter(),
            eqMid: ctx.createBiquadFilter(),
            eqHigh: ctx.createBiquadFilter(),
            eqLowKill: ctx.createGain(),
            eqMidKill: ctx.createGain(),
            eqHighKill: ctx.createGain(),

            // === EFFECTS ===

            // Filter (LP/HP/BP)
            filter: ctx.createBiquadFilter(),
            filterEnabled: false,
            filterState: { freq: 1000, type: 'lowpass', q: 1 },

            // Echo/Delay
            delay: ctx.createDelay(2.0),
            delayFeedback: ctx.createGain(),
            delayWet: ctx.createGain(),
            delayDry: ctx.createGain(),
            delayEnabled: false,
            delayState: { time: 0.25, feedback: 0.3, mix: 0.5 },

            // Flanger (short modulated delay)
            flangerDelay: ctx.createDelay(0.02),
            flangerFeedback: ctx.createGain(),
            flangerWet: ctx.createGain(),
            flangerDry: ctx.createGain(),
            flangerLfo: ctx.createOscillator(),
            flangerLfoGain: ctx.createGain(),
            flangerEnabled: false,
            flangerState: { depth: 0.5, rate: 0.5, feedback: 0.5 },

            // Phaser (all-pass filters with LFO)
            phaserFilters: [],
            phaserWet: ctx.createGain(),
            phaserDry: ctx.createGain(),
            phaserLfo: ctx.createOscillator(),
            phaserLfoGain: ctx.createGain(),
            phaserEnabled: false,
            phaserState: { depth: 0.7, rate: 0.5, stages: 4 },

            // Reverb (convolution)
            reverbConvolver: ctx.createConvolver(),
            reverbWet: ctx.createGain(),
            reverbDry: ctx.createGain(),
            reverbEnabled: false,
            reverbState: { decay: 2, mix: 0.3 },

            // Bitcrusher (using script processor or worklet)
            bitcrushEnabled: false,
            bitcrushState: { bits: 8, rate: 1 },

            // Effects mixer (combines all effects)
            effectsMixer: ctx.createGain(),

            // Output
            channelGain: ctx.createGain(),
            postFaderGain: ctx.createGain(),
            analyzer: ctx.createAnalyser(),

            // State
            eqValues: { low: 0, mid: 0, high: 0 },
            eqKills: { low: false, mid: false, high: false },
            volume: 1,
            gain: 1
        };

        // Configure EQ
        deck.eqLow.type = 'lowshelf';
        deck.eqLow.frequency.value = 320;
        deck.eqMid.type = 'peaking';
        deck.eqMid.frequency.value = 1000;
        deck.eqMid.Q.value = 0.5;
        deck.eqHigh.type = 'highshelf';
        deck.eqHigh.frequency.value = 3200;

        // Configure Filter
        deck.filter.type = 'lowpass';
        deck.filter.frequency.value = 20000;
        deck.filter.Q.value = 1;

        // Configure Delay/Echo
        deck.delay.delayTime.value = 0.25;
        deck.delayFeedback.gain.value = 0.3;
        deck.delayWet.gain.value = 0;
        deck.delayDry.gain.value = 1;

        // Configure Flanger
        deck.flangerDelay.delayTime.value = 0.005;
        deck.flangerFeedback.gain.value = 0.5;
        deck.flangerWet.gain.value = 0;
        deck.flangerDry.gain.value = 1;
        deck.flangerLfoGain.gain.value = 0.002; // Modulation depth
        deck.flangerLfo.type = 'sine';
        deck.flangerLfo.frequency.value = 0.5;

        // Configure Phaser (4-stage by default)
        for (let i = 0; i < 6; i++) {
            const allpass = ctx.createBiquadFilter();
            allpass.type = 'allpass';
            allpass.frequency.value = 1000;
            allpass.Q.value = 0.5;
            deck.phaserFilters.push(allpass);
        }
        deck.phaserWet.gain.value = 0;
        deck.phaserDry.gain.value = 1;
        deck.phaserLfoGain.gain.value = 500;
        deck.phaserLfo.type = 'sine';
        deck.phaserLfo.frequency.value = 0.5;

        // Configure Reverb
        deck.reverbWet.gain.value = 0;
        deck.reverbDry.gain.value = 1;
        this._createReverbIR(deck, 2);

        // Configure Analyzer
        deck.analyzer.fftSize = 256;
        deck.analyzer.smoothingTimeConstant = 0.8;

        // === CONNECT AUDIO CHAIN ===
        // Input -> EQ -> Filter -> Effects -> Output

        // EQ Chain
        deck.inputGain.connect(deck.eqLow);
        deck.eqLow.connect(deck.eqLowKill);
        deck.eqLowKill.connect(deck.eqMid);
        deck.eqMid.connect(deck.eqMidKill);
        deck.eqMidKill.connect(deck.eqHigh);
        deck.eqHigh.connect(deck.eqHighKill);

        // Filter
        deck.eqHighKill.connect(deck.filter);

        // Effects are connected in parallel from filter output
        // Each effect has dry/wet control

        // Delay/Echo
        deck.filter.connect(deck.delayDry);
        deck.filter.connect(deck.delay);
        deck.delay.connect(deck.delayFeedback);
        deck.delayFeedback.connect(deck.delay);
        deck.delay.connect(deck.delayWet);

        // Flanger
        deck.filter.connect(deck.flangerDry);
        deck.filter.connect(deck.flangerDelay);
        deck.flangerDelay.connect(deck.flangerFeedback);
        deck.flangerFeedback.connect(deck.flangerDelay);
        deck.flangerDelay.connect(deck.flangerWet);
        // LFO modulates delay time
        deck.flangerLfo.connect(deck.flangerLfoGain);
        deck.flangerLfoGain.connect(deck.flangerDelay.delayTime);

        // Phaser
        deck.filter.connect(deck.phaserDry);
        let phaserChain = deck.filter;
        for (const apf of deck.phaserFilters) {
            phaserChain.connect(apf);
            phaserChain = apf;
        }
        phaserChain.connect(deck.phaserWet);
        // LFO modulates all-pass frequencies
        deck.phaserLfo.connect(deck.phaserLfoGain);
        for (const apf of deck.phaserFilters) {
            deck.phaserLfoGain.connect(apf.frequency);
        }

        // Reverb
        deck.filter.connect(deck.reverbDry);
        deck.filter.connect(deck.reverbConvolver);
        deck.reverbConvolver.connect(deck.reverbWet);

        // Mix all effects to effects mixer
        // Only connect wet signals to effectsMixer (dry goes directly to channelGain)
        deck.delayWet.connect(deck.effectsMixer);
        deck.flangerWet.connect(deck.effectsMixer);
        deck.phaserWet.connect(deck.effectsMixer);
        deck.reverbWet.connect(deck.effectsMixer);

        // Single dry path from filter to channel gain
        deck.filter.connect(deck.channelGain);
        // Wet effects added on top
        deck.effectsMixer.connect(deck.channelGain);

        // Output
        deck.channelGain.connect(deck.postFaderGain);
        deck.postFaderGain.connect(deck.analyzer);
        deck.analyzer.connect(this.masterGain);

        // Start LFOs (they run continuously but effects use wet/dry)
        try {
            deck.flangerLfo.start();
            deck.phaserLfo.start();
        } catch (e) {
            // Already started
        }

        return deck;
    }

    // Create reverb impulse response
    _createReverbIR(deck, decay) {
        const sampleRate = this.context.sampleRate;
        const length = sampleRate * decay;
        const impulse = this.context.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }

        deck.reverbConvolver.buffer = impulse;
    }

    connectMediaElement(deckId, audioElement) {
        const deck = this.decks[deckId];
        if (!deck || !audioElement) return;

        if (deck.source) {
            try { deck.source.disconnect(); } catch (e) {}
        }

        deck.mediaElement = audioElement;
        deck.source = this.context.createMediaElementSource(audioElement);
        deck.source.connect(deck.inputGain);
        console.log(`[AudioEngine] Connected media element to Deck ${deckId}`);
    }

    // ========== EQ CONTROLS ==========
    setEQ(deckId, band, value) {
        const deck = this.decks[deckId];
        if (!deck) return;

        const clampedValue = Math.max(-24, Math.min(12, value));
        deck.eqValues[band] = clampedValue;

        const filter = band === 'low' ? deck.eqLow : band === 'mid' ? deck.eqMid : deck.eqHigh;
        filter.gain.setValueAtTime(clampedValue, this.context.currentTime);
    }

    setEQKill(deckId, band, killed) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.eqKills[band] = killed;
        const gainNode = band === 'low' ? deck.eqLowKill : band === 'mid' ? deck.eqMidKill : deck.eqHighKill;
        gainNode.gain.setValueAtTime(killed ? 0 : 1, this.context.currentTime);
    }

    // ========== FILTER CONTROLS ==========
    setFilter(deckId, frequency, type = 'lowpass', q = 1) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.filterState = { freq: frequency, type, q };
        deck.filter.type = type;
        deck.filter.frequency.setValueAtTime(frequency, this.context.currentTime);
        deck.filter.Q.setValueAtTime(q, this.context.currentTime);
    }

    setFilterEnabled(deckId, enabled) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.filterEnabled = enabled;
        if (!enabled) {
            deck.filter.frequency.setValueAtTime(20000, this.context.currentTime);
        } else {
            deck.filter.frequency.setValueAtTime(deck.filterState.freq, this.context.currentTime);
        }
    }

    // ========== ECHO/DELAY CONTROLS ==========
    setDelay(deckId, time, feedback, mix) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.delayState = { time, feedback, mix };
        deck.delay.delayTime.setValueAtTime(time, this.context.currentTime);
        deck.delayFeedback.gain.setValueAtTime(Math.min(0.9, feedback), this.context.currentTime);
        deck.delayWet.gain.setValueAtTime(mix, this.context.currentTime);
    }

    setDelayEnabled(deckId, enabled) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.delayEnabled = enabled;
        if (!enabled) {
            // Clear the delay buffer by resetting feedback and wet gain
            deck.delayWet.gain.setValueAtTime(0, this.context.currentTime);
            deck.delayFeedback.gain.setValueAtTime(0, this.context.currentTime);
            // Brief delay time reset to clear buffer contents
            const currentDelayTime = deck.delay.delayTime.value;
            deck.delay.delayTime.setValueAtTime(0.001, this.context.currentTime);
            // Restore delay time after buffer is cleared (for when re-enabled)
            setTimeout(() => {
                if (deck.delayState) {
                    deck.delay.delayTime.setValueAtTime(deck.delayState.time, this.context.currentTime);
                }
            }, 50);
        } else {
            deck.delayWet.gain.setValueAtTime(deck.delayState.mix, this.context.currentTime);
            deck.delayFeedback.gain.setValueAtTime(Math.min(0.9, deck.delayState.feedback), this.context.currentTime);
            deck.delay.delayTime.setValueAtTime(deck.delayState.time, this.context.currentTime);
        }
    }

    // ========== FLANGER CONTROLS ==========
    setFlanger(deckId, depth, rate, feedback) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.flangerState = { depth, rate, feedback };
        deck.flangerLfoGain.gain.setValueAtTime(depth * 0.005, this.context.currentTime);
        deck.flangerLfo.frequency.setValueAtTime(rate, this.context.currentTime);
        deck.flangerFeedback.gain.setValueAtTime(Math.min(0.9, feedback), this.context.currentTime);
    }

    setFlangerEnabled(deckId, enabled) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.flangerEnabled = enabled;
        if (!enabled) {
            // Clear flanger buffer by resetting feedback and wet gain
            deck.flangerWet.gain.setValueAtTime(0, this.context.currentTime);
            deck.flangerFeedback.gain.setValueAtTime(0, this.context.currentTime);
            // Reset delay time to clear buffer
            deck.flangerDelay.delayTime.setValueAtTime(0.001, this.context.currentTime);
            setTimeout(() => {
                deck.flangerDelay.delayTime.setValueAtTime(0.005, this.context.currentTime);
            }, 50);
        } else {
            deck.flangerWet.gain.setValueAtTime(0.7, this.context.currentTime);
            deck.flangerFeedback.gain.setValueAtTime(Math.min(0.9, deck.flangerState.feedback), this.context.currentTime);
        }
    }

    // ========== PHASER CONTROLS ==========
    setPhaser(deckId, depth, rate, stages) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.phaserState = { depth, rate, stages };
        deck.phaserLfoGain.gain.setValueAtTime(depth * 1000, this.context.currentTime);
        deck.phaserLfo.frequency.setValueAtTime(rate, this.context.currentTime);

        // Enable/disable stages
        for (let i = 0; i < deck.phaserFilters.length; i++) {
            const apf = deck.phaserFilters[i];
            if (i < stages) {
                apf.Q.setValueAtTime(0.5, this.context.currentTime);
            } else {
                apf.Q.setValueAtTime(0.001, this.context.currentTime);
            }
        }
    }

    setPhaserEnabled(deckId, enabled) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.phaserEnabled = enabled;
        if (!enabled) {
            // Clear phaser by resetting wet gain and filter Q values
            deck.phaserWet.gain.setValueAtTime(0, this.context.currentTime);
            // Temporarily flatten all-pass filters
            for (const apf of deck.phaserFilters) {
                apf.Q.setValueAtTime(0.001, this.context.currentTime);
            }
        } else {
            deck.phaserWet.gain.setValueAtTime(0.7, this.context.currentTime);
            // Restore Q values for active stages
            const stages = deck.phaserState.stages || 4;
            for (let i = 0; i < deck.phaserFilters.length; i++) {
                const apf = deck.phaserFilters[i];
                apf.Q.setValueAtTime(i < stages ? 0.5 : 0.001, this.context.currentTime);
            }
        }
    }

    // ========== REVERB CONTROLS ==========
    setReverb(deckId, decay, mix) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.reverbState = { decay, mix };

        // Recreate impulse response if decay changed significantly
        if (Math.abs(decay - (deck.reverbState.decay || 2)) > 0.5) {
            this._createReverbIR(deck, decay);
        }

        deck.reverbWet.gain.setValueAtTime(mix, this.context.currentTime);
    }

    setReverbEnabled(deckId, enabled) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.reverbEnabled = enabled;
        if (!enabled) {
            // Fade out reverb quickly to avoid abrupt cutoff
            deck.reverbWet.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.1);
        } else {
            deck.reverbWet.gain.setValueAtTime(deck.reverbState.mix, this.context.currentTime);
        }
    }

    // ========== BITCRUSH CONTROLS ==========
    // Note: True bitcrushing requires AudioWorklet. This is a simplified version
    // that uses filter-based approximation
    setBitcrush(deckId, bits, rate) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.bitcrushState = { bits, rate };
        // Approximate bitcrush by aggressive filtering
        // Real implementation would use AudioWorkletNode
    }

    setBitcrushEnabled(deckId, enabled) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.bitcrushEnabled = enabled;
        // Would enable/disable worklet processor
    }

    // ========== UNIFIED EFFECT CONTROL ==========
    // Single method to control any effect
    setEffect(deckId, effectId, params) {
        const deck = this.decks[deckId];
        if (!deck) return;

        const bpm = params.bpm || 120;
        // IMPORTANT: Only set effect parameters if enabled or if we're enabling
        // When disabling, just call setXxxEnabled which clears buffers
        const shouldSetParams = params.enabled !== false;

        switch (effectId) {
            case 'filter':
                if (params.enabled !== undefined) this.setFilterEnabled(deckId, params.enabled);
                if (shouldSetParams && params.value !== undefined) {
                    const freq = 20 * Math.pow(1000, params.value);
                    this.setFilter(deckId, freq, 'lowpass', 1 + params.value * 4);
                }
                break;

            case 'echo':
                if (params.enabled !== undefined) this.setDelayEnabled(deckId, params.enabled);
                if (shouldSetParams && params.value !== undefined) {
                    const beatDuration = 60 / bpm;
                    const delayTime = beatDuration * (0.25 + params.value * 1.75);
                    this.setDelay(deckId, delayTime, 0.2 + params.value * 0.5, 0.3 + params.value * 0.4);
                }
                break;

            case 'flanger':
                if (params.enabled !== undefined) this.setFlangerEnabled(deckId, params.enabled);
                if (shouldSetParams && params.value !== undefined) {
                    this.setFlanger(deckId, params.value, 0.1 + params.value * 2, params.value * 0.7);
                }
                break;

            case 'phaser':
                if (params.enabled !== undefined) this.setPhaserEnabled(deckId, params.enabled);
                if (shouldSetParams && params.value !== undefined) {
                    this.setPhaser(deckId, params.value, 0.1 + params.value, Math.ceil(params.value * 6));
                }
                break;

            case 'reverb':
                if (params.enabled !== undefined) this.setReverbEnabled(deckId, params.enabled);
                if (shouldSetParams && params.value !== undefined) {
                    this.setReverb(deckId, 1 + params.value * 4, params.value * 0.6);
                }
                break;

            case 'crush':
                if (params.enabled !== undefined) this.setBitcrushEnabled(deckId, params.enabled);
                if (shouldSetParams && params.value !== undefined) {
                    this.setBitcrush(deckId, 16 - params.value * 12, 1 - params.value * 0.9);
                }
                break;
        }
    }

    // ========== VOLUME CONTROLS ==========
    setVolume(deckId, volume) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.volume = Math.max(0, Math.min(1, volume));
        deck.channelGain.gain.setValueAtTime(deck.volume, this.context.currentTime);
    }

    setGain(deckId, gain) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.gain = gain;
        const linearGain = Math.pow(10, gain / 20);
        deck.inputGain.gain.setValueAtTime(linearGain, this.context.currentTime);
    }

    // ========== CROSSFADER ==========
    setCrossfader(value) {
        this.crossfaderValue = Math.max(0, Math.min(1, value));

        const angleA = (1 - this.crossfaderValue) * Math.PI / 2;
        const angleB = this.crossfaderValue * Math.PI / 2;

        if (this.decks.A) {
            this.decks.A.postFaderGain.gain.setValueAtTime(Math.cos(angleA), this.context.currentTime);
        }
        if (this.decks.B) {
            this.decks.B.postFaderGain.gain.setValueAtTime(Math.cos(angleB), this.context.currentTime);
        }
    }

    // ========== VU METER ==========
    getLevel(deckId) {
        const deck = this.decks[deckId];
        if (!deck || !deck.analyzer) return 0;

        const dataArray = new Uint8Array(deck.analyzer.frequencyBinCount);
        deck.analyzer.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        return Math.sqrt(sum / dataArray.length) / 255;
    }

    // ========== FREQUENCY SPECTRUM ANALYZER ==========
    getFrequencyData(deckId) {
        const deck = this.decks[deckId];
        if (!deck || !deck.analyzer) return null;

        const bufferLength = deck.analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        deck.analyzer.getByteFrequencyData(dataArray);

        return dataArray;
    }

    // Get frequency bands (low, mid, high) for spectrum visualization
    getFrequencyBands(deckId) {
        const deck = this.decks[deckId];
        if (!deck || !deck.analyzer) return { low: 0, mid: 0, high: 0, sub: 0, presence: 0 };

        const bufferLength = deck.analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        deck.analyzer.getByteFrequencyData(dataArray);

        // Frequency ranges (based on 44.1kHz sample rate, 256 FFT size)
        // Each bin = sampleRate / fftSize = ~172Hz per bin
        const sampleRate = this.context.sampleRate;
        const binWidth = sampleRate / (deck.analyzer.fftSize || 256);

        // Define frequency ranges
        const subEnd = Math.floor(60 / binWidth);      // Sub bass: 0-60Hz
        const lowEnd = Math.floor(250 / binWidth);     // Bass: 60-250Hz
        const midEnd = Math.floor(2000 / binWidth);    // Mids: 250-2000Hz
        const presenceEnd = Math.floor(6000 / binWidth); // Presence: 2000-6000Hz
        // High: 6000Hz+

        let sub = 0, low = 0, mid = 0, presence = 0, high = 0;
        let subCount = 0, lowCount = 0, midCount = 0, presenceCount = 0, highCount = 0;

        for (let i = 0; i < bufferLength; i++) {
            const value = dataArray[i] / 255;
            if (i < subEnd) {
                sub += value;
                subCount++;
            } else if (i < lowEnd) {
                low += value;
                lowCount++;
            } else if (i < midEnd) {
                mid += value;
                midCount++;
            } else if (i < presenceEnd) {
                presence += value;
                presenceCount++;
            } else {
                high += value;
                highCount++;
            }
        }

        return {
            sub: subCount > 0 ? sub / subCount : 0,
            low: lowCount > 0 ? low / lowCount : 0,
            mid: midCount > 0 ? mid / midCount : 0,
            presence: presenceCount > 0 ? presence / presenceCount : 0,
            high: highCount > 0 ? high / highCount : 0
        };
    }

    // Get full spectrum for detailed visualization (32 bands)
    getSpectrum(deckId, numBands = 32) {
        const deck = this.decks[deckId];
        if (!deck || !deck.analyzer) return new Array(numBands).fill(0);

        const bufferLength = deck.analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        deck.analyzer.getByteFrequencyData(dataArray);

        const bands = new Array(numBands).fill(0);
        const binsPerBand = Math.floor(bufferLength / numBands);

        for (let i = 0; i < numBands; i++) {
            let sum = 0;
            const start = i * binsPerBand;
            const end = Math.min(start + binsPerBand, bufferLength);
            for (let j = start; j < end; j++) {
                sum += dataArray[j];
            }
            bands[i] = sum / (end - start) / 255;
        }

        return bands;
    }

    // ========== TEMPO / PITCH CONTROL ==========
    setPlaybackRate(deckId, rate) {
        const deck = this.decks[deckId];
        if (!deck || !deck.mediaElement) return;

        // Store the rate
        deck.playbackRate = rate;

        // Apply to media element
        deck.mediaElement.playbackRate = rate;

        // If key lock is enabled, compensate pitch
        if (deck.keyLockEnabled && deck.source) {
            // Calculate cents to shift to maintain original pitch
            // pitch shift = -12 * log2(rate) semitones
            const semitones = -12 * Math.log2(rate);
            const cents = semitones * 100;
            deck.detune = cents;
            // Note: MediaElementSource doesn't support detune directly
            // We'd need to use a different approach for true key lock
        }
    }

    setKeyLock(deckId, enabled) {
        const deck = this.decks[deckId];
        if (!deck) return;

        deck.keyLockEnabled = enabled;

        if (!enabled) {
            deck.detune = 0;
        } else if (deck.playbackRate && deck.playbackRate !== 1) {
            // Recalculate pitch compensation
            const semitones = -12 * Math.log2(deck.playbackRate);
            deck.detune = semitones * 100;
        }
    }

    getPlaybackRate(deckId) {
        const deck = this.decks[deckId];
        return deck?.playbackRate || 1;
    }

    isKeyLockEnabled(deckId) {
        const deck = this.decks[deckId];
        return deck?.keyLockEnabled || false;
    }

    // ========== LUFS LOUDNESS METERING ==========
    // Approximation of LUFS using weighted frequency bands
    getLUFS(deckId) {
        const deck = this.decks[deckId];
        if (!deck || !deck.analyzer) return -70; // Silence

        const bufferLength = deck.analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        deck.analyzer.getByteFrequencyData(dataArray);

        // K-weighting approximation (emphasize mids, reduce lows/highs)
        const sampleRate = this.context.sampleRate;
        const binWidth = sampleRate / (deck.analyzer.fftSize || 256);

        let weightedSum = 0;
        let totalWeight = 0;

        for (let i = 0; i < bufferLength; i++) {
            const freq = i * binWidth;
            const value = dataArray[i] / 255;

            // K-weighting curve approximation
            let weight = 1;
            if (freq < 100) {
                weight = 0.2; // Reduce sub-bass
            } else if (freq < 500) {
                weight = 0.8; // Slightly reduce bass
            } else if (freq > 8000) {
                weight = 0.6; // Reduce very high frequencies
            }

            weightedSum += value * value * weight;
            totalWeight += weight;
        }

        const rms = Math.sqrt(weightedSum / totalWeight);

        // Convert to LUFS-like scale (-70 to 0)
        if (rms === 0) return -70;
        const lufs = 20 * Math.log10(rms);

        // Clamp to reasonable range
        return Math.max(-70, Math.min(0, lufs));
    }

    // Get integrated loudness over time (short-term)
    getShortTermLoudness(deckId) {
        const deck = this.decks[deckId];
        if (!deck) return { momentary: -70, shortTerm: -70, peak: 0 };

        // Initialize loudness history if not present
        if (!deck.loudnessHistory) {
            deck.loudnessHistory = [];
            deck.peakLevel = 0;
        }

        const currentLUFS = this.getLUFS(deckId);
        const currentLevel = this.getLevel(deckId);

        // Track peak
        if (currentLevel > deck.peakLevel) {
            deck.peakLevel = currentLevel;
        }

        // Add to history (keep last 3 seconds at ~20 samples/sec)
        deck.loudnessHistory.push(currentLUFS);
        if (deck.loudnessHistory.length > 60) {
            deck.loudnessHistory.shift();
        }

        // Calculate short-term average
        const shortTermLUFS = deck.loudnessHistory.reduce((a, b) => a + b, 0) / deck.loudnessHistory.length;

        return {
            momentary: currentLUFS,
            shortTerm: shortTermLUFS,
            peak: deck.peakLevel
        };
    }

    resetPeak(deckId) {
        const deck = this.decks[deckId];
        if (deck) {
            deck.peakLevel = 0;
        }
    }

    // ========== STATE ==========
    getDeckState(deckId) {
        const deck = this.decks[deckId];
        if (!deck) return null;

        return {
            eqValues: { ...deck.eqValues },
            eqKills: { ...deck.eqKills },
            filter: { ...deck.filterState, enabled: deck.filterEnabled },
            delay: { ...deck.delayState, enabled: deck.delayEnabled },
            flanger: { ...deck.flangerState, enabled: deck.flangerEnabled },
            phaser: { ...deck.phaserState, enabled: deck.phaserEnabled },
            reverb: { ...deck.reverbState, enabled: deck.reverbEnabled },
            bitcrush: { ...deck.bitcrushState, enabled: deck.bitcrushEnabled },
            volume: deck.volume,
            gain: deck.gain
        };
    }

    async resume() {
        if (this.context && this.context.state === 'suspended') {
            await this.context.resume();
        }
    }

    // ========== SYNC / BEAT MATCHING ==========

    /**
     * Sync one deck's tempo to another deck
     * @param {string} syncDeckId - The deck to sync (will change tempo)
     * @param {string} masterDeckId - The master deck (tempo source)
     * @param {number} syncBpm - BPM of the sync deck
     * @param {number} masterBpm - BPM of the master deck
     */
    syncTempo(syncDeckId, masterDeckId, syncBpm, masterBpm) {
        if (!syncBpm || !masterBpm) return null;

        // Calculate required playback rate to match tempos
        const targetRate = masterBpm / syncBpm;

        // Clamp to reasonable range (±50%)
        const clampedRate = Math.max(0.5, Math.min(1.5, targetRate));

        // Apply the new playback rate
        this.setPlaybackRate(syncDeckId, clampedRate);

        console.log(`[AudioEngine] Synced Deck ${syncDeckId} to Deck ${masterDeckId}: ${syncBpm} → ${masterBpm} BPM (rate: ${clampedRate.toFixed(3)})`);

        return {
            originalBpm: syncBpm,
            targetBpm: masterBpm,
            playbackRate: clampedRate,
            percentChange: ((clampedRate - 1) * 100).toFixed(1)
        };
    }

    /**
     * Align phase between two decks
     * Uses downbeats to find the nearest beat alignment point
     * @param {string} syncDeckId - The deck to phase align
     * @param {Array} syncDownbeats - Downbeat times for sync deck
     * @param {number} syncCurrentTime - Current playback time of sync deck
     * @param {Array} masterDownbeats - Downbeat times for master deck
     * @param {number} masterCurrentTime - Current playback time of master deck
     * @param {number} masterBpm - Master deck BPM for beat duration
     */
    alignPhase(syncDeckId, syncDownbeats, syncCurrentTime, masterDownbeats, masterCurrentTime, masterBpm) {
        if (!syncDownbeats?.length || !masterDownbeats?.length || !masterBpm) {
            return null;
        }

        const beatDuration = 60 / masterBpm;

        // Find where we are in the master's beat cycle
        // Get the position within the current bar (4 beats)
        const barDuration = beatDuration * 4;

        // Find the master's position relative to its nearest downbeat
        let masterBeatPhase = 0;
        for (let i = 0; i < masterDownbeats.length; i++) {
            if (masterDownbeats[i] > masterCurrentTime) {
                const prevBeat = i > 0 ? masterDownbeats[i - 1] : 0;
                masterBeatPhase = (masterCurrentTime - prevBeat) % barDuration;
                break;
            }
        }

        // Find the sync deck's position relative to its nearest downbeat
        let syncBeatPhase = 0;
        for (let i = 0; i < syncDownbeats.length; i++) {
            if (syncDownbeats[i] > syncCurrentTime) {
                const prevBeat = i > 0 ? syncDownbeats[i - 1] : 0;
                syncBeatPhase = (syncCurrentTime - prevBeat) % barDuration;
                break;
            }
        }

        // Calculate phase difference
        let phaseDiff = masterBeatPhase - syncBeatPhase;

        // Normalize to range [-barDuration/2, barDuration/2]
        while (phaseDiff > barDuration / 2) phaseDiff -= barDuration;
        while (phaseDiff < -barDuration / 2) phaseDiff += barDuration;

        // Get the sync deck's media element and adjust
        const deck = this.decks[syncDeckId];
        if (deck?.mediaElement) {
            const newTime = Math.max(0, syncCurrentTime + phaseDiff);
            deck.mediaElement.currentTime = newTime;
            console.log(`[AudioEngine] Phase aligned Deck ${syncDeckId}: shifted ${(phaseDiff * 1000).toFixed(0)}ms`);
            return {
                phaseShift: phaseDiff,
                phaseShiftMs: phaseDiff * 1000,
                aligned: true
            };
        }

        return null;
    }

    /**
     * Get sync information between two decks
     */
    getSyncInfo(deckABpm, deckBBpm, deckACurrentTime, deckBCurrentTime, deckADownbeats, deckBDownbeats) {
        if (!deckABpm || !deckBBpm) {
            return { canSync: false, reason: 'Missing BPM data' };
        }

        const bpmDiff = Math.abs(deckABpm - deckBBpm);
        const bpmRatio = deckABpm / deckBBpm;
        const percentDiff = Math.abs((bpmRatio - 1) * 100);

        // Check if tempos are compatible (within 50% range)
        const canSync = percentDiff < 50;

        return {
            canSync,
            deckABpm,
            deckBBpm,
            bpmDifference: bpmDiff,
            percentDifference: percentDiff.toFixed(1),
            bpmRatio: bpmRatio.toFixed(3),
            reason: canSync ? 'Compatible' : 'BPM difference too large'
        };
    }

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
