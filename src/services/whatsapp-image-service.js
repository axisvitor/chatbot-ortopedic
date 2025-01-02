const axios = require('axios');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { OPENAI_CONFIG, WHATSAPP_CONFIG } = require('../config/settings');

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
            console.log('📥 Iniciando download de mídia:', { mediaId });
            
            // 1. Solicita o download da mídia
            const downloadResponse = await this.whatsappAxios.get(`/v1/media/${mediaId}/download`);
            
            if (downloadResponse.data?.errors) {
                throw new Error(`Erro ao solicitar download: ${JSON.stringify(downloadResponse.data.errors)}`);
            }

            // 2. Aguarda até 30 segundos pelo download (com retry)
            let retryCount = 0;
            const maxRetries = 6; // 6 tentativas = 30 segundos total
            
            while (retryCount < maxRetries) {
                try {
                    // Verifica o status do download
                    const statusResponse = await this.whatsappAxios.get(`/v1/media/${mediaId}`);
                    
                    if (statusResponse.data?.media_items?.[0]?.status === 'downloaded') {
                        // Mídia baixada com sucesso, retorna o buffer
                        const mediaResponse = await this.whatsappAxios.get(`/v1/media/${mediaId}/content`, {
                            responseType: 'arraybuffer'
                        });
                        
                        return mediaResponse.data;
                    }
                    
                    // Se ainda não baixou, aguarda 5 segundos
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    retryCount++;
                    
                } catch (error) {
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

    async downloadImages(imageMessages) {
        try {
            console.log('📥 Iniciando download das imagens do WhatsApp...', {
                mensagens: JSON.stringify(imageMessages, null, 2)
            });
            
            if (!Array.isArray(imageMessages)) {
                imageMessages = [imageMessages];
            }

            // Valida se há mensagens
            if (!imageMessages?.length) {
                throw new Error('Nenhuma mensagem de imagem fornecida');
            }

            const downloadedImages = await Promise.all(imageMessages.map(async (imageMessage) => {
                console.log('Processando mensagem:', JSON.stringify(imageMessage, null, 2));

                // Extrai o remetente usando a nova função robusta
                const from = this.extractSenderNumber(imageMessage);

                // Extrai ID da mídia
                const mediaId = imageMessage?.imageMessage?.mediaKey || 
                              imageMessage?.mediaKey ||
                              imageMessage?.id;

                if (!mediaId) {
                    throw new Error('ID da mídia não encontrado na mensagem');
                }

                // Garante que o mimetype é suportado
                const supportedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
                const mimetype = imageMessage?.mimetype || 
                               imageMessage?.imageMessage?.mimetype || 
                               'image/jpeg';
                
                if (!supportedTypes.includes(mimetype)) {
                    throw new Error(`Tipo de imagem não suportado: ${mimetype}. Use: ${supportedTypes.join(', ')}`);
                }

                // Gera um nome único para o arquivo temporário
                const extension = mimetype.split('/')[1];
                const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whatsapp-'));
                const tempFile = path.join(tempDir, `${uuidv4()}.${extension}`);

                // Faz o download usando o endpoint oficial
                const mediaBuffer = await this.downloadMedia(mediaId);

                // Salva a imagem no arquivo temporário
                await fs.writeFile(tempFile, mediaBuffer);

                // Converte para base64
                const base64Image = mediaBuffer.toString('base64');

                console.log('✅ Download da imagem concluído:', {
                    tamanho: mediaBuffer.length,
                    arquivo: tempFile,
                    mimetype: mimetype,
                    from: from
                });

                return {
                    filePath: tempFile,
                    mimetype: mimetype,
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

    async downloadImage(imageMessage) {
        try {
            console.log('📥 [WhatsAppImageService] Iniciando download da imagem');

            // Verifica se temos uma URL válida
            const imageUrl = imageMessage.url || 
                            `https://mmg.whatsapp.net${imageMessage.directPath}`;

            if (!imageUrl) {
                throw new Error('URL da imagem não encontrada');
            }

            // Cria diretório temporário para a imagem
            const tempDir = path.join(os.tmpdir(), 'whatsapp-images', uuidv4());
            await fs.mkdir(tempDir, { recursive: true });

            // Define o caminho do arquivo
            const filePath = path.join(tempDir, `image.${imageMessage.mimetype.split('/')[1]}`);

            // Faz o download da imagem
            const response = await axios({
                method: 'GET',
                url: imageUrl,
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'WhatsApp/2.2123.8 Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            // Salva a imagem
            await fs.writeFile(filePath, response.data);

            // Converte para base64
            const base64 = response.data.toString('base64');

            console.log('✅ [WhatsAppImageService] Download concluído:', {
                tamanho: response.data.length,
                tipo: imageMessage.mimetype,
                caminho: filePath
            });

            return {
                success: true,
                filePath,
                base64,
                mimetype: imageMessage.mimetype
            };

        } catch (error) {
            console.error('❌ [WhatsAppImageService] Erro ao baixar imagem:', {
                erro: error.message,
                stack: error.stack
            });
            return {
                success: false,
                error: error.message
            };
        }
    }

    async analyzeImages(message) {
        try {
            console.log('🖼️ [WhatsAppImageService] Iniciando análise de imagens');

            // Extrai o remetente usando o método robusto
            const from = this.extractSenderNumber(message);

            // Extrai a imagem de forma mais robusta
            const imageMessage = message.message?.imageMessage;
            if (!imageMessage) {
                throw new Error('Dados da imagem não encontrados');
            }

            // Faz o download da imagem
            const downloadResult = await this.downloadImage(imageMessage);
            if (!downloadResult.success) {
                throw new Error(`Falha ao baixar imagem: ${downloadResult.error}`);
            }

            // Prepara o prompt para a OpenAI Vision
            const prompt = `Analise esta imagem e descreva detalhadamente o que você vê.
                           ${imageMessage.caption ? `Contexto adicional do usuário: ${imageMessage.caption}` : ''}`;

            // Envia para análise
            const analysis = await this.openAIVisionService.analyzeImage({
                base64: downloadResult.base64,
                mimetype: downloadResult.mimetype,
                prompt: prompt
            });

            // Limpa o arquivo temporário
            try {
                await fs.unlink(downloadResult.filePath);
                await fs.rmdir(path.dirname(downloadResult.filePath));
            } catch (cleanupError) {
                console.warn('⚠️ [WhatsAppImageService] Erro ao limpar arquivos temporários:', cleanupError);
            }

            return {
                success: true,
                analysis: analysis,
                metadata: {
                    from,
                    mimetype: imageMessage.mimetype,
                    caption: imageMessage.caption || ''
                }
            };

        } catch (error) {
            console.error('❌ [WhatsAppImageService] Erro ao analisar imagens:', {
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
                                - Qualquer informação médica ou relacionada à ortopedia`;

            // Envia para análise
            const response = await this.openaiAxios.post('/v1/chat/completions', {
                model: "gpt-4-vision-preview",
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
                    model: "gpt-4-vision-preview",
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
