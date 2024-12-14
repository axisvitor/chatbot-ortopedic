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

            // Prepara o FormData com a imagem
            const formData = new FormData();
            formData.append('file', imageBuffer, {
                filename: 'image.jpg',
                contentType: mimeType
            });
            formData.append('model', this.models.vision);

            // Remove o Content-Type padrão para permitir que o FormData defina o boundary
            const headers = { ...this.axiosInstance.defaults.headers };
            delete headers['Content-Type'];

            console.log('📤 Enviando request para Groq:', {
                model: this.models.vision,
                imageSize: imageBuffer.length
            });

            const response = await this.axiosInstance.post(
                'https://api.groq.com/openai/v1/chat/completions',
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
