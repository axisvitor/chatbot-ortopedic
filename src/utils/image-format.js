const magicNumbers = {
    'FFD8FF': 'image/jpeg',
    '89504E47': 'image/png',
    '47494638': 'image/gif',
    '52494646': 'image/webp',
    '424D': 'image/bmp',
    'FFD8FFE0': 'image/jpeg', // JFIF
    'FFD8FFE1': 'image/jpeg', // EXIF
    'FFD8FFE8': 'image/jpeg'  // SPIFF
};

/**
 * Detecta o formato de uma imagem a partir do seu buffer
 * @param {Buffer} buffer - Buffer contendo os dados da imagem
 * @returns {string|null} - Tipo MIME da imagem ou null se não reconhecido
 */
function detectImageFormatFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
        console.error('Buffer inválido:', {
            isBuffer: Buffer.isBuffer(buffer),
            length: buffer?.length
        });
        return null;
    }

    // Aumenta para 8 bytes para melhor detecção
    const fileHeader = buffer.slice(0, 8).toString('hex').toUpperCase();
    
    console.log('Analisando cabeçalho da imagem:', {
        header: fileHeader,
        bufferLength: buffer.length,
        firstBytes: buffer.slice(0, 16).toString('hex').toUpperCase()
    });

    // Tenta encontrar padrões conhecidos em todo o cabeçalho
    for (const [magic, format] of Object.entries(magicNumbers)) {
        if (fileHeader.includes(magic)) {
            return format;
        }
    }

    // Caso especial para JPEG com variações
    if (fileHeader.includes('FFD8') || fileHeader.includes('JFIF') || fileHeader.includes('EXIF')) {
        return 'image/jpeg';
    }

    return null;
}

/**
 * Valida a resposta da API Groq
 * @param {Object} response - Resposta da API
 * @returns {Object} Objeto com status da validação
 */
function validateGroqResponse(response) {
    if (!response?.data) {
        return {
            isValid: false,
            error: 'Resposta vazia da API'
        };
    }

    const { choices } = response.data;
    if (!Array.isArray(choices) || choices.length === 0) {
        return {
            isValid: false,
            error: 'Resposta não contém escolhas válidas'
        };
    }

    const content = choices[0]?.message?.content;
    if (!content) {
        return {
            isValid: false,
            error: 'Conteúdo da resposta não encontrado'
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
