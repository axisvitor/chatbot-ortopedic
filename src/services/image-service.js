const fs = require('fs').promises;
const path = require('path');
const venom = require('venom-bot');

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
        
        // Cria a pasta temp se não existir
        this.initTempDir();
    }

    async initTempDir() {
        try {
            await fs.access(this.tempDir);
        } catch (error) {
            // Se a pasta não existe, cria
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
            
            // Download da mídia usando Venom
            const buffer = await messageInfo.mediaData.download();
            
            if (!buffer || !buffer.length) {
                throw new Error('Buffer vazio após download');
            }

            console.log('[Image] Download concluído:', {
                size: buffer.length,
                sizeInMB: (buffer.length / (1024 * 1024)).toFixed(2),
                header: buffer.slice(0, 8).toString('hex')
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

    async processWhatsAppDocument(messageInfo) {
        try {
            if (!messageInfo?.mediaData) {
                throw new Error('Dados do documento ausentes ou inválidos');
            }

            console.log('[Document] Recebido documento:', {
                type: messageInfo.type,
                size: messageInfo.size,
                mimetype: messageInfo.mimetype,
                filename: messageInfo.filename
            });

            // Verifica o tamanho (limite de 10MB para documentos)
            const maxDocSize = 10 * 1024 * 1024;
            if (messageInfo.size > maxDocSize) {
                throw new Error(`Documento muito grande (max: ${maxDocSize / (1024 * 1024)}MB)`);
            }

            console.log('[Document] Iniciando download...');
            
            // Download do documento usando Venom
            const buffer = await messageInfo.mediaData.download();
            
            if (!buffer || !buffer.length) {
                throw new Error('Buffer vazio após download');
            }

            // Salva o documento temporariamente se necessário
            const tempPath = path.join(this.tempDir, messageInfo.filename || 'document');
            await fs.writeFile(tempPath, buffer);

            console.log('[Document] Download concluído:', {
                size: buffer.length,
                sizeInMB: (buffer.length / (1024 * 1024)).toFixed(2),
                path: tempPath
            });

            return {
                success: true,
                message: 'Documento processado com sucesso',
                metadata: {
                    type: messageInfo.mimetype,
                    size: buffer.length,
                    filename: messageInfo.filename,
                    path: tempPath
                }
            };

        } catch (error) {
            console.error('[Document] Erro:', error);
            return {
                success: false,
                message: error.message,
                error: error.stack
            };
        }
    }

    async isPaymentProof(messageInfo) {
        try {
            const result = await this.processWhatsAppImage(messageInfo);
            if (!result.success) {
                return false;
            }

            const analysis = result.analysis.toLowerCase();
            const paymentKeywords = [
                'comprovante',
                'pagamento',
                'transferência',
                'pix',
                'ted',
                'doc',
                'depósito',
                'bancário',
                'recibo',
                'valor'
            ];

            return paymentKeywords.some(keyword => analysis.includes(keyword.toLowerCase()));
        } catch (error) {
            console.error('[PaymentCheck] Erro:', error);
            return false;
        }
    }
}

module.exports = { ImageService };
