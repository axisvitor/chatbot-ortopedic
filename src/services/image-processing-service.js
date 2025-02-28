const axios = require('axios');
const { GROQ_CONFIG } = require('../config/settings');

class ImageProcessingService {
    constructor() {
        this.axios = axios.create({
            baseURL: GROQ_CONFIG.baseUrl,
            headers: {
                'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Extrai texto de uma imagem usando Groq Vision
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<string>} Texto extraído e análise da imagem
     */
    async extractTextFromImage(imageUrl) {
        try {
            console.log('[ImageProcessing] Iniciando extração de texto com Groq Vision:', {
                url: imageUrl.substring(0, 50) + '...'
            });
            
            // Baixa a imagem
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);
            const base64Image = buffer.toString('base64');

            // Prepara o payload para o Groq Vision
            const payload = {
                model: "llama-3.2-90b-vision-preview",
                messages: [
                    {
                        role: "system",
                        content: [
                            {
                                type: "text",
                                text: [
                                    "Você é um assistente especializado em analisar imagens e extrair informações relevantes.",
                                    "Se for um comprovante de pagamento:",
                                    "- Extraia o valor, data, tipo de transação e outras informações relevantes",
                                    "- Indique claramente se é um comprovante válido",
                                    "Se for outro tipo de imagem:",
                                    "- Descreva o conteúdo em detalhes",
                                    "- Extraia qualquer texto visível",
                                    "Sempre forneça uma resposta estruturada e clara."
                                ].join("\n")
                            }
                        ]
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Analise esta imagem em detalhes, extraindo todo o texto visível e descrevendo o que você vê."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1024,
                temperature: 0.2
            };

            console.log('[ImageProcessing] Enviando requisição para Groq Vision');
            
            // Faz a requisição para o Groq Vision
            const completion = await this.axios.post('/chat/completions', payload);

            if (!completion.data || !completion.data.choices || !completion.data.choices[0]?.message?.content) {
                throw new Error('Resposta inválida do Groq Vision');
            }

            const analysis = completion.data.choices[0].message.content;
            
            if (!analysis || analysis.trim().length === 0) {
                console.error('[ImageProcessing] Resposta do Groq não contém análise:', completion.data);
                throw new Error('Análise da imagem retornou vazia');
            }

            // Valida se a resposta tem um tamanho mínimo razoável
            if (analysis.length < 50) {
                console.warn('[ImageProcessing] Análise muito curta:', analysis);
                throw new Error('Análise da imagem muito curta ou incompleta');
            }

            console.log('[ImageProcessing] Análise da imagem:', {
                length: analysis.length,
                preview: analysis.substring(0, 100) + '...'
            });

            return analysis;

        } catch (error) {
            console.error('[ImageProcessing] Erro ao extrair texto da imagem:', {
                message: error.message,
                stack: error.stack,
                response: error.response?.data
            });
            
            // Retorna uma mensagem mais amigável para o usuário
            throw new Error('Não foi possível analisar a imagem. Por favor, tente enviar novamente ou envie uma imagem diferente.');
        }
    }

    /**
     * Analisa uma imagem usando Groq Vision
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<string>} Análise detalhada da imagem
     */
    async analyzeImage(imageUrl) {
        try {
            const analysis = await this.extractTextFromImage(imageUrl);
            return analysis;
        } catch (error) {
            console.error('[ImageProcessing] Erro ao analisar imagem:', error);
            throw error;
        }
    }
}

module.exports = { ImageProcessingService };
