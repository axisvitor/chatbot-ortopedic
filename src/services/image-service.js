const fs = require('fs').promises;
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

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
    }

    async processWhatsAppImage(messageInfo) {
        try {
            if (!messageInfo?.mediaData?.message) {
                throw new Error('Dados da imagem ausentes ou inválidos');
            }

            const imageMessage = messageInfo.mediaData.message;
            const mimeType = this._normalizeImageMimeType(imageMessage.mimetype);

            if (!this._isValidImageMimeType(mimeType)) {
                throw new Error(`Formato de imagem não suportado: ${mimeType}`);
            }

            console.log('[Image] Iniciando processamento da imagem:', {
                type: mimeType,
                size: imageMessage.fileLength,
                mediaKey: imageMessage.mediaKey ? '✓' : '✗',
                fileEncSha256: imageMessage.fileEncSha256 ? '✓' : '✗'
            });

            // Verificar tamanho antes do download
            if (imageMessage.fileLength > this.maxImageSize) {
                throw new Error(`Imagem muito grande. Tamanho máximo permitido: ${this.maxImageSize / (1024 * 1024)}MB`);
            }
            
            // Download e descriptografia da imagem usando Baileys
            console.log('[Image] Baixando e descriptografando imagem...');
            const stream = await downloadContentFromMessage(imageMessage, 'image');
            
            if (!stream) {
                throw new Error('Não foi possível iniciar o download da imagem');
            }

            // Converter stream em buffer com verificação de tamanho
            let buffer = Buffer.from([]);
            let totalSize = 0;
            
            for await (const chunk of stream) {
                totalSize += chunk.length;
                if (totalSize > this.maxImageSize) {
                    throw new Error(`Imagem excede o tamanho máximo permitido de ${this.maxImageSize / (1024 * 1024)}MB`);
                }
                buffer = Buffer.concat([buffer, chunk]);
            }

            if (!buffer.length) {
                throw new Error('Download da imagem falhou - buffer vazio');
            }

            console.log('[Image] Download e descriptografia concluídos:', {
                bufferSize: buffer.length,
                sizeInMB: (buffer.length / (1024 * 1024)).toFixed(2) + 'MB',
                mimeType,
                primeirosBytes: buffer.slice(0, 16).toString('hex')
            });

            // Analisar a imagem com Groq
            const analysis = await this.groqServices.analyzeImage(buffer);
            console.log('[Image] Análise concluída:', {
                success: true,
                analysisLength: analysis?.length || 0
            });

            return {
                success: true,
                message: 'Imagem analisada com sucesso',
                analysis,
                metadata: {
                    mimeType,
                    size: buffer.length,
                    sizeInMB: (buffer.length / (1024 * 1024)).toFixed(2)
                }
            };

        } catch (error) {
            console.error('[Image] Erro ao processar imagem:', {
                message: error.message,
                type: error.type,
                code: error.code,
                stack: error.stack
            });

            return {
                success: false,
                message: this._getErrorMessage(error),
                error: error.message
            };
        }
    }

    async isPaymentProof(messageInfo) {
        try {
            const paymentKeywords = [
                'comprovante',
                'pagamento',
                'transferência',
                'pix',
                'recibo',
                'boleto',
                'ted',
                'doc',
                'depósito',
                'bancário'
            ];

            // Verifica se há palavras-chave na legenda da imagem
            if (messageInfo.mediaData?.caption) {
                const caption = messageInfo.mediaData.caption.toLowerCase();
                if (paymentKeywords.some(keyword => caption.includes(keyword))) {
                    return true;
                }
            }

            // Processa a imagem para análise
            const result = await this.processWhatsAppImage(messageInfo);
            if (!result.success) {
                return false;
            }

            // Verifica se a análise contém palavras-chave relacionadas a pagamento
            const analysisText = result.analysis.toLowerCase();
            return paymentKeywords.some(keyword => analysisText.includes(keyword));

        } catch (error) {
            console.error('[PaymentProof] Erro ao analisar imagem:', error);
            return false;
        }
    }

    _normalizeImageMimeType(mimetype) {
        if (!mimetype) return 'image/jpeg'; // default
        return mimetype.split(';')[0].trim().toLowerCase();
    }

    _isValidImageMimeType(mimetype) {
        const normalizedType = this._normalizeImageMimeType(mimetype);
        return this.validMimeTypes.has(normalizedType);
    }

    _getErrorMessage(error) {
        const errorMessages = {
            'Imagem muito grande': 'A imagem é muito grande. Por favor, envie uma imagem menor que 4MB.',
            'Formato de imagem não suportado': 'Formato de imagem não suportado. Por favor, envie em JPEG, PNG ou WebP.',
            'Dados da imagem ausentes': 'Não foi possível processar a imagem. Por favor, tente enviar novamente.',
            'Download da imagem falhou': 'Falha ao baixar a imagem. Por favor, tente novamente.'
        };

        for (const [key, message] of Object.entries(errorMessages)) {
            if (error.message.includes(key)) return message;
        }

        return 'Desculpe, ocorreu um erro ao processar sua imagem. Por favor, tente novamente.';
    }
}

module.exports = { ImageService };
