const axios = require('axios');
const sharp = require('sharp');
const crypto = require('crypto');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const groqServices = require('./groq-services');
const settings = require('../config/settings');
const ImageProcessingService = require('./image-processing-service');

class ImageService {
    constructor(groqServices, whatsappClient) {
        if (!groqServices) {
            throw new Error('GroqServices é obrigatório');
        }
        if (!whatsappClient) {
            throw new Error('WhatsappClient é obrigatório');
        }
        this.groqServices = groqServices;
        this.whatsappClient = whatsappClient;
        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 1000; // 1 second

        // Configurações de imagem
        this.MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
        this.MAX_DIMENSION = 2048; // pixels
        this.COMPRESSION_QUALITY = 80;
        this.ALLOWED_TYPES = ['image/jpeg', 'image/png'];
    }

    /**
     * Valida uma imagem
     * @param {Buffer} buffer - Buffer da imagem
     * @param {string} mimetype - Tipo MIME
     * @returns {Promise<void>}
     */
    async validateImage(buffer, mimetype) {
        // Validação de tipo MIME
        if (!this.ALLOWED_TYPES.includes(mimetype)) {
            throw new Error(`Tipo de imagem não suportado. Use: ${this.ALLOWED_TYPES.join(', ')}`);
        }

        // Validação de tamanho
        if (buffer.length > this.MAX_IMAGE_SIZE) {
            throw new Error(`Imagem muito grande. Máximo: ${this.MAX_IMAGE_SIZE / (1024 * 1024)}MB`);
        }

        // Validação de dimensões
        const metadata = await sharp(buffer).metadata();
        if (metadata.width > this.MAX_DIMENSION || metadata.height > this.MAX_DIMENSION) {
            throw new Error(`Dimensões muito grandes. Máximo: ${this.MAX_DIMENSION}x${this.MAX_DIMENSION} pixels`);
        }

        // Validação de conteúdo malicioso
        await this.validateImageSecurity(buffer);
    }

    /**
     * Valida segurança da imagem
     * @param {Buffer} buffer - Buffer da imagem
     * @returns {Promise<void>}
     */
    async validateImageSecurity(buffer) {
        try {
            // Verifica assinatura de arquivo
            const signature = buffer.slice(0, 4).toString('hex');
            const validSignatures = {
                'ffd8ffe0': 'image/jpeg', // JPEG
                '89504e47': 'image/png'   // PNG
            };

            if (!Object.keys(validSignatures).includes(signature)) {
                throw new Error('Assinatura de arquivo inválida');
            }

            // Gera hash para verificação de integridade
            const hash = crypto.createHash('sha256').update(buffer).digest('hex');
            console.log('[ImageService] Hash de segurança:', hash);

            // Aqui você pode adicionar mais verificações de segurança
            // como integração com serviços de detecção de malware
        } catch (error) {
            console.error('[ImageService] Erro na validação de segurança:', error);
            throw new Error('Imagem não passou na validação de segurança');
        }
    }

    /**
     * Comprime uma imagem
     * @param {Buffer} buffer - Buffer da imagem
     * @returns {Promise<Buffer>} Buffer da imagem comprimida
     */
    async compressImage(buffer) {
        try {
            const metadata = await sharp(buffer).metadata();
            
            // Calcula novas dimensões mantendo proporção
            let width = metadata.width;
            let height = metadata.height;
            
            if (width > this.MAX_DIMENSION || height > this.MAX_DIMENSION) {
                const ratio = Math.min(
                    this.MAX_DIMENSION / width,
                    this.MAX_DIMENSION / height
                );
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            // Comprime a imagem
            const compressed = await sharp(buffer)
                .resize(width, height, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .jpeg({
                    quality: this.COMPRESSION_QUALITY,
                    progressive: true
                })
                .toBuffer();

            console.log('[ImageService] Imagem comprimida:', {
                originalSize: buffer.length,
                compressedSize: compressed.length,
                reduction: ((buffer.length - compressed.length) / buffer.length * 100).toFixed(2) + '%',
                dimensions: `${width}x${height}`
            });

            return compressed;
        } catch (error) {
            console.error('[ImageService] Erro ao comprimir imagem:', error);
            throw new Error('Falha ao comprimir imagem');
        }
    }

    /**
     * Processa e prepara uma imagem para envio à API Groq
     * @param {Buffer} buffer - Buffer da imagem
     * @param {string} mimetype - Tipo MIME da imagem
     * @returns {Promise<string>} Imagem em base64 pronta para Groq
     */
    async processImageForGroq(buffer, mimetype) {
        try {
            console.log('🔄 Processando imagem para Groq:', {
                tamanhoOriginal: buffer.length,
                tipo: mimetype
            });

            // Validação
            await this.validateImage(buffer, mimetype);
            
            // Compressão se necessário
            const processedBuffer = await this.compressImage(buffer);
            
            console.log('✅ Imagem processada com sucesso:', {
                tamanhoFinal: processedBuffer.length
            });

            // Conversão para base64
            return processedBuffer.toString('base64');
        } catch (error) {
            console.error('❌ Erro ao processar imagem para Groq:', error);
            throw new Error('Falha ao processar imagem para análise');
        }
    }

    /**
     * Detecta se uma imagem é um comprovante
     * @param {string} analysis - Análise da imagem pelo Groq
     * @returns {boolean} true se for comprovante
     */
    isPaymentReceipt(analysis) {
        const keywords = [
            'comprovante',
            'pagamento',
            'transferência',
            'pix',
            'recibo',
            'valor',
            'data',
            'beneficiário',
            'banco',
            'agência',
            'conta'
        ];

        // Converte para minúsculas para comparação
        const lowerAnalysis = analysis.toLowerCase();
        
        // Conta quantas palavras-chave foram encontradas
        const matchCount = keywords.reduce((count, keyword) => {
            return count + (lowerAnalysis.includes(keyword) ? 1 : 0);
        }, 0);

        // Se encontrou pelo menos 3 palavras-chave, considera como comprovante
        return matchCount >= 3;
    }

    /**
     * Extrai informações relevantes de um comprovante
     * @param {string} analysis - Análise da imagem pelo Groq
     * @returns {Object} Informações extraídas
     */
    extractReceiptInfo(analysis) {
        // Expressões regulares para extrair informações comuns
        const patterns = {
            valor: /R\$\s*[\d,.]+|valor:?\s*R?\$?\s*[\d,.]+/i,
            data: /\d{2}\/\d{2}\/\d{4}|\d{2}\.\d{2}\.\d{4}/,
            pix: /pix|chave\s+pix/i,
            beneficiario: /benefici[aá]rio:?\s*([^,\n]+)/i,
            banco: /banco:?\s*([^,\n]+)/i
        };

        const info = {};

        // Tenta extrair cada informação
        for (const [key, pattern] of Object.entries(patterns)) {
            const match = analysis.match(pattern);
            if (match) {
                info[key] = match[1] || match[0];
            }
        }

        return info;
    }

    async processWhatsAppImage({ imageMessage, caption = '', from, messageId, businessHours }) {
        try {
            console.log('[ImageService] Iniciando processamento de imagem:', {
                from,
                messageId,
                caption: caption || '(sem legenda)',
                mediaId: imageMessage.id,
                mimetype: imageMessage.mimetype,
                fileLength: imageMessage.fileLength
            });

            // Limpa a URL da imagem
            if (imageMessage.url) {
                imageMessage.url = imageMessage.url.replace(/";,$/g, '');
            }

            // Baixa e descriptografa a imagem
            console.log('📥 Baixando e descriptografando imagem...');
            
            const buffer = await downloadMediaMessage(
                imageMessage,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: async (media) => {
                        // Limpa a URL se necessário
                        const cleanUrl = media.url?.replace(/";,$/g, '') || '';
                        
                        console.log('[ImageService] Tentando baixar mídia:', {
                            url: cleanUrl.substring(0, 50) + '...',
                            headers: media.headers
                        });
                        
                        const response = await axios.get(cleanUrl, {
                            responseType: 'arraybuffer',
                            headers: { Origin: 'https://web.whatsapp.com' }
                        });
                        
                        console.log('[ImageService] Mídia baixada com sucesso:', {
                            contentType: response.headers['content-type'],
                            contentLength: response.data.length
                        });
                        
                        return response.data;
                    }
                }
            );

            // Valida a imagem
            await this.validateImage(buffer, imageMessage.mimetype);

            // Comprime a imagem
            const compressedBuffer = await this.compressImage(buffer);

            // Converte para base64
            const base64Image = compressedBuffer.toString('base64');
            
            console.log('[ImageService] Imagem processada:', {
                base64Length: base64Image?.length,
                preview: base64Image?.substring(0, 50) + '...'
            });

            // Primeiro usa OCR para extrair texto
            const imageProcessingService = new ImageProcessingService();
            const extractedText = await imageProcessingService.extractTextFromImage(base64Image);
            
            console.log('[ImageService] Texto extraído via OCR:', {
                hasText: !!extractedText,
                preview: extractedText?.substring(0, 100) + '...'
            });

            // Depois analisa com Groq Vision, passando o texto extraído
            const analysis = await this.groqServices.processImage(base64Image, {
                extractedText,
                originalMessage: imageMessage
            });
            
            console.log('[ImageService] Análise da imagem concluída:', {
                imageType: analysis.type,
                hasText: !!extractedText,
                description: analysis.description?.substring(0, 100) + '...'
            });

            // Verifica se é um comprovante
            const isReceipt = this.isPaymentReceipt(analysis);

            if (isReceipt) {
                console.log('💰 Comprovante detectado, extraindo informações...');
                const receiptInfo = this.extractReceiptInfo(analysis);
                
                return {
                    type: 'receipt',
                    analysis,
                    info: receiptInfo
                };
            }

            return {
                type: 'image',
                analysis
            };

        } catch (error) {
            console.error('[ImageService] Erro ao processar imagem:', error);
            
            // Mensagens de erro mais específicas
            if (error.message.includes('14 dias')) {
                throw new Error('Esta imagem não está mais disponível pois foi enviada há mais de 14 dias.');
            } else if (error.message.includes('autenticação')) {
                throw new Error('Houve um erro de autenticação. Por favor, tente novamente mais tarde.');
            } else if (error.message.includes('segurança')) {
                throw new Error('Esta imagem não passou nas validações de segurança.');
            } else {
                throw new Error('Não foi possível processar a imagem. Por favor, tente novamente.');
            }
        }
    }
}

// Exporta a classe ImageService da mesma forma que os outros serviços
module.exports = { ImageService };
