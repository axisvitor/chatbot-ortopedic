const axios = require('axios');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { OPENAI_CONFIG, WHATSAPP_CONFIG } = require('../config/settings');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

class WhatsAppImageService {
    constructor() {
        this.openaiAxios = axios.create({
            baseURL: 'https://api.openai.com/v1',
            headers: {
                'Authorization': `Bearer ${OPENAI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        this.whatsappAxios = axios.create({
            baseURL: 'https://graph.facebook.com/v13.0/',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Extrai o número do remetente da mensagem de forma robusta
     * @param {Object} message - Mensagem do WhatsApp
     * @returns {string} Número do remetente (apenas dígitos)
     */
    extractSenderNumber(message) {
        try {
            // Verifica todas as possíveis localizações do remetente
            const from = message.key?.remoteJid || 
                        message.from || 
                        message.participant || 
                        (message.message?.key?.remoteJid);

            if (!from) {
                console.error('❌ [WhatsAppImageService] Dados da mensagem:', JSON.stringify(message, null, 2));
                throw new Error('Remetente não encontrado na mensagem');
            }

            // Remove o sufixo @s.whatsapp.net se presente
            return from.replace('@s.whatsapp.net', '');
        } catch (error) {
            console.error('❌ [WhatsAppImageService] Erro ao extrair remetente:', {
                erro: error.message,
                stack: error.stack,
                mensagem: JSON.stringify(message, null, 2)
            });
            throw error;
        }
    }

    /**
     * Faz download de uma mídia do WhatsApp usando o endpoint oficial
     * @param {string} mediaId ID da mídia
     * @returns {Promise<Buffer>} Buffer com o conteúdo da mídia
     */
    async downloadMedia(mediaId) {
        try {
            console.log('📥 [WhatsAppImageService] Iniciando download:', { mediaId });
            
            // 1. Solicita o download da mídia
            const downloadResponse = await this.whatsappAxios.get(`/v1/media/${mediaId}/download`);
            
            // Valida a resposta inicial
            if (!downloadResponse.data?.media_items?.[0]?.id) {
                console.error('❌ Resposta inválida ao solicitar download:', downloadResponse.data);
                throw new Error('Resposta inválida ao solicitar download da mídia');
            }

            // 2. Aguarda o download com retry (14 dias de disponibilidade)
            let retryCount = 0;
            const maxRetries = 6; // 6 tentativas = 30 segundos total
            
            while (retryCount < maxRetries) {
                try {
                    // Verifica o status do download
                    const statusResponse = await this.whatsappAxios.get(`/v1/media/${mediaId}`);
                    const mediaItem = statusResponse.data?.media_items?.[0];
                    
                    if (mediaItem?.status === 'downloaded') {
                        // Valida o tipo e tamanho da mídia
                        const mimeType = mediaItem.mime_type;
                        const { mimetype: validatedType } = this._validateMimeType(mimeType);
                        
                        // Faz o download do conteúdo
                        const mediaResponse = await this.whatsappAxios.get(`/v1/media/${mediaId}/content`, {
                            responseType: 'arraybuffer'
                        });
                        
                        const mediaBuffer = mediaResponse.data;
                        
                        // Valida o tamanho baseado no tipo
                        const sizeInMB = mediaBuffer.length / (1024 * 1024);
                        const maxSize = this._getMaxSizeForType(validatedType);
                        
                        if (sizeInMB > maxSize) {
                            throw new Error(`Mídia muito grande (${sizeInMB.toFixed(2)}MB). Máximo permitido: ${maxSize}MB`);
                        }
                        
                        console.log('✅ Download concluído:', {
                            mediaId,
                            tipo: validatedType,
                            tamanho: `${sizeInMB.toFixed(2)}MB`
                        });
                        
                        return mediaBuffer;
                    }
                    
                    // Se ainda não baixou, aguarda 5 segundos
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    retryCount++;
                    
                } catch (error) {
                    // Verifica se é erro de mídia indisponível (após 14 dias)
                    if (error.response?.data?.errors?.[0]?.code === 400 && 
                        error.response.data.errors[0].title === "Parameter not valid" &&
                        error.response.data.errors[0].details?.includes("Media not found")) {
                        throw new Error('Mídia não está mais disponível (expirou após 14 dias)');
                    }
                    
                    console.warn(`⚠️ Tentativa ${retryCount + 1} falhou:`, error.message);
                    if (retryCount === maxRetries - 1) throw error;
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    retryCount++;
                }
            }
            
            throw new Error(`Timeout ao aguardar download da mídia após ${maxRetries} tentativas`);

        } catch (error) {
            console.error('❌ Erro ao baixar mídia:', {
                erro: error.message,
                mediaId,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Valida e formata uma imagem base64
     * @private
     * @param {string} base64 String base64 da imagem
     * @param {string} mimetype Tipo MIME da imagem
     * @returns {string} String base64 formatada
     * @throws {Error} Se o formato for inválido
     */
    _formatBase64Image(base64, mimetype = 'image/jpeg') {
        try {
            // Remove o prefixo data:image se já existir
            const cleanBase64 = base64.replace(/^data:image\/[a-z]+;base64,/, '');

            // Valida se é um base64 válido
            if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64)) {
                throw new Error('String base64 inválida');
            }

            // Verifica o tamanho (máximo 5MB)
            const sizeInBytes = (cleanBase64.length * 3) / 4;
            if (sizeInBytes > 5 * 1024 * 1024) {
                throw new Error('Imagem muito grande. Máximo permitido: 5MB');
            }

            // Retorna com o prefixo correto
            return `data:${mimetype};base64,${cleanBase64}`;
        } catch (error) {
            console.error('❌ Erro ao formatar base64:', error);
            throw error;
        }
    }

    /**
     * Valida o tipo MIME de uma imagem
     * @private
     * @param {string} mimetype Tipo MIME para validar
     * @returns {string} Tipo MIME validado
     * @throws {Error} Se o tipo não for suportado
     */
    _validateMimeType(mimetype) {
        const supportedTypes = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp'
        };

        const type = mimetype.toLowerCase();
        if (!supportedTypes[type]) {
            throw new Error(`Tipo de imagem não suportado: ${type}. Use: ${Object.keys(supportedTypes).join(', ')}`);
        }

        return {
            mimetype: type,
            extension: supportedTypes[type]
        };
    }

    /**
     * Retorna o tamanho máximo permitido para cada tipo de mídia
     * @private
     * @param {string} mimeType - Tipo MIME da mídia
     * @returns {number} Tamanho máximo em MB
     */
    _getMaxSizeForType(mimeType) {
        const limits = {
            'image/jpeg': 5,
            'image/png': 5,
            'image/webp': 0.1, // 100KB para stickers
            'video/mp4': 16,
            'video/3gpp': 16,
            'audio/aac': 16,
            'audio/mp4': 16,
            'audio/amr': 16,
            'audio/mpeg': 16,
            'audio/ogg': 16,
            'application/pdf': 100,
            'application/msword': 100,
            'application/vnd.ms-excel': 100,
            'application/vnd.ms-powerpoint': 100,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 100,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 100,
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': 100
        };

        return limits[mimeType] || 100; // Default para documentos
    }

    async downloadImages(imageMessages) {
        try {
            console.log('📥 Iniciando download das imagens do WhatsApp...', {
                quantidade: Array.isArray(imageMessages) ? imageMessages.length : 1
            });
            
            if (!Array.isArray(imageMessages)) {
                imageMessages = [imageMessages];
            }

            // Valida se há mensagens
            if (!imageMessages?.length) {
                throw new Error('Nenhuma mensagem de imagem fornecida');
            }

            const downloadedImages = await Promise.all(imageMessages.map(async (imageMessage) => {
                // Extrai o remetente
                const from = this.extractSenderNumber(imageMessage);

                // Extrai ID da mídia
                const mediaId = imageMessage?.imageMessage?.mediaKey || 
                              imageMessage?.mediaKey ||
                              imageMessage?.id;

                if (!mediaId) {
                    throw new Error('ID da mídia não encontrado na mensagem');
                }

                // Valida o mimetype
                const mimetype = imageMessage?.mimetype || 
                               imageMessage?.imageMessage?.mimetype || 
                               'image/jpeg';
                
                const { mimetype: validatedType, extension } = this._validateMimeType(mimetype);

                // Gera um nome único para o arquivo temporário
                const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whatsapp-'));
                const tempFile = path.join(tempDir, `${uuidv4()}${extension}`);

                // Faz o download usando o endpoint oficial
                const mediaBuffer = await this.downloadMedia(mediaId);

                // Valida o tamanho
                if (mediaBuffer.length > 5 * 1024 * 1024) {
                    throw new Error('Imagem muito grande. Máximo permitido: 5MB');
                }

                // Salva a imagem no arquivo temporário
                await fs.writeFile(tempFile, mediaBuffer);

                // Converte para base64 e formata
                const base64Image = this._formatBase64Image(
                    mediaBuffer.toString('base64'),
                    validatedType
                );

                console.log('✅ Download da imagem concluído:', {
                    tamanho: mediaBuffer.length,
                    arquivo: tempFile,
                    mimetype: validatedType,
                    from: from
                });

                return {
                    filePath: tempFile,
                    mimetype: validatedType,
                    caption: imageMessage?.caption || imageMessage?.imageMessage?.caption,
                    base64: base64Image,
                    from: from,
                    mediaId: mediaId
                };
            }));

            return downloadedImages;

        } catch (error) {
            console.error('❌ Erro ao baixar imagens do WhatsApp:', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async downloadImage(message) {
        try {
            console.log('📥 [WhatsAppImageService] Iniciando download da imagem');

            // Verifica se a mensagem tem o formato correto
            if (!message.message?.imageMessage) {
                throw new Error('Mensagem não contém uma imagem válida');
            }

            // Download da imagem usando Baileys
            const buffer = await downloadMediaMessage(
                message,
                'buffer',
                {},
                {
                    logger: console,
                    reuploadRequest: async (media) => {
                        // Limpa a URL se necessário
                        const cleanUrl = media.url?.replace(/";,$/g, '') || '';
                        const fetch = (await import('node-fetch')).default;
                        
                        console.log('[WhatsAppImageService] Tentando baixar mídia:', {
                            url: cleanUrl,
                            mediaId: media.mediaKey
                        });

                        const response = await fetch(cleanUrl);
                        if (!response.ok) {
                            throw new Error(`Erro ao baixar mídia: ${response.status}`);
                        }
                        return await response.buffer();
                    }
                }
            );

            if (!buffer) {
                throw new Error('Download da imagem falhou');
            }

            console.log('✅ [WhatsAppImageService] Download concluído:', {
                tamanho: buffer.length,
                tipo: message.message.imageMessage.mimetype
            });

            return {
                buffer,
                mimetype: message.message.imageMessage.mimetype,
                caption: message.message.imageMessage.caption || ''
            };

        } catch (error) {
            console.error('❌ [WhatsAppImageService] Erro ao baixar imagem:', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async analyzeImages(message) {
        try {
            console.log('🖼️ [WhatsAppImageService] Iniciando análise de imagens');

            // Extrai o remetente usando o método robusto
            const from = this.extractSenderNumber(message);

            // Extrai dados da imagem
            const imageMessage = message.message?.imageMessage;
            if (!imageMessage) {
                throw new Error('Dados da imagem não encontrados');
            }

            // Faz o download da imagem
            const downloadResult = await this.downloadImage(imageMessage);
            if (!downloadResult.success) {
                throw new Error(`Falha ao baixar imagem: ${downloadResult.error}`);
            }

            // Prepara o payload para a OpenAI Vision
            const payload = {
                model: "gpt-4-vision-preview",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: `Analise esta imagem e descreva detalhadamente o que você vê. ${imageMessage.caption ? `\nContexto adicional do usuário: ${imageMessage.caption}` : ''}`
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${downloadResult.mimetype};base64,${downloadResult.base64}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 500
            };

            // Envia para OpenAI Vision
            console.log('🤖 [WhatsAppImageService] Enviando para OpenAI Vision');
            const response = await this.openaiAxios.post('/chat/completions', payload);

            // Extrai a análise
            const analysis = response.data.choices[0]?.message?.content;
            if (!analysis) {
                throw new Error('Resposta vazia da OpenAI');
            }

            // Limpa o arquivo temporário
            try {
                await fs.unlink(downloadResult.filePath);
                await fs.rmdir(path.dirname(downloadResult.filePath));
            } catch (cleanupError) {
                console.warn('⚠️ [WhatsAppImageService] Erro ao limpar arquivos temporários:', cleanupError);
            }

            console.log('✅ [WhatsAppImageService] Análise concluída com sucesso');

            return {
                success: true,
                analysis: analysis,
                metadata: {
                    from,
                    mimetype: downloadResult.mimetype,
                    caption: imageMessage.caption || ''
                }
            };

        } catch (error) {
            console.error('❌ [WhatsAppImageService] Erro ao analisar imagem:', {
                erro: error.message,
                stack: error.stack
            });
            
            return {
                success: false,
                error: error.message
            };
        }
    }

    async processPaymentProof(imageMessages) {
        try {
            console.log('💳 Processando comprovante(s) de pagamento...');

            // 1. Analisa as imagens
            const analysisResult = await this.analyzeImages(imageMessages);

            // 2. Extrai informações do texto da análise
            const paymentInfos = this.extractPaymentInfos(analysisResult.analysis);

            console.log('💰 Informações extraídas:', paymentInfos);

            return paymentInfos;

        } catch (error) {
            console.error('❌ Erro ao processar comprovante(s):', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    extractPaymentInfos(analysisText) {
        // Tenta identificar múltiplos comprovantes no texto
        const sections = analysisText.split(/(?=comprovante|pagamento|transferência|pix|recibo)/i);
        
        return sections.map(section => ({
            isPaymentProof: this.isPaymentProof(section),
            amount: this.extractAmount(section),
            date: this.extractDate(section),
            transactionType: this.extractTransactionType(section),
            status: this.extractStatus(section)
        })).filter(info => info.isPaymentProof); // Filtra apenas os que são realmente comprovantes
    }

    isPaymentProof(text) {
        const keywords = ['comprovante', 'pagamento', 'transferência', 'pix', 'recibo'];
        return keywords.some(keyword => text.includes(keyword));
    }

    extractAmount(text) {
        const amountRegex = /r\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)/;
        const match = text.match(amountRegex);
        if (match) {
            return match[1].replace('.', '').replace(',', '.');
        }
        return null;
    }

    extractDate(text) {
        const dateRegex = /(\d{2}\/\d{2}\/\d{4})|(\d{2}\/\d{2}\/\d{2})/;
        const match = text.match(dateRegex);
        return match ? match[0] : null;
    }

    extractTransactionType(text) {
        if (text.includes('pix')) return 'pix';
        if (text.includes('transferência') || text.includes('transferencia')) return 'transfer';
        if (text.includes('boleto')) return 'boleto';
        if (text.includes('cartão') || text.includes('cartao')) return 'card';
        return 'unknown';
    }

    extractStatus(text) {
        if (text.includes('confirmado') || text.includes('aprovado') || text.includes('concluído') || text.includes('sucesso')) {
            return 'confirmed';
        }
        if (text.includes('pendente') || text.includes('aguardando')) {
            return 'pending';
        }
        if (text.includes('falhou') || text.includes('recusado') || text.includes('negado')) {
            return 'failed';
        }
        return 'unknown';
    }

    /**
     * Analisa uma imagem usando o GPT-4V
     * @param {Object} imageData Dados da imagem com base64 e texto
     * @returns {Promise<string>} Análise da imagem
     */
    async analyzeWithGPT4V(imageData) {
        try {
            console.log('🔍 Analisando imagem com GPT-4V');

            const response = await this.openaiAxios.post('/chat/completions', {
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: imageData.text
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${imageData.image.mimetype};base64,${imageData.image.base64}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 500
            });

            if (!response.data?.choices?.[0]?.message?.content) {
                throw new Error('Resposta inválida do GPT-4V');
            }

            const analysis = response.data.choices[0].message.content;
            
            console.log('✅ Análise concluída:', {
                tamanhoAnalise: analysis.length,
                primeirasLinhas: analysis.split('\n').slice(0, 2).join('\n')
            });

            return analysis;

        } catch (error) {
            console.error('❌ Erro ao analisar imagem com GPT-4V:', {
                erro: error.message,
                stack: error.stack
            });
            throw new Error('Falha ao analisar imagem: ' + error.message);
        }
    }

    /**
     * Processa uma mensagem de imagem do WhatsApp
     * @param {Object} messageData Dados da mensagem
     * @returns {Promise<Object>} Resultado do processamento
     */
    async processWhatsAppImage(messageData) {
        try {
            console.log('📥 Iniciando processamento de imagem:', {
                temKey: !!messageData?.key,
                temMessage: !!messageData?.message,
                temImageMessage: !!messageData?.message?.imageMessage,
                estrutura: JSON.stringify(messageData, null, 2)
            });

            // Extrai o remetente
            const from = this.extractSenderNumber(messageData);

            // Extrai dados da imagem
            const imageMessage = messageData.message?.imageMessage;
            if (!imageMessage) {
                throw new Error('Mensagem não contém imagem');
            }

            // Extrai o mediaKey (necessário para download)
            const mediaKey = imageMessage.mediaKey;
            if (!mediaKey) {
                throw new Error('MediaKey não encontrado na mensagem');
            }

            // Faz o download da imagem
            const imageData = await this.downloadMedia(mediaKey);
            
            // Converte para base64 para análise
            const base64Image = imageData.toString('base64');

            // Prepara o prompt para análise
            const systemPrompt = `Você é um assistente especializado em análise de imagens. 
                                Descreva detalhadamente o conteúdo desta imagem, 
                                identificando elementos relevantes como:
                                - Se é um comprovante de pagamento
                                - Se contém texto legível
                                - Elementos visuais importantes
                                - Qualquer informação`;

            // Envia para análise
            const response = await this.openaiAxios.post('/v1/chat/completions', {
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: systemPrompt
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Analise esta imagem em detalhes:"
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${imageMessage.mimetype};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000
            });

            // Processa a resposta
            return {
                success: true,
                analysis: response.data.choices[0].message.content,
                metadata: {
                    model: "gpt-4o",
                    tokens: response.data.usage,
                    from: from,
                    messageId: messageData.key?.id
                }
            };

        } catch (error) {
            console.error('❌ Erro ao processar imagem:', {
                erro: error.message,
                stack: error.stack
            });
            
            return {
                success: false,
                error: error.message,
                metadata: {
                    from: messageData?.key?.remoteJid?.split('@')[0]
                }
            };
        }
    }
}

module.exports = { WhatsAppImageService };
