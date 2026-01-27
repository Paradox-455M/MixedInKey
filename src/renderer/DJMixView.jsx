import React, { useState } from 'react';
import { Download } from 'lucide-react';
import DJDeck from './DJDeck';
import LibraryTable from './LibraryTable';
import './djMixView.css';

const DJMixView = ({ 
    analyzedTracks, 
    onAnalyzeFile,
    onLoadToDeck 
}) => {
    const [deckA, setDeckA] = useState(null);
    const [deckB, setDeckB] = useState(null);
    const [activeDeckId, setActiveDeckId] = useState('A');
    const [mixSession, setMixSession] = useState([]); // Track history of what's been loaded/mixed

    // Get the currently active track to drive library suggestions
    const activeTrack = activeDeckId === 'A' ? deckA : deckB;

    const handleLoadTrack = async (file, deckId) => {
        // If file needs analysis, trigger it
        // Note: For simplicity, we assume file is already analyzed or we trigger analysis
        // In a real app, we might need to await analysis
        
        // Check if already in library
        const existing = analyzedTracks.find(t => t.file.path === file.path);
        
        if (existing) {
            loadTrackToDeck(existing, deckId);
        } else {
            // Trigger analysis via parent callback
            try {
                const result = await onAnalyzeFile(file);
                const newTrack = { file, analysis: result };
                loadTrackToDeck(newTrack, deckId);
            } catch (err) {
                console.error("Failed to analyze track for deck:", err);
            }
        }
    };

    const loadTrackToDeck = (track, deckId) => {
        if (deckId === 'A') setDeckA(track);
        else setDeckB(track);
        
        // Add to session history if not the last one
        setMixSession(prev => {
            const lastTrack = prev[prev.length - 1];
            if (!lastTrack || lastTrack.file.path !== track.file.path) {
                return [...prev, track];
            }
            return prev;
        });
    };

    const handleLibraryTrackSelect = (track) => {
        // Load into the INACTIVE deck
        const targetDeck = activeDeckId === 'A' ? 'B' : 'A';
        loadTrackToDeck(track, targetDeck);
        setActiveDeckId(targetDeck);
    };

    const handleExportMix = async () => {
        if (mixSession.length === 0) return;
        
        try {
            const playlistName = `Recorded Mix ${new Date().toISOString().slice(0, 10)}`;
            
            // Convert to format expected by export tools
            const tracks = mixSession.map(t => ({
                path: t.file.path,
                name: t.file.name,
                artist: t.analysis.artist || 'Unknown Artist',
                key: t.analysis.key,
                bpm: t.analysis.bpm
            }));

            // Use existing export logic via main process
            // Here we default to Rekordbox XML as it's the most universal
            const exportPath = await window.electronAPI.exportRekordboxXml({
                playlistName,
                tracks,
                includeCuePoints: true
            });
            
            if (exportPath) {
                alert(`Mix exported successfully to: ${exportPath}`);
            }
        } catch (err) {
            console.error('Export failed:', err);
            alert(`Export failed: ${err.message}`);
        }
    };

    return (
        <div className="dj-mix-view">
            <div className="mix-header-actions" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
                <button 
                    className="export-button" 
                    onClick={handleExportMix}
                    disabled={mixSession.length === 0}
                    style={{ 
                        opacity: mixSession.length === 0 ? 0.5 : 1,
                        cursor: mixSession.length === 0 ? 'not-allowed' : 'pointer'
                    }}
                >
                    <Download size={16} />
                    Export Mix History ({mixSession.length})
                </button>
            </div>

            <div className="decks-container">
                <DJDeck 
                    id="A"
                    track={deckA}
                    isActive={activeDeckId === 'A'}
                    onActivate={() => setActiveDeckId('A')}
                    onLoadTrack={(file) => handleLoadTrack(file, 'A')}
                    onClear={() => setDeckA(null)}
                />
                
                <DJDeck 
                    id="B"
                    track={deckB}
                    isActive={activeDeckId === 'B'}
                    onActivate={() => setActiveDeckId('B')}
                    onLoadTrack={(file) => handleLoadTrack(file, 'B')}
                    onClear={() => setDeckB(null)}
                />
            </div>

            <div className="mix-library-section">
                <h3 className="section-title">
                    Library Suggestions 
                    {activeTrack && <span className="suggestion-subtitle"> (Compatible with Deck {activeDeckId})</span>}
                </h3>
                <LibraryTable 
                    tracks={analyzedTracks}
                    currentTrack={activeTrack} // Drives compatibility logic
                    onTrackSelect={handleLibraryTrackSelect}
                    multiSelect={false}
                />
            </div>
        </div>
    );
};

export default DJMixView;
