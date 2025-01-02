const axios = require('axios');
const { OPENAI_CONFIG } = require('../config/settings');

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
     * Processa uma imagem usando o GPT-4 Vision
     * @param {Object} imageData Dados da imagem
     * @returns {Promise<string>} Resultado da análise
     */
    async processImage(imageData) {
        try {
            console.log('🔍 [OpenAIVision] Iniciando análise:', {
                tamanho: `${(imageData.buffer.length / 1024 / 1024).toFixed(2)}MB`,
                mimetype: imageData.metadata.mimetype,
                from: imageData.metadata.from
            });

            // Converte buffer para base64
            const base64Image = imageData.buffer.toString('base64');

            const payload = {
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: imageData.caption || "Analise esta imagem em detalhes e descreva o que você vê."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${imageData.metadata.mimetype};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000,
                temperature: 0.7
            };

            const response = await this.axios.post('/chat/completions', payload);

            // Valida a resposta
            if (!response?.data?.choices?.[0]?.message?.content) {
                throw new Error('Resposta inválida da API OpenAI Vision');
            }

            const analysis = response.data.choices[0].message.content;

            console.log('✅ [OpenAIVision] Análise concluída:', {
                tamanhoResposta: analysis.length,
                preview: analysis.substring(0, 100) + '...',
                from: imageData.metadata.from
            });

            return analysis;

        } catch (error) {
            console.error('❌ [OpenAIVision] Erro ao analisar imagem:', {
                erro: error.message,
                stack: error.stack,
                from: imageData.metadata?.from
            });
            throw error;
        }
    }
}

module.exports = { OpenAIVisionService };