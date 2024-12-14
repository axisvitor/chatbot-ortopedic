const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');
const settings = require('../config/settings');

class GroqServices {
    constructor() {
        this.baseUrl = settings.GROQ_CONFIG.apiUrl;
        this.models = settings.GROQ_CONFIG.models;
        this.axiosInstance = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Authorization': `Bearer ${settings.GROQ_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async analyzeImage(imagePath) {
        try {
            console.log('🖼️ Analisando imagem:', { path: imagePath });

            // Converte a imagem para base64
            const imageBuffer = await fs.readFile(imagePath);
            const base64Image = imageBuffer.toString('base64');

            const payload = {
                model: this.models.vision,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Analise esta imagem e me diga se é um comprovante de pagamento. Se for, extraia as informações relevantes como valor, data, tipo de pagamento (PIX, TED, etc), banco origem e destino. Se não for um comprovante, apenas diga que não é um comprovante de pagamento."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ]
            };

            console.log('📤 Enviando request para Groq:', {
                model: this.models.vision,
                imageSize: base64Image.length
            });

            const response = await this.axiosInstance.post(
                `/chat/completions`,
                payload
            );

            if (response.data?.choices?.[0]?.message?.content) {
                return response.data.choices[0].message.content;
            } else {
                throw new Error('Resposta inválida do Groq');
            }

        } catch (error) {
            console.error('❌ Erro ao analisar imagem com Groq:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            return "Desculpe, não foi possível analisar o comprovante no momento. Por favor, tente novamente em alguns instantes.";
        }
    }

    async transcribeAudio(formData) {
        try {
            console.log('🎤 Iniciando transcrição com Groq');
            
            const response = await this.axiosInstance.post(
                `/v1/audio/transcriptions`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Accept': 'application/json'
                    },
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity
                }
            );

            console.log('✅ Resposta da transcrição:', response.data);

            if (response.data?.text) {
                return response.data.text.trim();
            } else {
                throw new Error('Formato de resposta inválido');
            }
        } catch (error) {
            console.error('❌ Erro na transcrição com Groq:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }
}

module.exports = { GroqServices };
