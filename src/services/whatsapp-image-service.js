const axios = require('axios');
const crypto = require('crypto');
const { WHATSAPP_CONFIG } = require('../config/settings');

class WhatsAppImageService {
    constructor() {
        this.axios = axios.create({
            timeout: 30000,
            maxContentLength: 10 * 1024 * 1024, // 10MB
            headers: {
                'User-Agent': 'WhatsApp/2.24.8.78 A',
                'Authorization': `Bearer ${WHATSAPP_CONFIG.token}`
            }
        });
    }

    /**
     * Processa e valida os atributos da mídia do WhatsApp
     * @param {Object} mediaInfo - Informações da mídia do WhatsApp
     * @returns {Object} Atributos validados e processados
     */
    validateMediaAttributes(mediaInfo) {
        if (!mediaInfo) throw new Error('Informações da mídia são obrigatórias');

        const {
            mediaKey,
            directPath,
            url,
            mimetype,
            filesize,
            fileSha256,
            mediaKeyTimestamp,
            jpegThumbnail,
            height,
            width
        } = mediaInfo;

        // Validações obrigatórias
        if (!mediaKey) throw new Error('mediaKey é obrigatório');
        if (!mimetype) throw new Error('mimetype é obrigatório');
        if (!url && !directPath) throw new Error('url ou directPath é obrigatório');

        // Validação do tipo MIME usando configurações do departamento financeiro
        const allowedMimes = WHATSAPP_CONFIG.departments.financial.paymentProofs.allowedTypes;
        if (!allowedMimes.includes(mimetype)) {
            throw new Error(`Tipo MIME não suportado: ${mimetype}. Tipos permitidos: ${allowedMimes.join(', ')}`);
        }

        // Validação do tamanho usando configurações do departamento financeiro
        const maxSize = WHATSAPP_CONFIG.departments.financial.paymentProofs.maxSize;
        if (filesize && filesize > maxSize) {
            throw new Error(`Arquivo muito grande: ${filesize} bytes (máximo: ${maxSize} bytes)`);
        }

        return {
            mediaKey,
            directPath,
            url,
            mimetype,
            filesize,
            fileSha256,
            mediaKeyTimestamp,
            jpegThumbnail,
            dimensions: height && width ? { height, width } : null
        };
    }

    /**
     * Baixa uma imagem do WhatsApp com retry e validação completa
     * @param {string} url - URL da imagem
     * @param {Object} mediaInfo - Informações da mídia do WhatsApp
     * @returns {Promise<{buffer: Buffer, metadata: Object}>} Buffer da imagem e metadados
     */
    async downloadImage(url, mediaInfo) {
        try {
            // Valida e processa atributos
            const validatedMedia = this.validateMediaAttributes(mediaInfo);
            
            console.log('[WhatsApp] Baixando imagem:', {
                url: url?.substring(0, 50) + '...',
                mimetype: validatedMedia.mimetype,
                dimensions: validatedMedia.dimensions,
                filesize: validatedMedia.filesize
            });

            // Tenta baixar a imagem com retry
            const buffer = await this.downloadWithRetry(url, validatedMedia);

            // Valida o hash SHA256 se disponível
            if (validatedMedia.fileSha256) {
                const calculatedHash = crypto
                    .createHash('sha256')
                    .update(buffer)
                    .digest('base64');
                
                if (calculatedHash !== validatedMedia.fileSha256) {
                    throw new Error('Hash SHA256 não corresponde');
                }
            }

            // Retorna buffer e metadados
            return {
                buffer,
                metadata: {
                    mimetype: validatedMedia.mimetype,
                    dimensions: validatedMedia.dimensions,
                    filesize: buffer.length,
                    timestamp: validatedMedia.mediaKeyTimestamp,
                    hasThumbnail: !!validatedMedia.jpegThumbnail
                }
            };

        } catch (error) {
            console.error('[WhatsApp] Erro ao baixar imagem:', error);
            throw new Error(`Falha ao baixar imagem: ${error.message}`);
        }
    }

    /**
     * Baixa a imagem com tentativas de retry
     * @param {string} url - URL da imagem
     * @param {Object} mediaInfo - Informações validadas da mídia
     * @returns {Promise<Buffer>} Buffer da imagem
     */
    async downloadWithRetry(url, mediaInfo) {
        const maxRetries = WHATSAPP_CONFIG.retryAttempts || 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Tenta o download direto primeiro
                const response = await this.axios({
                    method: 'GET',
                    url: url,
                    responseType: 'arraybuffer'
                });

                let buffer = Buffer.from(response.data);

                // Se falhar, tenta pelo directPath
                if (!buffer || buffer.length < 8) {
                    if (mediaInfo.directPath) {
                        const altResponse = await this.axios({
                            method: 'GET',
                            url: `${WHATSAPP_CONFIG.apiUrl}/v1/media/${mediaInfo.directPath}`,
                            responseType: 'arraybuffer'
                        });
                        buffer = Buffer.from(altResponse.data);
                    }
                }

                // Descriptografa se necessário
                if (mediaInfo.mediaKey) {
                    buffer = await this.decryptMedia(buffer, mediaInfo);
                }

                // Valida o buffer final
                if (!buffer || buffer.length < 8) {
                    throw new Error('Buffer inválido ou muito pequeno');
                }

                return buffer;

            } catch (error) {
                lastError = error;
                console.warn(`[WhatsApp] Tentativa ${attempt}/${maxRetries} falhou:`, error.message);
                
                if (attempt < maxRetries) {
                    // Espera um tempo exponencial entre tentativas
                    await new Promise(resolve => 
                        setTimeout(resolve, Math.pow(2, attempt) * 1000)
                    );
                }
            }
        }

        throw lastError;
    }

    /**
     * Descriptografa mídia do WhatsApp
     * @param {Buffer} buffer - Buffer criptografado
     * @param {Object} mediaInfo - Informações da mídia
     * @returns {Promise<Buffer>} Buffer descriptografado
     */
    async decryptMedia(buffer, mediaInfo) {
        try {
            if (!buffer || !mediaInfo?.mediaKey) {
                throw new Error('Parâmetros inválidos para descriptografia');
            }

            // Deriva as chaves
            const mediaKeyExpanded = this.expandMediaKey(
                Buffer.from(mediaInfo.mediaKey, 'base64'),
                'WhatsApp Image Keys'
            );

            // Extrai os componentes
            const iv = mediaKeyExpanded.slice(0, 16);
            const cipherKey = mediaKeyExpanded.slice(16, 48);

            // Descriptografa
            const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
            return Buffer.concat([
                decipher.update(buffer),
                decipher.final()
            ]);

        } catch (error) {
            console.error('[WhatsApp] Erro ao descriptografar mídia:', error);
            throw new Error(`Falha ao descriptografar mídia: ${error.message}`);
        }
    }

    /**
     * Expande a chave de mídia do WhatsApp
     * @param {Buffer} mediaKey - Chave de mídia
     * @param {string} info - Informação para derivação
     * @returns {Buffer} Chave expandida
     */
    expandMediaKey(mediaKey, info) {
        try {
            const hmac = (key, message) => {
                const h = crypto.createHmac('sha256', key);
                h.update(message);
                return h.digest();
            };

            const prk = hmac(Buffer.from('WhatsApp Media Keys'), mediaKey);
            const expanded = Buffer.alloc(112);
            let offset = 0;
            let counter = 0;

            while (offset < 112) {
                const current = Buffer.concat([
                    counter ? expanded.slice(0, offset) : Buffer.alloc(0),
                    Buffer.from(info),
                    Buffer.from([counter + 1])
                ]);

                const output = hmac(prk, current);
                output.copy(expanded, offset);
                offset += 32;
                counter++;
            }

            return expanded;

        } catch (error) {
            console.error('[WhatsApp] Erro ao expandir chave:', error);
            throw new Error(`Falha ao expandir chave: ${error.message}`);
        }
    }

    async analyzeImage(buffer) {
        try {
            if (!buffer) {
                throw new Error('Buffer inválido');
            }

            // Converte buffer para base64
            const base64Image = buffer.toString('base64');

            // Configura a requisição para a Groq
            const messages = [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Analise esta imagem em detalhes e me diga se parece ser um comprovante de pagamento. Se for um comprovante, extraia informações como valor, data, tipo de transação (PIX, TED, etc). Se não for um comprovante, descreva o que você vê na imagem."
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/jpeg;base64,${base64Image}`
                            }
                        }
                    ]
                }
            ];

            const response = await this.groqService.chat.completions.create({
                model: "llama-3.2-11b-vision-preview",
                messages: messages,
                temperature: 0.5,
                max_tokens: 1024,
                stream: false
            });

            if (!response?.choices?.[0]?.message?.content) {
                throw new Error('Resposta inválida da Groq');
            }

            return response.choices[0].message.content;

        } catch (error) {
            console.error('❌ Erro ao analisar imagem com Groq:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Verifica se uma imagem parece ser um comprovante de pagamento
     * @param {Object} mediaMessage - Mensagem de mídia do WhatsApp
     * @returns {Promise<boolean>} true se parece ser um comprovante
     */
    async isLikelyPaymentProof(mediaMessage) {
        try {
            if (!mediaMessage?.imageMessage) return false;

            // Primeiro verifica o tipo MIME
            const { mimetype } = mediaMessage.imageMessage;
            const allowedMimes = WHATSAPP_CONFIG.departments.financial.paymentProofs.allowedTypes;
            
            if (!allowedMimes.includes(mimetype)) {
                console.log('📝 Tipo MIME não compatível com comprovante:', {
                    tipo: mimetype,
                    permitidos: allowedMimes,
                    timestamp: new Date().toISOString()
                });
                return false;
            }

            // Se tiver caption, verifica palavras-chave
            const caption = mediaMessage.imageMessage.caption?.toLowerCase() || '';
            const captionKeywords = ['comprovante', 'pagamento', 'pix', 'transferência', 'ted', 'doc', 'recibo'];
            
            const hasKeyword = captionKeywords.some(keyword => caption.includes(keyword));
            if (hasKeyword) {
                console.log('✅ Palavras-chave de comprovante detectadas na legenda:', {
                    caption,
                    timestamp: new Date().toISOString()
                });
                return true;
            }

            // Se passou pela validação MIME, baixa e analisa com Groq
            const buffer = await this.downloadMediaMessage(mediaMessage);
            
            // Analisa com Groq
            const analysis = await this.analyzeImage(buffer);

            // Verifica se a análise indica que é um comprovante
            const analysisKeywords = ['comprovante', 'pagamento', 'pix', 'transferência', 'ted', 'doc', 'recibo', 'valor', 'data', 'transação'];
            const analysisLower = analysis.toLowerCase();
            
            const isProof = analysisKeywords.some(keyword => analysisLower.includes(keyword));

            console.log('🔍 Análise de comprovante:', {
                resultado: isProof,
                previewAnalise: analysis.substring(0, 100),
                timestamp: new Date().toISOString()
            });

            return isProof;

        } catch (error) {
            console.error('❌ Erro ao verificar comprovante:', {
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    async processPaymentProof(imageBuffer, orderNumber) {
        try {
            // Converte buffer para base64
            const base64Image = imageBuffer.toString('base64');
            
            // Analisa a imagem com Groq
            const messages = [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Analise este comprovante de pagamento e extraia as seguintes informações:\n" +
                                  "1. Valor do pagamento\n" +
                                  "2. Data e hora da transação\n" +
                                  "3. Tipo de transação (PIX, TED, etc)\n" +
                                  "4. Banco de origem\n" +
                                  "5. Status da transação"
                        },
                        {
                            type: "image",
                            image_url: {
                                url: `data:image/jpeg;base64,${base64Image}`
                            }
                        }
                    ]
                }
            ];

            const analysis = await this.groqServices.generateText(messages);
            
            console.log('✅ Análise do comprovante:', {
                pedido: orderNumber,
                analise: analysis,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                analysis,
                orderNumber
            };

        } catch (error) {
            console.error('❌ Erro ao processar comprovante:', {
                erro: error.message,
                pedido: orderNumber,
                timestamp: new Date().toISOString()
            });
            
            throw new Error(`Erro ao processar comprovante: ${error.message}`);
        }
    }
}

module.exports = { WhatsAppImageService };
