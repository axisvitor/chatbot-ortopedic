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

    async analyzeImage(imageData) {
        try {
            if (!Buffer.isBuffer(imageData)) {
                throw new Error('Formato de imagem inválido. Esperado: Buffer de imagem decodificada');
            }

            // Detecta o tipo MIME baseado nos primeiros bytes
            const mimeType = this.detectMimeType(imageData);
            
            console.log('🖼️ Processando buffer de imagem:', { 
                bufferSize: imageData.length,
                mimeType,
                primeirosBytes: imageData.slice(0, 8).toString('hex')
            });

            // Converte para base64
            const base64Image = imageData.toString('base64');

            if (!base64Image || base64Image.length === 0) {
                throw new Error('Falha ao converter imagem para base64');
            }

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
                messageTypes: payload.messages[0].content.map(c => c.type),
                imageSize: base64Image.length
            });

            const response = await this.axiosInstance.post(
                'https://api.groq.com/v1/chat/completions',
                payload
            );

            if (!response.data?.choices?.[0]?.message?.content) {
                throw new Error('Resposta inválida do Groq');
            }

            console.log('📥 Resposta recebida de Groq:', {
                status: response.status,
                messageLength: response.data.choices[0].message.content.length
            });

            return response.data.choices[0].message.content;

        } catch (error) {
            console.error('❌ Erro ao analisar imagem:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }

    detectMimeType(buffer) {
        // Detecta o tipo MIME baseado nos primeiros bytes
        const header = buffer.slice(0, 4).toString('hex').toLowerCase();
        
        // Magic numbers comuns
        if (header.startsWith('ffd8ff')) {
            return 'image/jpeg';
        }
        if (header.startsWith('89504e47')) {
            return 'image/png';
        }
        if (header.startsWith('47494638')) {
            return 'image/gif';
        }
        if (header.startsWith('424d')) {
            return 'image/bmp';
        }
        
        // Default para JPEG se não conseguir detectar
        return 'image/jpeg';
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
