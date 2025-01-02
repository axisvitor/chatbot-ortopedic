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
     * Processa uma imagem usando o GPT-4 Vision API
     * @param {Object} message Mensagem contendo a imagem e informações adicionais
     * @returns {Promise<Object>} Resultado da análise da imagem
     */
    async processImage(message) {
        try {
            console.log('🎯 [OpenAIVision] Iniciando processamento:', {
                messageId: message.key?.id,
                timestamp: new Date().toISOString()
            });

            const payload = {
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: message.imageMessage.caption || "Você é um assistente especializado em análise de imagens. Analise a imagem em detalhes e forneça uma descrição completa e precisa do que você vê."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${message.imageMessage.mimetype};base64,${message.imageMessage.base64}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000
            };

            console.log('📤 [OpenAIVision] Enviando para API:', {
                messageId: message.key?.id,
                modelo: payload.model,
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
                analysis,
                metadata: {
                    model: payload.model,
                    tokens: response.data.usage,
                    messageId: message.key?.id
                }
            };

        } catch (error) {
            console.error('❌ [OpenAIVision] Erro ao processar imagem:', {
                messageId: message.key?.id,
                erro: error.message,
                stack: error.stack
            });
            throw error;
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