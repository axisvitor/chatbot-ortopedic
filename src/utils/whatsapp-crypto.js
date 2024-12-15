const crypto = require('crypto');

/**
 * Descriptografa dados de mídia do WhatsApp
 * @param {Buffer} buffer - Buffer criptografado
 * @param {Object} mediaInfo - Informações da mídia do WhatsApp
 * @returns {Buffer} Buffer descriptografado
 */
async function decryptMedia(buffer, mediaInfo) {
    try {
        if (!buffer || !mediaInfo) {
            throw new Error('Buffer ou informações de mídia ausentes');
        }

        // Se não houver informações de criptografia, retorna o buffer original
        if (!mediaInfo.mediaKey) {
            console.log('[WhatsApp] Mídia não está criptografada');
            return buffer;
        }

        console.log('[WhatsApp] Descriptografando mídia:', {
            size: buffer.length,
            hasMediaKey: !!mediaInfo.mediaKey,
            mimetype: mediaInfo.mimetype
        });

        // Decodifica a chave de mídia
        const mediaKey = Buffer.from(mediaInfo.mediaKey, 'base64');

        // Gera as chaves de criptografia
        const expandedMediaKey = crypto.createHash('sha256')
            .update(mediaKey)
            .digest();

        const iv = expandedMediaKey.slice(0, 16);
        const key = expandedMediaKey.slice(16, 48);

        // Cria o decipher
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        
        // Descriptografa
        const decrypted = Buffer.concat([
            decipher.update(buffer),
            decipher.final()
        ]);

        console.log('[WhatsApp] Mídia descriptografada com sucesso:', {
            originalSize: buffer.length,
            decryptedSize: decrypted.length
        });

        return decrypted;

    } catch (error) {
        console.error('[WhatsApp] Erro ao descriptografar mídia:', error);
        throw new Error(`Falha ao descriptografar mídia: ${error.message}`);
    }
}

module.exports = {
    decryptMedia
};
