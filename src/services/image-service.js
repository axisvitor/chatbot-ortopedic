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

            // Log dos metadados da imagem
            console.log('[Image] Metadados da imagem recebida:', {
                type: imageMessage.mimetype,
                size: imageMessage.fileLength,
                mediaKey: imageMessage.mediaKey ? '✓' : '✗',
                fileEncSha256: imageMessage.fileEncSha256 ? '✓' : '✗',
                fileSha256: imageMessage.fileSha256 ? '✓' : '✗',
                mediaKeyTimestamp: imageMessage.mediaKeyTimestamp,
                url: imageMessage.url ? '✓' : '✗',
                directPath: imageMessage.directPath ? '✓' : '✗'
            });

            // Verifica se temos todos os dados necessários para descriptografia
            const requiredFields = ['mediaKey', 'url', 'directPath', 'mimetype', 'fileEncSha256'];
            const missingFields = requiredFields.filter(field => !imageMessage[field]);
            
            if (missingFields.length > 0) {
                throw new Error(`Dados de mídia incompletos para descriptografia. Campos faltando: ${missingFields.join(', ')}`);
            }

            // Download e descriptografia da imagem usando Baileys
            console.log('[Image] Iniciando download e descriptografia...');
            const stream = await downloadContentFromMessage(imageMessage, 'image');
            
            if (!stream) {
                throw new Error('Falha ao iniciar download e descriptografia da imagem');
            }

            // Converter stream em buffer
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
                throw new Error('Download e descriptografia falharam - buffer vazio');
            }

            // Verifica os primeiros bytes do buffer descriptografado
            const fileHeader = buffer.slice(0, 8).toString('hex').toUpperCase();
            console.log('[Image] Imagem descriptografada:', {
                bufferSize: buffer.length,
                sizeInMB: (buffer.length / (1024 * 1024)).toFixed(2) + 'MB',
                chunks: chunks.length,
                mimeType: imageMessage.mimetype,
                fileHeader: fileHeader
            });

            // Analisar a imagem descriptografada com Groq
            const analysis = await this.groqServices.analyzeImage(buffer);
            
            return {
                success: true,
                message: 'Imagem descriptografada e analisada com sucesso',
                analysis,
                metadata: {
                    type: imageMessage.mimetype,
                    size: buffer.length,
                    width: imageMessage.width,
                    height: imageMessage.height,
                    fileHeader: fileHeader
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
