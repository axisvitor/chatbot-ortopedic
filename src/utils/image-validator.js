const supportedFormats = {
    'image/jpeg': ['FFD8FF'],
    'image/png': ['89504E47'],
    'image/gif': ['47494638'],
    'image/webp': ['52494646'],
    'image/tiff': ['49492A00', '4D4D002A']
};

/**
 * Detecta o formato da imagem baseado no cabeçalho do buffer
 * @param {Buffer} buffer - Buffer da imagem
 * @returns {string|null} - MIME type da imagem ou null se não reconhecido
 */
function detectImageFormat(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
        return null;
    }

    const header = buffer.slice(0, 4).toString('hex').toUpperCase();
    for (const [format, signatures] of Object.entries(supportedFormats)) {
        if (signatures.some(sig => header.startsWith(sig))) {
            return format;
        }
    }
    return null;
}

/**
 * Valida se o buffer contém uma imagem válida
 * @param {Buffer} buffer - Buffer da imagem
 * @returns {boolean} - true se for uma imagem válida
 */
async function validateImageBuffer(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        return false;
    }

    // Verifica tamanho mínimo
    if (buffer.length < 100) {
        return false;
    }

    // Verifica formato
    const format = detectImageFormat(buffer);
    if (!format) {
        return false;
    }

    return true;
}

/**
 * Valida uma string base64 de imagem
 * @param {string} base64String - String base64 da imagem
 * @returns {boolean} - true se for uma base64 válida
 */
function isValidBase64Image(base64String) {
    if (typeof base64String !== 'string') {
        return false;
    }

    // Verifica se é uma data URL válida
    if (base64String.startsWith('data:')) {
        const match = base64String.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
        if (!match) {
            return false;
        }
        base64String = match[2];
    }

    try {
        const buffer = Buffer.from(base64String, 'base64');
        return buffer.length > 0;
    } catch (e) {
        return false;
    }
}

module.exports = {
    detectImageFormat,
    validateImageBuffer,
    isValidBase64Image,
    supportedFormats
};
