const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { isValidBase64Image } = require('../utils/image-validator');

class WhatsAppImageService {
    constructor(groqServices) {
        this.groqServices = groqServices;
        this.tempDir = path.join(__dirname, '../../temp');
        this.maxImageSize = 4 * 1024 * 1024; // 4MB
        this.validMimeTypes = new Set([
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp'
        ]);
        
        this.initTempDir();
    }

    async initTempDir() {
        try {
            await fs.access(this.tempDir);
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.mkdir(this.tempDir, { recursive: true });
                console.log(`[WhatsAppImage] Pasta temp criada em: ${this.tempDir}`);
            }
        }
    }

    async downloadImage(url, timeout = 30000) {
        try {
            console.log('[WhatsAppImage] Iniciando download da URL:', url);
            
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                timeout: timeout,
                maxContentLength: this.maxImageSize,
                validateStatus: (status) => status === 200
            });

            return Buffer.from(response.data);
        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                throw new Error('Timeout ao baixar imagem');
            }
            throw new Error(`Erro ao baixar imagem: ${error.message}`);
        }
    }

    async processMessageImage(messageInfo) {
        try {
            console.log('[WhatsAppImage] Processando mensagem:', {
                type: messageInfo.type,
                hasUrl: !!messageInfo?.imageMessage?.url,
                hasThumbnail: !!messageInfo?.imageMessage?.jpegThumbnail,
                mimetype: messageInfo?.imageMessage?.mimetype
            });

            // Verifica se temos uma URL válida
            const imageUrl = messageInfo?.imageMessage?.url;
            if (!imageUrl) {
                throw new Error('URL da imagem não encontrada na mensagem');
            }

            // Remove caracteres estranhos da URL (como ";," no final)
            const cleanUrl = imageUrl.replace(/[;,]+$/, '');

            // Verifica o tipo MIME
            const mimetype = messageInfo?.imageMessage?.mimetype;
            if (!this.validMimeTypes.has(mimetype)) {
                throw new Error(`Tipo de imagem não suportado: ${mimetype}`);
            }

            // Download da imagem
            const buffer = await this.downloadImage(cleanUrl);
            
            // Validações do buffer
            if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
                throw new Error('Download resultou em dados inválidos');
            }

            if (buffer.length > this.maxImageSize) {
                throw new Error(`Imagem muito grande (max: ${this.maxImageSize / (1024 * 1024)}MB)`);
            }

            // Converte para base64 e valida
            const base64Data = buffer.toString('base64');
            const base64String = `data:${mimetype};base64,${base64Data}`;
            
            if (!isValidBase64Image(base64String)) {
                throw new Error('Imagem inválida ou corrompida após download');
            }

            // Log detalhado do buffer
            console.log('[WhatsAppImage] Buffer validado:', {
                size: buffer.length,
                header: buffer.slice(0, 16).toString('hex').toUpperCase(),
                mime: mimetype
            });

            // Análise da imagem
            const analysis = await this.groqServices.analyzeImage(buffer);
            
            return {
                success: true,
                message: 'Imagem processada com sucesso',
                analysis,
                metadata: {
                    type: mimetype,
                    size: buffer.length,
                    url: cleanUrl
                }
            };

        } catch (error) {
            console.error('[WhatsAppImage] Erro:', error);
            return {
                success: false,
                message: error.message,
                error: error.stack
            };
        }
    }
}

module.exports = { WhatsAppImageService };
