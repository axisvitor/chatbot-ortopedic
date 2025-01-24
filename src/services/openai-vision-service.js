const axios = require('axios');
const { OPENAI_CONFIG } = require('../config/settings');

class OpenAIVisionService {
    constructor() {
        this.axios = axios.create({
            baseURL: 'https://api.openai.com/v1',
            headers: {
                'Authorization': `Bearer ${OPENAI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 segundos
        });
    }

    /**
     * Processa uma imagem usando o GPT-4 Vision
     * @param {Object} imageData Dados da imagem
     * @param {Buffer} imageData.buffer Buffer da imagem
     * @param {string} imageData.mimetype Tipo MIME da imagem
     * @param {string} [imageData.caption] Legenda ou contexto da imagem
     * @returns {Promise<string>} Análise da imagem
     */
    async processImage(imageData) {
        try {
            // Validações
            if (!imageData?.buffer) {
                throw new Error('Buffer de imagem não fornecido');
            }

            if (!imageData.mimetype) {
                throw new Error('Tipo MIME da imagem não fornecido');
            }

            console.log(' [OpenAIVision] Iniciando análise:', {
                tamanho: `${(imageData.buffer.length / 1024 / 1024).toFixed(2)}MB`,
                tipo: imageData.mimetype
            });

            // Converte buffer para base64
            const base64Image = imageData.buffer.toString('base64');
            
            // Prepara o prompt baseado no contexto
            const prompt = this.buildPrompt(imageData.caption);

            const payload = {
                model: "gpt-4-vision-preview",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: prompt
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${imageData.mimetype};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 500,
                temperature: 0.7
            };

            console.log(' [OpenAIVision] Enviando requisição:', {
                modelo: payload.model,
                maxTokens: payload.max_tokens,
                temperatura: payload.temperature
            });

            const response = await this.axios.post('/chat/completions', payload);

            // Validação da resposta
            if (!response?.data?.choices?.[0]?.message?.content) {
                throw new Error('Resposta inválida da API OpenAI Vision');
            }

            const analysis = response.data.choices[0].message.content;

            console.log(' [OpenAIVision] Análise concluída:', {
                tamanhoResposta: analysis.length,
                preview: analysis.substring(0, 100) + '...'
            });

            return analysis;

        } catch (error) {
            // Trata erros específicos da API
            if (error.response?.data?.error) {
                const apiError = error.response.data.error;
                console.error(' [OpenAIVision] Erro da API:', {
                    tipo: apiError.type,
                    codigo: apiError.code,
                    mensagem: apiError.message
                });
                throw new Error(`Erro na API Vision: ${apiError.message}`);
            }

            // Trata outros erros
            console.error(' [OpenAIVision] Erro ao analisar imagem:', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Constrói o prompt para análise da imagem
     * @private
     * @param {string} [caption] Legenda ou contexto da imagem
     * @returns {string} Prompt formatado
     */
    buildPrompt(caption) {
        let prompt = 'Analise esta imagem detalhadamente e descreva o que você vê.';
        
        if (caption) {
            prompt += `\n\nContexto adicional fornecido: "${caption}"`;
        }

        prompt += '\n\nPor favor, inclua na sua análise:';
        prompt += '\n1. Descrição geral da imagem';
        prompt += '\n2. Detalhes importantes ou relevantes';
        prompt += '\n3. Se houver texto na imagem, transcreva-o';
        prompt += '\n4. Se for um documento ou comprovante, extraia as informações principais';
        prompt += '\n5. Se for uma imagem médica ou ortopédica, forneça uma análise cuidadosa';

        return prompt;
    }
}

module.exports = { OpenAIVisionService };