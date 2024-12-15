const crypto = require('crypto');
const { magicNumbers } = require('./image-format');

/**
 * Descriptografa mídia do WhatsApp
 * @param {Buffer} encryptedBuffer - Buffer criptografado
 * @param {Object} mediaInfo - Informações da mídia
 * @returns {Buffer} Buffer descriptografado
 */
async function decryptMedia(encryptedBuffer, mediaInfo) {
    try {
        if (!encryptedBuffer || !Buffer.isBuffer(encryptedBuffer)) {
            throw new Error('Buffer criptografado inválido');
        }

        if (!mediaInfo?.mediaKey) {
            throw new Error('Chave de mídia não fornecida');
        }

        console.log('[WhatsApp] Iniciando descriptografia:', {
            bufferSize: encryptedBuffer.length,
            mediaKeyLength: mediaInfo.mediaKey?.length,
            firstBytesEncrypted: encryptedBuffer.slice(0, 16).toString('hex').toUpperCase()
        });

        // Decodifica a chave de mídia
        const mediaKeyBuffer = Buffer.from(mediaInfo.mediaKey, 'base64');
        
        // Gera chaves para descriptografia
        const iv = crypto.randomBytes(16);
        const key = crypto.createHash('sha256').update(mediaKeyBuffer).digest();

        // Cria decipher
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        
        // Descriptografa
        const decrypted = Buffer.concat([
            decipher.update(encryptedBuffer),
            decipher.final()
        ]);

        // Verifica se o buffer descriptografado tem um formato válido
        const header = decrypted.slice(0, 4).toString('hex').toUpperCase();
        console.log('[WhatsApp] Header após descriptografia:', {
            header,
            knownFormats: Object.keys(magicNumbers)
        });

        // Log detalhado do buffer descriptografado
        console.log('[WhatsApp] Buffer descriptografado:', {
            size: decrypted.length,
            header: decrypted.slice(0, 16).toString('hex').toUpperCase(),
            isValidBuffer: Buffer.isBuffer(decrypted)
        });

        return decrypted;

    } catch (error) {
        console.error('[WhatsApp] Erro na descriptografia:', {
            message: error.message,
            stack: error.stack,
            bufferInfo: {
                size: encryptedBuffer?.length,
                isBuffer: Buffer.isBuffer(encryptedBuffer)
            }
        });
        throw error;
    }
}

module.exports = {
    decryptMedia
};
