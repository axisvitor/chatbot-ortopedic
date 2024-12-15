/**
 * Utilitários para detecção e validação de formatos de imagem
 */

const magicNumbers = {
    'FFD8FF': 'image/jpeg',    // JPEG
    '89504E47': 'image/png',   // PNG
    '47494638': 'image/gif',   // GIF
    '52494646': 'image/webp',  // WEBP
    '49492A00': 'image/tiff',  // TIFF
    '4D4D002A': 'image/tiff'   // TIFF (big endian)
};

/**
 * Detecta o formato da imagem a partir do buffer
 * @param {Buffer} buffer - Buffer contendo os dados da imagem
 * @returns {string|null} - MIME type da imagem ou null se não reconhecido
 */
function detectImageFormatFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
        return null;
    }

    const fileHeader = buffer.slice(0, 4).toString('hex').toUpperCase();
    
    // Log para debug
    console.debug('Analisando cabeçalho da imagem:', {
        header: fileHeader,
        bufferLength: buffer.length,
        firstBytes: buffer.slice(0, 16).toString('hex').toUpperCase()
    });

    // Verifica magic numbers conhecidos
    for (const [magic, format] of Object.entries(magicNumbers)) {
        if (fileHeader.startsWith(magic)) {
            return format;
        }
    }

    // Caso especial para JPEG que pode ter variações no header
    if (fileHeader.startsWith('FFD8')) {
        return 'image/jpeg';
    }

    return null;
}

/**
 * Valida a resposta da API Groq
 * @param {Object} response - Resposta da API
 * @returns {Object} - Objeto com status da validação e mensagem/conteúdo
 */
function validateGroqResponse(response) {
    if (!response?.data) {
        return {
            isValid: false,
            error: 'Resposta da API não contém dados'
        };
    }

    if (!Array.isArray(response.data.choices) || response.data.choices.length === 0) {
        return {
            isValid: false,
            error: 'Resposta da API não contém choices válidos'
        };
    }

    const content = response.data.choices[0]?.message?.content;
    if (!content) {
        return {
            isValid: false,
            error: 'Resposta da API não contém conteúdo válido'
        };
    }

    return {
        isValid: true,
        content
    };
}

module.exports = {
    detectImageFormatFromBuffer,
    validateGroqResponse,
    magicNumbers
};
