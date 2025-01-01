const axios = require('axios');
const OpenAI = require('openai');
const { OPENAI_CONFIG, GROQ_CONFIG } = require('../config/settings');

class ImageProcessingService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: GROQ_CONFIG.apiKey,
            baseURL: GROQ_CONFIG.baseUrl
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

            // Analisa a imagem com Groq Vision
            const completion = await this.openai.chat.completions.create({
                model: "mixtral-8x7b-32768",
                messages: [
                    {
                        role: "system",
                        content: "Você é um assistente especializado em analisar imagens. Extraia todo o texto visível da imagem e forneça uma descrição detalhada do que você vê. Se for um comprovante de pagamento, extraia informações relevantes como valor, data e tipo de transação."
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Por favor, analise esta imagem em detalhes, extraindo todo o texto visível e descrevendo o que você vê."
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
            });

            console.log('[ImageProcessing] Resposta completa da Groq:', JSON.stringify(completion, null, 2));
            
            const analysis = completion.choices[0]?.message?.content;
            
            if (!analysis) {
                console.error('[ImageProcessing] Resposta da Groq não contém análise:', completion);
                throw new Error('Análise da imagem retornou vazia');
            }

            console.log('[ImageProcessing] Análise da imagem:', analysis);
            console.log('[ImageProcessing] Análise concluída com sucesso');
            return analysis;

        } catch (error) {
            console.error('[ImageProcessing] Erro ao extrair texto da imagem:', error);
            throw error;
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
