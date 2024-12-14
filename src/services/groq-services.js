const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');
const settings = require('../config/settings');

class GroqServices {
    constructor() {
        this.models = settings.GROQ_CONFIG.models
        this.axiosInstance = axios.create({
            headers: {
                'Authorization': `Bearer ${settings.GROQ_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        })
    }

    async analyzeImage(imageBuffer, mimeType = 'image/jpeg') {
        try {
            console.log('🖼️ Analisando imagem:', { 
                bufferSize: imageBuffer.length,
                mimeType,
                primeirosBytes: imageBuffer.slice(0, 16).toString('hex')
            });

            // Converte o buffer para base64
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
                                    url: `data:${mimeType};base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000
            };

            console.log('📤 Enviando request para Groq:', {
                model: this.models.vision,
                imageSize: base64Image.length,
                endpoint: '/openai/v1/chat/completions'
            });

            const response = await this.axiosInstance.post(
                'https://api.groq.com/openai/v1/chat/completions',
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
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
                data: error.response?.data,
                stack: error.stack
            });
            throw error;
        }
    }

    async transcribeAudio(formData) {
        try {
            console.log('🎤 Iniciando transcrição com Groq');
            
            // Remove o Content-Type padrão para permitir que o FormData defina o boundary
            const headers = { ...this.axiosInstance.defaults.headers };
            delete headers['Content-Type'];
            
            const response = await this.axiosInstance.post(
                'https://api.groq.com/openai/v1/audio/transcriptions',
                formData,
                {
                    headers: {
                        ...headers,
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
                data: error.response?.data,
                headers: error.response?.headers,
                requestHeaders: error.config?.headers,
                requestUrl: error.config?.url,
                requestData: error.config?.data
            });
            throw new Error(`Erro na transcrição: ${error.message}. Status: ${error.response?.status}. Detalhes: ${JSON.stringify(error.response?.data)}`);
        }
    }
}

module.exports = { GroqServices };
