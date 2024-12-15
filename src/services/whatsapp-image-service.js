const axios = require('axios');
const crypto = require('crypto');

class WhatsAppImageService {
    constructor() {
        this.axios = axios.create({
            timeout: 30000,
            maxContentLength: 10 * 1024 * 1024, // 10MB
            headers: {
                'User-Agent': 'WhatsApp/2.24.8.78 A'
            }
        });
    }

    /**
     * Baixa uma imagem do WhatsApp
     * @param {string} url - URL da imagem
     * @param {Object} mediaInfo - Informações da mídia do WhatsApp
     * @returns {Promise<Buffer>} Buffer da imagem
     */
    async downloadImage(url, mediaInfo) {
        try {
            console.log('[WhatsApp] Baixando imagem:', {
                url: url?.substring(0, 50) + '...',
                hasMediaInfo: !!mediaInfo,
                mimetype: mediaInfo?.mimetype
            });

            // Faz o download da imagem
            const response = await this.axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer'
            });

            // Converte para buffer
            let buffer = Buffer.from(response.data);
            
            // Se tiver mediaInfo, descriptografa
            if (mediaInfo?.mediaKey) {
                buffer = await this.decryptMedia(buffer, mediaInfo);
            }

            // Valida o buffer
            if (!buffer || buffer.length < 8) {
                throw new Error('Buffer inválido ou muito pequeno');
            }

            // Log do buffer para debug
            console.log('[WhatsApp] Buffer recebido:', {
                size: buffer.length,
                header: buffer.slice(0, 16).toString('hex').toUpperCase(),
                isJPEG: buffer.slice(0, 2).toString('hex').toUpperCase() === 'FFD8',
                isPNG: buffer.slice(0, 8).toString('hex').toUpperCase().includes('89504E47')
            });

            return buffer;
        } catch (error) {
            console.error('[WhatsApp] Erro ao baixar imagem:', error);
            throw new Error(`Falha ao baixar imagem: ${error.message}`);
        }
    }

    /**
     * Descriptografa mídia do WhatsApp
     * @param {Buffer} buffer - Buffer criptografado
     * @param {Object} mediaInfo - Informações da mídia
     * @returns {Promise<Buffer>} Buffer descriptografado
     */
    async decryptMedia(buffer, mediaInfo) {
        try {
            // Valida parâmetros
            if (!buffer || !mediaInfo?.mediaKey) {
                throw new Error('Parâmetros inválidos para descriptografia');
            }

            console.log('[WhatsApp] Descriptografando mídia:', {
                bufferSize: buffer.length,
                hasMediaKey: !!mediaInfo.mediaKey,
                mimetype: mediaInfo.mimetype
            });

            // Deriva as chaves
            const mediaKeyExpanded = this.expandMediaKey(
                Buffer.from(mediaInfo.mediaKey, 'base64'),
                'WhatsApp Image Keys'
            );

            // Extrai os componentes
            const iv = mediaKeyExpanded.slice(0, 16);
            const cipherKey = mediaKeyExpanded.slice(16, 48);

            // Cria o decipher
            const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
            
            // Descriptografa
            const decrypted = Buffer.concat([
                decipher.update(buffer),
                decipher.final()
            ]);

            console.log('[WhatsApp] Mídia descriptografada:', {
                originalSize: buffer.length,
                decryptedSize: decrypted.length,
                header: decrypted.slice(0, 16).toString('hex').toUpperCase()
            });

            return decrypted;

        } catch (error) {
            console.error('[WhatsApp] Erro ao descriptografar mídia:', error);
            throw new Error(`Falha ao descriptografar mídia: ${error.message}`);
        }
    }

    /**
     * Expande a chave de mídia do WhatsApp
     * @param {Buffer} mediaKey - Chave de mídia
     * @param {string} info - Informação para derivação
     * @returns {Buffer} Chave expandida
     */
    expandMediaKey(mediaKey, info) {
        try {
            // HKDF do WhatsApp
            const hmac = (key, message) => {
                const h = crypto.createHmac('sha256', key);
                h.update(message);
                return h.digest();
            };

            // Extrai
            const prk = hmac(Buffer.from('WhatsApp Media Keys'), mediaKey);
            
            // Expande
            const expanded = Buffer.alloc(112);
            let offset = 0;
            let counter = 0;

            while (offset < 112) {
                const current = Buffer.concat([
                    counter ? expanded.slice(0, offset) : Buffer.alloc(0),
                    Buffer.from(info),
                    Buffer.from([counter + 1])
                ]);

                const output = hmac(prk, current);
                output.copy(expanded, offset);
                offset += 32;
                counter++;
            }

            return expanded;

        } catch (error) {
            console.error('[WhatsApp] Erro ao expandir chave:', error);
            throw new Error(`Falha ao expandir chave: ${error.message}`);
        }
    }
}

module.exports = { WhatsAppImageService };
