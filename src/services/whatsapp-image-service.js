const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { validateImageBuffer, detectImageFormat } = require('../utils/image-validator');
const { decryptMedia } = require('../utils/whatsapp-crypto');

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

    async downloadImage(url, mediaInfo, timeout = 30000) {
        try {
            // Log detalhado das informações da mensagem
            console.log('[WhatsAppImage] Informações da mensagem:', {
                mediaKey: !!mediaInfo?.mediaKey,
                mimetype: mediaInfo?.mimetype,
                size: mediaInfo?.fileLength,
                url: url?.substring(0, 50) + '...'
            });

            console.log('[WhatsAppImage] Iniciando download da URL:', url);
            
            const response = await axios({
                method: 'GET',
                url: url,
                responseType: 'arraybuffer',
                timeout: timeout,
                maxContentLength: this.maxImageSize,
                validateStatus: (status) => status === 200
            });

            // Primeiro cria o buffer dos dados brutos
            let buffer = Buffer.from(response.data);

            // Log do buffer baixado
            console.log('[WhatsAppImage] Buffer baixado:', {
                size: buffer.length,
                header: buffer.slice(0, 16).toString('hex').toUpperCase()
            });
            
            // Tenta descriptografar se houver informações de mídia
            if (mediaInfo) {
                console.log('[WhatsAppImage] Tentando descriptografar imagem:', {
                    hasMediaKey: !!mediaInfo.mediaKey,
                    mimetype: mediaInfo.mimetype
                });
                buffer = await decryptMedia(buffer, mediaInfo);
            }
            
            // Validação adicional do buffer
            if (!await validateImageBuffer(buffer)) {
                throw new Error('Download resultou em uma imagem inválida');
            }

            return buffer;
        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                throw new Error('Timeout ao baixar imagem');
            }
            throw new Error(`Erro ao baixar imagem: ${error.message}`);
        }
    }

    async processMessageImage(messageInfo) {
        try {
            if (!messageInfo?.imageMessage) {
                throw new Error('Dados da imagem ausentes ou inválidos');
            }

            console.log('[WhatsAppImage] Processando mensagem:', {
                type: messageInfo.type,
                hasUrl: !!messageInfo?.imageMessage?.url,
                hasThumbnail: !!messageInfo?.imageMessage?.jpegThumbnail,
                hasMediaKey: !!messageInfo?.imageMessage?.mediaKey,
                mimetype: messageInfo?.imageMessage?.mimetype
            });

            // Verifica se temos uma URL válida
            const imageUrl = messageInfo?.imageMessage?.url;
            if (!imageUrl) {
                throw new Error('URL da imagem não encontrada na mensagem');
            }

            // Remove caracteres estranhos da URL
            const cleanUrl = imageUrl.replace(/[;,]+$/, '');

            // Verifica o tipo MIME
            const mimetype = messageInfo?.imageMessage?.mimetype;
            if (!this.validMimeTypes.has(mimetype)) {
                throw new Error(`Tipo de imagem não suportado: ${mimetype}`);
            }

            // Download e validação da imagem
            const buffer = await this.downloadImage(cleanUrl, messageInfo.imageMessage);
            
            // Validações adicionais do buffer
            if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
                throw new Error('Download resultou em dados inválidos ou imagem muito pequena');
            }

            if (buffer.length > this.maxImageSize) {
                throw new Error(`Imagem muito grande (max: ${this.maxImageSize / (1024 * 1024)}MB)`);
            }

            // Log detalhado do buffer final
            console.log('[WhatsAppImage] Buffer final:', {
                size: buffer.length,
                header: buffer.slice(0, 16).toString('hex').toUpperCase(),
                isValidBuffer: Buffer.isBuffer(buffer)
            });

            // Análise da imagem com Groq
            const analysis = await this.groqServices.analyzeImage(buffer);
            
            return {
                success: true,
                message: 'Imagem processada com sucesso',
                analysis: analysis,
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
                message: 'Não foi possível processar esta imagem. Por favor, tente enviar em outro formato (JPEG ou PNG) ou tire uma nova foto com melhor qualidade.',
                error: error.message,
                technicalDetails: error.stack
            };
        }
    }
}

module.exports = { WhatsAppImageService };
