/**
 * Cue Persistence Service
 * Saves and loads hot cues and loops per track using localStorage
 * Keys are based on file path for consistent identification
 */

const STORAGE_KEY = 'mixedin_memory_cues';
const LOOP_STORAGE_KEY = 'mixedin_memory_loops';

/**
 * Generate a unique key for a track based on its file path
 */
const getTrackKey = (filePath) => {
    if (!filePath) return null;
    // Use a hash-like key based on the file path
    return filePath.replace(/[^a-zA-Z0-9]/g, '_');
};

/**
 * Get all stored cues from localStorage
 */
const getAllStoredCues = () => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch (err) {
        console.error('[CuePersistence] Failed to load stored cues:', err);
        return {};
    }
};

/**
 * Get all stored loops from localStorage
 */
const getAllStoredLoops = () => {
    try {
        const stored = localStorage.getItem(LOOP_STORAGE_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch (err) {
        console.error('[CuePersistence] Failed to load stored loops:', err);
        return {};
    }
};

/**
 * Save all cues to localStorage
 */
const saveAllCues = (cuesMap) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cuesMap));
    } catch (err) {
        console.error('[CuePersistence] Failed to save cues:', err);
    }
};

/**
 * Save all loops to localStorage
 */
const saveAllLoops = (loopsMap) => {
    try {
        localStorage.setItem(LOOP_STORAGE_KEY, JSON.stringify(loopsMap));
    } catch (err) {
        console.error('[CuePersistence] Failed to save loops:', err);
    }
};

/**
 * Load saved cues for a specific track
 * @param {string} filePath - The file path of the track
 * @returns {Array} Array of 8 cue objects (or null for empty slots)
 */
export const loadTrackCues = (filePath) => {
    const key = getTrackKey(filePath);
    if (!key) return null;

    const allCues = getAllStoredCues();
    const trackData = allCues[key];

    if (!trackData) return null;

    // Return the cues array, ensuring it's always 8 elements
    const cues = trackData.cues || new Array(8).fill(null);
    return cues.length === 8 ? cues : [...cues, ...new Array(8 - cues.length).fill(null)].slice(0, 8);
};

/**
 * Load saved loop for a specific track
 * @param {string} filePath - The file path of the track
 * @returns {Object|null} Loop object or null
 */
export const loadTrackLoop = (filePath) => {
    const key = getTrackKey(filePath);
    if (!key) return null;

    const allLoops = getAllStoredLoops();
    return allLoops[key] || null;
};

/**
 * Save cues for a specific track
 * @param {string} filePath - The file path of the track
 * @param {Array} cues - Array of 8 cue objects
 * @param {Object} metadata - Optional track metadata (name, bpm, key)
 */
export const saveTrackCues = (filePath, cues, metadata = {}) => {
    const key = getTrackKey(filePath);
    if (!key) return false;

    const allCues = getAllStoredCues();
    allCues[key] = {
        filePath,
        cues,
        savedAt: new Date().toISOString(),
        trackName: metadata.name || '',
        bpm: metadata.bpm || 0,
        key: metadata.key || ''
    };

    saveAllCues(allCues);
    console.log(`[CuePersistence] Saved ${cues.filter(Boolean).length} cues for: ${metadata.name || filePath}`);
    return true;
};

/**
 * Save loop for a specific track
 * @param {string} filePath - The file path of the track
 * @param {Object} loop - Loop object { active, start, end, size }
 * @param {Object} metadata - Optional track metadata
 */
export const saveTrackLoop = (filePath, loop, metadata = {}) => {
    const key = getTrackKey(filePath);
    if (!key) return false;

    const allLoops = getAllStoredLoops();

    // Only save if loop has valid start/end
    if (loop && loop.start !== null && loop.end !== null) {
        allLoops[key] = {
            filePath,
            loop: {
                start: loop.start,
                end: loop.end,
                size: loop.size
            },
            savedAt: new Date().toISOString(),
            trackName: metadata.name || ''
        };
        saveAllLoops(allLoops);
        console.log(`[CuePersistence] Saved loop for: ${metadata.name || filePath}`);
        return true;
    } else {
        // Remove saved loop if cleared
        if (allLoops[key]) {
            delete allLoops[key];
            saveAllLoops(allLoops);
        }
        return false;
    }
};

/**
 * Delete saved cues for a specific track
 * @param {string} filePath - The file path of the track
 */
export const deleteTrackCues = (filePath) => {
    const key = getTrackKey(filePath);
    if (!key) return false;

    const allCues = getAllStoredCues();
    if (allCues[key]) {
        delete allCues[key];
        saveAllCues(allCues);
        console.log(`[CuePersistence] Deleted cues for: ${filePath}`);
        return true;
    }
    return false;
};

/**
 * Delete saved loop for a specific track
 * @param {string} filePath - The file path of the track
 */
export const deleteTrackLoop = (filePath) => {
    const key = getTrackKey(filePath);
    if (!key) return false;

    const allLoops = getAllStoredLoops();
    if (allLoops[key]) {
        delete allLoops[key];
        saveAllLoops(allLoops);
        console.log(`[CuePersistence] Deleted loop for: ${filePath}`);
        return true;
    }
    return false;
};

/**
 * Check if a track has saved cues
 * @param {string} filePath - The file path of the track
 * @returns {boolean}
 */
export const hasStoredCues = (filePath) => {
    const key = getTrackKey(filePath);
    if (!key) return false;

    const allCues = getAllStoredCues();
    const trackData = allCues[key];
    return trackData && trackData.cues && trackData.cues.some(Boolean);
};

/**
 * Check if a track has a saved loop
 * @param {string} filePath - The file path of the track
 * @returns {boolean}
 */
export const hasStoredLoop = (filePath) => {
    const key = getTrackKey(filePath);
    if (!key) return false;

    const allLoops = getAllStoredLoops();
    return !!allLoops[key];
};

/**
 * Get count of tracks with saved cues
 * @returns {number}
 */
export const getStoredCuesCount = () => {
    const allCues = getAllStoredCues();
    return Object.keys(allCues).length;
};

/**
 * Export all saved cues (for backup)
 * @returns {Object}
 */
export const exportAllCues = () => {
    return {
        cues: getAllStoredCues(),
        loops: getAllStoredLoops(),
        exportedAt: new Date().toISOString()
    };
};

/**
 * Import cues from backup
 * @param {Object} data - Exported cues data
 */
export const importCues = (data) => {
    if (data.cues) {
        const existing = getAllStoredCues();
        saveAllCues({ ...existing, ...data.cues });
    }
    if (data.loops) {
        const existing = getAllStoredLoops();
        saveAllLoops({ ...existing, ...data.loops });
    }
};

export default {
    loadTrackCues,
    loadTrackLoop,
    saveTrackCues,
    saveTrackLoop,
    deleteTrackCues,
    deleteTrackLoop,
    hasStoredCues,
    hasStoredLoop,
    getStoredCuesCount,
    exportAllCues,
    importCues
};
