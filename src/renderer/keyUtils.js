export const getKeyColor = (key) => {
    // Official-ish Camelot colors
    const colors = {
        '1A': '#00CD9B', '1B': '#00CD9B', // Green-Blue
        '2A': '#00C358', '2B': '#00C358', // Green
        '3A': '#5BC500', '3B': '#5BC500', // Green-Yellow
        '4A': '#BFCC00', '4B': '#BFCC00', // Yellow
        '5A': '#DD9C00', '5B': '#DD9C00', // Orange-Yellow
        '6A': '#E05400', '6B': '#E05400', // Orange
        '7A': '#E21000', '7B': '#E21000', // Red-Orange
        '8A': '#E30048', '8B': '#E30048', // Red
        '9A': '#E40097', '9B': '#E40097', // Pink-Red
        '10A': '#CF00E5', '10B': '#CF00E5', // Purple
        '11A': '#8500E5', '11B': '#8500E5', // Purple-Blue
        '12A': '#0036E6', '12B': '#0036E6', // Blue
    };
    return colors[key] || '#808080';
};

export const shiftKey = (key, semitones) => {
    if (!key) return key;
    const match = key.match(/(\d+)([AB])/);
    if (!match) return key;

    let num = parseInt(match[1]);
    const letter = match[2];

    // Camelot wheel: +1 semitone = +7 hours (approx)
    // +1 semitone is adding 7 to the clock (mod 12)

    let newNum = (num + (semitones * 7)) % 12;
    if (newNum <= 0) newNum += 12;

    return `${newNum}${letter}`;
};
