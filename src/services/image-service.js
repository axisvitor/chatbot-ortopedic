const fs = require('fs').promises;
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

class ImageService {
    constructor(groqServices) {
        this.groqServices = groqServices;
        this.tempDir = path.join(__dirname, '../../temp');
    }

    async processWhatsAppImage(messageInfo) {
        try {
            if (!messageInfo?.mediaData?.message) {
                throw new Error('Dados da imagem ausentes ou inválidos');
            }

            console.log('[Image] Iniciando processamento da imagem:', {
                type: messageInfo.mediaData.message.mimetype,
                size: messageInfo.mediaData.message.fileLength
            });
            
            // Download e descriptografia da imagem usando Baileys
            const stream = await downloadContentFromMessage(messageInfo.mediaData.message, 'image');
            let buffer = Buffer.from([]);
            
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }

            if (!buffer.length) {
                console.error('❌ Buffer vazio após download');
                throw new Error('Download da imagem falhou');
            }

            console.log('[Image] Download concluído, tamanho:', buffer.length);

            // Analisar a imagem com Groq
            const analysis = await this.groqServices.analyzeImage(buffer);
            console.log('[Image] Análise concluída:', analysis);

            return {
                success: true,
                message: 'Imagem analisada com sucesso',
                analysis
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
                message: 'Desculpe, não foi possível processar sua imagem. Por favor, tente novamente.'
            };
        }
    }

    async isPaymentProof(messageInfo) {
        try {
            // Palavras-chave no texto da imagem ou na mensagem
            const paymentKeywords = [
                'comprovante',
                'pagamento',
                'transferência',
                'pix',
                'recibo',
                'boleto'
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

    async _cleanupTempFile(filePath) {
        try {
            if (await fs.access(filePath).then(() => true).catch(() => false)) {
                await fs.unlink(filePath);
                console.log('🗑️ Arquivo temporário removido:', { path: filePath });
            }
        } catch (error) {
            console.error('⚠️ Erro ao remover arquivo temporário:', error);
        }
    }

    _isValidImageMimeType(mimetype) {
        if (!mimetype) return false;

        // Limpa o mimetype removendo parâmetros adicionais
        const cleanMimeType = mimetype.split(';')[0].trim().toLowerCase();
        
        const validTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp'
        ];

        return validTypes.includes(cleanMimeType);
    }
}

module.exports = { ImageService };
