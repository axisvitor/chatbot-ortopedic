const fs = require('fs').promises;
const path = require('path');
const { isValidBase64Image } = require('../utils/image-validator');

class ImageService {
    constructor(groqServices) {
        this.groqServices = groqServices;
        this.tempDir = path.join(__dirname, '../../temp');
        this.maxImageSize = 4 * 1024 * 1024; // 4MB em bytes
        this.validMimeTypes = new Set([
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp',
            'image/heic',
            'image/heif'
        ]);
        
        this.initTempDir();
    }

    async initTempDir() {
        try {
            await fs.access(this.tempDir);
        } catch (error) {
            if (error.code === 'ENOENT') {
                try {
                    await fs.mkdir(this.tempDir, { recursive: true });
                    console.log(`[ImageService] Pasta temp criada em: ${this.tempDir}`);
                } catch (mkdirError) {
                    console.error('[ImageService] Erro ao criar pasta temp:', mkdirError);
                }
            } else {
                console.error('[ImageService] Erro ao verificar pasta temp:', error);
            }
        }
    }

    async processWhatsAppImage(messageInfo) {
        try {
            if (!messageInfo?.mediaData) {
                throw new Error('Dados da imagem ausentes ou inválidos');
            }

            console.log('[Image] Recebida mensagem com imagem:', {
                type: messageInfo.type,
                size: messageInfo.size,
                mimetype: messageInfo.mimetype,
                hasMedia: !!messageInfo.mediaData
            });

            // Verifica o tipo MIME
            if (!this.validMimeTypes.has(messageInfo.mimetype)) {
                throw new Error(`Tipo de imagem não suportado: ${messageInfo.mimetype}`);
            }

            // Verifica o tamanho
            if (messageInfo.size > this.maxImageSize) {
                throw new Error(`Imagem muito grande (max: ${this.maxImageSize / (1024 * 1024)}MB)`);
            }

            console.log('[Image] Iniciando download...');
            
            // Download da mídia com timeout
            const buffer = await Promise.race([
                messageInfo.mediaData.download(),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout no download')), 30000)
                )
            ]);
            
            // Validação do buffer
            if (!Buffer.isBuffer(buffer)) {
                throw new Error('Download falhou: resultado não é um buffer válido');
            }

            if (buffer.length < 8) {
                throw new Error('Download falhou: buffer muito pequeno');
            }

            // Converte para base64 para validação
            const base64Data = buffer.toString('base64');
            if (!isValidBase64Image(`data:${messageInfo.mimetype};base64,${base64Data}`)) {
                throw new Error('Imagem inválida ou corrompida após download');
            }

            // Log detalhado do buffer
            console.log('[Image] Verificação do buffer:', {
                isBuffer: Buffer.isBuffer(buffer),
                size: buffer.length,
                header: buffer.slice(0, 16).toString('hex').toUpperCase(),
                mime: messageInfo.mimetype,
                base64Length: base64Data.length
            });

            // Análise da imagem com Groq
            const analysis = await this.groqServices.analyzeImage(buffer);
            
            return {
                success: true,
                message: 'Imagem processada com sucesso',
                analysis,
                metadata: {
                    type: messageInfo.mimetype,
                    size: buffer.length,
                    filename: messageInfo.filename || 'image'
                }
            };

        } catch (error) {
            console.error('[Image] Erro:', error);
            return {
                success: false,
                message: error.message,
                error: error.stack
            };
        }
    }
}

module.exports = { ImageService };
