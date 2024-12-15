const fs = require('fs').promises;
const path = require('path');
const Tesseract = require('tesseract.js');
const { validateImageBuffer, detectImageFormat, isValidBase64Image } = require('../utils/image-validator');

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

            const buffer = Buffer.from(response.data);
            
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

    async extractTextFromImage(buffer) {
        const maxRetries = 3;
        let attempt = 0;
        let lastError;

        while (attempt < maxRetries) {
            try {
                console.log(`[WhatsAppImage] Tentativa ${attempt + 1} de extração de texto`);
                
                const result = await Tesseract.recognize(
                    buffer,
                    'por', // Português
                    {
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                console.log(`[OCR] Progresso: ${Math.round(m.progress * 100)}%`);
                            }
                        }
                    }
                );

                console.log('[WhatsAppImage] Texto extraído com sucesso');
                
                return {
                    text: result.data.text.trim(),
                    confidence: result.data.confidence,
                    words: result.data.words.map(w => ({
                        text: w.text,
                        confidence: w.confidence
                    }))
                };

            } catch (error) {
                console.error(`[WhatsAppImage] Erro na tentativa ${attempt + 1}:`, error);
                lastError = error;
                attempt++;
                
                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        console.error('[WhatsAppImage] Todas as tentativas de OCR falharam');
        return {
            text: '',
            confidence: 0,
            error: lastError?.message || 'Falha na extração de texto'
        };
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

            // Remove caracteres estranhos da URL
            const cleanUrl = imageUrl.replace(/[;,]+$/, '');

            // Verifica o tipo MIME
            const mimetype = messageInfo?.imageMessage?.mimetype;
            if (!this.validMimeTypes.has(mimetype)) {
                throw new Error(`Tipo de imagem não suportado: ${mimetype}`);
            }

            // Download e validação da imagem
            const buffer = await this.downloadImage(cleanUrl);
            
            // Validações adicionais do buffer
            if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
                throw new Error('Download resultou em dados inválidos ou imagem muito pequena');
            }

            if (buffer.length > this.maxImageSize) {
                throw new Error(`Imagem muito grande (max: ${this.maxImageSize / (1024 * 1024)}MB)`);
            }

            // Detecta o formato real da imagem
            const detectedFormat = detectImageFormat(buffer);
            if (!detectedFormat) {
                throw new Error('Formato de imagem não reconhecido');
            }

            // Log detalhado do buffer
            console.log('[WhatsAppImage] Buffer validado:', {
                size: buffer.length,
                header: buffer.slice(0, 16).toString('hex').toUpperCase(),
                detectedFormat,
                declaredMime: mimetype
            });

            // Processamento paralelo de OCR e análise
            const [ocrResult, analysis] = await Promise.allSettled([
                this.extractTextFromImage(buffer),
                this.groqServices.analyzeImage(buffer)
            ]);

            return {
                success: true,
                message: 'Imagem processada com sucesso',
                analysis: analysis.status === 'fulfilled' ? analysis.value : null,
                ocr: ocrResult.status === 'fulfilled' ? ocrResult.value : null,
                metadata: {
                    type: detectedFormat,
                    size: buffer.length,
                    url: cleanUrl
                },
                errors: {
                    analysis: analysis.status === 'rejected' ? analysis.reason?.message : null,
                    ocr: ocrResult.status === 'rejected' ? ocrResult.reason?.message : null
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
