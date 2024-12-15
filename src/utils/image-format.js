/**
 * Detecta o formato de uma imagem a partir de seu buffer
 * @param {Buffer} buffer - Buffer contendo os dados da imagem
 * @returns {string|null} - MIME type da imagem ou null se não reconhecido
 */
function detectImageFormatFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
        return null;
    }

    const header = buffer.slice(0, 8);
    const hex = header.toString('hex').toUpperCase();

    // Log detalhado para debug
    console.log('[Format] Analisando header:', {
        hex,
        ascii: header.toString('ascii').replace(/[^\x20-\x7E]/g, '.'),
        length: buffer.length
    });

    // JPEG: FFD8 FF
    if (hex.startsWith('FFD8')) {
        return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (hex === '89504E470D0A1A0A') {
        return 'image/png';
    }

    // GIF: 47 49 46 38
    if (hex.startsWith('474946')) {
        return 'image/gif';
    }

    // WEBP: 52 49 46 46 + 4 bytes + 57 45 42 50
    if (hex.startsWith('52494646') && buffer.length >= 12 && 
        buffer.slice(8, 12).toString('hex').toUpperCase().includes('WEBP')) {
        return 'image/webp';
    }

    // BMP: 42 4D
    if (hex.startsWith('424D')) {
        return 'image/bmp';
    }

    // HEIC: 66 74 79 70 68 65 69 63
    if (buffer.length > 12 && buffer.slice(4, 12).toString('hex').toUpperCase().includes('66747970686569')) {
        return 'image/heic';
    }

    console.log('[Format] Formato não reconhecido:', {
        hex,
        ascii: header.toString('ascii').replace(/[^\x20-\x7E]/g, '.'),
        length: buffer.length
    });

    return null;
}

module.exports = { detectImageFormatFromBuffer };
