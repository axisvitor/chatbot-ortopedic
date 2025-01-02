const axios = require('axios');
const { OPENAI_CONFIG } = require('../config/settings');
const { detectImageFormatFromBuffer } = require('../utils/image-format');

class OpenAIVisionService {
    constructor() {
        this.axios = axios.create({
            baseURL: OPENAI_CONFIG.baseUrl,
            headers: {
                'Authorization': `Bearer ${OPENAI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
    }

    /**
     * Processa uma imagem e retorna a análise
     * @param {Object} message Mensagem com informações adicionais
     * @returns {Promise<Object>} Resultado da análise
     */
    async processImage(message) {
        try {
            console.log('🎯 [OpenAIVision] Iniciando processamento:', {
                messageId: message.key?.id,
                from: message.key?.remoteJid,
                timestamp: new Date().toISOString()
            });

            // Download da imagem
            console.log('📥 [OpenAIVision] Baixando mídia...', {
                messageId: message.key?.id
            });

            const buffer = await downloadMediaMessage(message, 'buffer');

            console.log('✅ [OpenAIVision] Download concluído:', {
                messageId: message.key?.id,
                tamanho: buffer.length,
                tamanhoMB: (buffer.length / (1024 * 1024)).toFixed(2) + 'MB'
            });

            // Converte para base64
            const base64Image = buffer.toString('base64');
            
            console.log('🔄 [OpenAIVision] Preparando payload:', {
                messageId: message.key?.id,
                tamanhoBase64: base64Image.length,
                timestamp: new Date().toISOString()
            });

            // Monta o payload para a OpenAI Vision
            const payload = {
                model: OPENAI_CONFIG.models.vision,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'Analise esta imagem em detalhes. Determine:\n' +
                                    '1. O tipo da imagem (comprovante de pagamento, foto de calçado, foto de pés para medidas, tabela de medidas/numeração)\n' +
                                    '2. Uma descrição detalhada do que você vê\n' +
                                    '3. Se for um comprovante de pagamento, extraia: valor, data e ID da transação'
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${message.imageMessage.mimetype};base64,${base64Image}`,
                                    detail: OPENAI_CONFIG.visionConfig.detail
                                }
                            }
                        ]
                    }
                ],
                ...OPENAI_CONFIG.visionConfig
            };

            console.log('📤 [OpenAIVision] Enviando para API:', {
                messageId: message.key?.id,
                modelo: OPENAI_CONFIG.models.vision,
                timestamp: new Date().toISOString()
            });

            const response = await this.axios.post('/chat/completions', payload);

            if (!response.data?.choices?.[0]?.message?.content) {
                console.error('❌ [OpenAIVision] Resposta inválida:', {
                    messageId: message.key?.id,
                    status: response.status,
                    data: response.data
                });
                throw new Error('Resposta inválida da API OpenAI Vision');
            }

            const analysis = response.data.choices[0].message.content;

            console.log('✅ [OpenAIVision] Análise concluída:', {
                messageId: message.key?.id,
                tamanhoResposta: analysis.length,
                preview: analysis.substring(0, 100) + '...',
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                analysis
            };

        } catch (error) {
            console.error('❌ [OpenAIVision] Erro no processamento:', {
                erro: error.message,
                stack: error.stack,
                status: error.response?.status,
                data: error.response?.data,
                messageId: message.key?.id,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Analisa uma imagem usando base64
     * @param {string} base64Image Imagem em base64
     * @param {Object} options Opções adicionais
     * @returns {Promise<Object>} Resultado da análise
     */
    async analyzeImage(base64Image, options = {}) {
        try {
            console.log('🔍 Iniciando análise com OpenAI Vision...', {
                temCaption: !!options.caption,
                mimetype: options.mimetype
            });

            // Prepara o prompt para a análise
            const prompt = this.buildAnalysisPrompt(options.caption);

            const payload = {
                model: OPENAI_CONFIG.models.vision,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: prompt
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${options.mimetype || 'image/jpeg'};base64,${base64Image}`,
                                    detail: OPENAI_CONFIG.visionConfig.detail
                                }
                            }
                        ]
                    }
                ],
                ...OPENAI_CONFIG.visionConfig
            };

            console.log('📤 Enviando requisição para OpenAI Vision...');
            const response = await this.axios.post('/chat/completions', payload);

            if (!response.data?.choices?.[0]?.message?.content) {
                throw new Error('Resposta inválida da API OpenAI Vision');
            }

            console.log('✅ Análise concluída com sucesso:', {
                statusCode: response.status,
                tamanhoResposta: JSON.stringify(response.data).length
            });

            return JSON.parse(response.data.choices[0].message.content);

        } catch (error) {
            console.error('❌ Erro na análise com OpenAI Vision:', {
                erro: error.message,
                stack: error.stack,
                status: error.response?.status,
                resposta: error.response?.data
            });
            throw error;
        }
    }

    buildAnalysisPrompt(caption) {
        return `
            Analise esta imagem em detalhes. Se for um comprovante de pagamento, extraia as seguintes informações:
            - Valor da transação
            - Data da transação
            - Tipo de transação (PIX, transferência, boleto, etc)
            - Status do pagamento
            - Informações adicionais relevantes

            Contexto adicional da imagem: ${caption || 'Nenhum'}

            Por favor, forneça uma análise detalhada e estruturada.
        `.trim();
    }
}

module.exports = { OpenAIVisionService };