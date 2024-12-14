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
            let buffer;
            let base64Data;

            // Se for uma string data URL
            if (typeof imageData === 'string') {
                // Remove espaços em branco e quebras de linha
                const cleanedData = imageData.trim().replace(/[\n\r]/g, '');
                
                // Verifica se é uma data URL válida
                const dataUrlMatch = cleanedData.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
                if (!dataUrlMatch) {
                    throw new Error('Formato de data URL inválido');
                }

                // Extrai apenas o base64, removendo o prefixo
                base64Data = dataUrlMatch[2];
                
                // Converte para buffer
                try {
                    buffer = Buffer.from(base64Data, 'base64');
                } catch (e) {
                    throw new Error('Base64 inválido: não foi possível converter para buffer');
                }
            }
            // Se já for um Buffer
            else if (Buffer.isBuffer(imageData)) {
                buffer = imageData;
                base64Data = buffer.toString('base64');
            }
            else {
                throw new Error('Formato de imagem inválido. Esperado: Buffer ou data URL base64');
            }

            // Verifica o tamanho do buffer
            const sizeInMB = buffer.length / (1024 * 1024);
            if (sizeInMB > 4) {
                throw new Error('Imagem muito grande. O limite máximo é 4MB');
            }

            // Verifica se o buffer tem os bytes iniciais de uma imagem válida
            const magicNumbers = {
                'ffd8ff': 'image/jpeg',  // JPEG
                '89504e47': 'image/png', // PNG
                '47494638': 'image/gif', // GIF
                '52494646': 'image/webp' // WEBP
            };

            const fileHeader = buffer.slice(0, 4).toString('hex').toLowerCase();
            let detectedFormat = null;
            
            for (const [magic, format] of Object.entries(magicNumbers)) {
                if (fileHeader.startsWith(magic)) {
                    detectedFormat = format;
                    break;
                }
            }

            if (!detectedFormat) {
                throw new Error('Formato de imagem não reconhecido. Por favor, use JPEG, PNG, GIF ou WEBP');
            }

            console.log('🖼️ Processando imagem:', {
                formato: detectedFormat,
                tamanhoMB: sizeInMB.toFixed(2),
                bytesIniciais: fileHeader
            });

            // Prepara o payload para o Groq
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
                                    url: `data:${detectedFormat};base64,${base64Data}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000,
                temperature: 0.7
            };

            const response = await this.axiosInstance.post(
                'https://api.groq.com/openai/v1/chat/completions',
                payload
            );

            if (!response.data?.choices?.[0]?.message?.content) {
                throw new Error('Resposta inválida do Groq');
            }

            return response.data.choices[0].message.content;

        } catch (error) {
            console.error('❌ Erro ao analisar imagem:', {
                erro: error.message,
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
