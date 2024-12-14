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

    async analyzeImage(imageData, mimeType = 'image/jpeg') {
        try {
            let base64Image;
            
            if (Buffer.isBuffer(imageData)) {
                // Se for um buffer, converte para base64
                base64Image = imageData.toString('base64');
                console.log('🖼️ Processando buffer de imagem:', { 
                    bufferSize: imageData.length,
                    mimeType
                });
            } else if (typeof imageData === 'string') {
                if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
                    // Se for uma URL, faz o download primeiro
                    console.log('🖼️ Baixando imagem da URL:', imageData);
                    const response = await axios.get(imageData, {
                        responseType: 'arraybuffer',
                        headers: {
                            'Accept': 'image/*'
                        }
                    });
                    const buffer = Buffer.from(response.data);
                    base64Image = buffer.toString('base64');
                    console.log('🖼️ Download concluído:', {
                        bufferSize: buffer.length,
                        mimeType: response.headers['content-type'] || mimeType
                    });
                } else {
                    // Se for um caminho local, lê o arquivo
                    const buffer = await fs.readFile(imageData);
                    base64Image = buffer.toString('base64');
                    console.log('🖼️ Lendo arquivo local:', {
                        path: imageData,
                        bufferSize: buffer.length,
                        mimeType
                    });
                }
            } else {
                throw new Error('Formato de imagem inválido. Esperado: Buffer, URL ou caminho do arquivo');
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
                messageTypes: payload.messages[0].content.map(c => c.type)
            });

            const response = await this.axiosInstance.post(
                'https://api.groq.com/v1/chat/completions',
                payload
            );

            console.log('📥 Resposta recebida de Groq:', {
                status: response.status,
                messageLength: response.data?.choices?.[0]?.message?.content?.length || 0
            });

            return response.data?.choices?.[0]?.message?.content || null;

        } catch (error) {
            console.error('❌ Erro ao analisar imagem:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
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
