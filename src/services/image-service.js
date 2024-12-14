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
            // Verifica se temos uma mensagem com imagem
            if (!messageInfo?.mediaData?.message?.imageMessage) {
                throw new Error('Dados da imagem ausentes ou inválidos');
            }

            const imageMessage = messageInfo.mediaData.message.imageMessage;

            console.log('[Image] Iniciando processamento da imagem:', {
                type: imageMessage.mimetype,
                size: imageMessage.fileLength,
                mediaKey: imageMessage.mediaKey ? '✓' : '✗',
                fileEncSha256: imageMessage.fileEncSha256 ? '✓' : '✗',
                url: imageMessage.url || 'N/A',
                directPath: imageMessage.directPath || 'N/A',
                jpegThumbnail: imageMessage.jpegThumbnail ? '✓' : '✗'
            });

            // Verifica se temos os dados necessários
            const requiredFields = ['mediaKey', 'url', 'directPath', 'mimetype'];
            const missingFields = requiredFields.filter(field => !imageMessage[field]);
            
            if (missingFields.length > 0) {
                throw new Error(`Dados de mídia incompletos. Campos faltando: ${missingFields.join(', ')}`);
            }

            // Primeiro tenta usar o jpegThumbnail se disponível (mais rápido)
            if (imageMessage.jpegThumbnail) {
                console.log('[Image] Tentando usar thumbnail JPEG...');
                try {
                    const analysis = await this.groqServices.analyzeImage(imageMessage.jpegThumbnail);
                    return {
                        success: true,
                        message: 'Imagem analisada com sucesso (via thumbnail)',
                        analysis,
                        metadata: {
                            source: 'thumbnail',
                            type: 'image/jpeg',
                            size: imageMessage.jpegThumbnail.length
                        }
                    };
                } catch (thumbError) {
                    console.log('[Image] Falha ao usar thumbnail, tentando download completo:', thumbError.message);
                }
            }

            // Se não tem thumbnail ou falhou, faz o download completo
            console.log('[Image] Baixando imagem completa...');
            const stream = await downloadContentFromMessage(imageMessage, 'image');
            
            if (!stream) {
                throw new Error('Não foi possível iniciar o download da imagem');
            }

            // Converter stream em buffer com timeout de segurança
            const chunks = [];
            let totalSize = 0;
            
            for await (const chunk of stream) {
                chunks.push(chunk);
                totalSize += chunk.length;
                
                if (totalSize > this.maxImageSize) {
                    throw new Error(`Imagem excede o tamanho máximo permitido de ${this.maxImageSize / (1024 * 1024)}MB`);
                }
            }
            
            const buffer = Buffer.concat(chunks);

            if (!buffer.length) {
                throw new Error('Download da imagem falhou - buffer vazio');
            }

            console.log('[Image] Download concluído:', {
                bufferSize: buffer.length,
                sizeInMB: (buffer.length / (1024 * 1024)).toFixed(2) + 'MB',
                chunks: chunks.length,
                mimeType: imageMessage.mimetype
            });

            // Analisar a imagem com Groq
            const analysis = await this.groqServices.analyzeImage(buffer);
            
            return {
                success: true,
                message: 'Imagem analisada com sucesso',
                analysis,
                metadata: {
                    source: 'download',
                    type: imageMessage.mimetype,
                    size: buffer.length,
                    width: imageMessage.width,
                    height: imageMessage.height
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
