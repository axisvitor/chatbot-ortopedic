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
            let detectedFormat;

            // Se for uma string base64 ou data URL
            if (typeof imageData === 'string') {
                // Remove espaços em branco e quebras de linha
                const cleanedData = imageData.trim().replace(/[\n\r]/g, '');
                
                // Verifica se é uma data URL
                if (cleanedData.startsWith('data:')) {
                    const dataUrlMatch = cleanedData.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
                    if (!dataUrlMatch) {
                        throw new Error('Formato de data URL inválido');
                    }
                    base64Data = dataUrlMatch[2];
                    detectedFormat = `image/${dataUrlMatch[1]}`;
                } else {
                    // Assume que é base64 puro
                    base64Data = cleanedData;
                }

                // Converte para buffer
                try {
                    buffer = Buffer.from(base64Data, 'base64');
                } catch (e) {
                    console.error('❌ Erro ao converter base64:', e);
                    throw new Error('Base64 inválido: não foi possível converter para buffer');
                }
            }
            // Se já for um Buffer
            else if (Buffer.isBuffer(imageData)) {
                buffer = imageData;
                base64Data = buffer.toString('base64');
            }
            else {
                throw new Error('Formato de imagem inválido. Esperado: Buffer ou string base64');
            }

            // Verifica o tamanho do buffer
            const sizeInMB = buffer.length / (1024 * 1024);
            if (sizeInMB > 4) {
                throw new Error('Imagem muito grande. O limite máximo é 4MB');
            }

            // Se o formato ainda não foi detectado via data URL, tenta pelos magic numbers
            if (!detectedFormat) {
                const magicNumbers = {
                    'ffd8': 'image/jpeg',     // JPEG pode começar com ffd8
                    '89504e47': 'image/png',  // PNG
                    '47494638': 'image/gif',  // GIF
                    '52494646': 'image/webp', // WEBP
                    'FFD8FFE0': 'image/jpeg', // JPEG (JFIF)
                    'FFD8FFE1': 'image/jpeg', // JPEG (Exif)
                    'FFD8FFE2': 'image/jpeg', // JPEG (SPIFF)
                    'FFD8FFE3': 'image/jpeg', // JPEG (JPS)
                    'FFD8FFE8': 'image/jpeg'  // JPEG (SPIFF)
                };

                const fileHeader = buffer.slice(0, 4).toString('hex').toUpperCase();
                const shortHeader = fileHeader.slice(0, 4);
                
                console.log('🔍 Analisando cabeçalho da imagem:', {
                    header: fileHeader,
                    shortHeader,
                    bufferLength: buffer.length,
                    firstBytes: buffer.slice(0, 16).toString('hex').toUpperCase()
                });
                
                // Primeiro tenta com o cabeçalho completo
                for (const [magic, format] of Object.entries(magicNumbers)) {
                    if (fileHeader.startsWith(magic.toUpperCase())) {
                        detectedFormat = format;
                        break;
                    }
                }

                // Se não encontrou, tenta com o cabeçalho curto (para JPEG)
                if (!detectedFormat && magicNumbers[shortHeader]) {
                    detectedFormat = magicNumbers[shortHeader];
                }

                // Se ainda não encontrou mas começa com FFD8, assume JPEG
                if (!detectedFormat && shortHeader.startsWith('FFD8')) {
                    detectedFormat = 'image/jpeg';
                }
            }

            if (!detectedFormat) {
                console.error('❌ Formato não reconhecido:', {
                    header: buffer.slice(0, 4).toString('hex').toUpperCase(),
                    bufferStart: buffer.slice(0, 16).toString('hex').toUpperCase()
                });
                throw new Error('Formato de imagem não reconhecido ou corrompido');
            }

            console.log('🖼️ Processando imagem:', {
                formato: detectedFormat,
                tamanhoMB: sizeInMB.toFixed(2),
                bufferLength: buffer.length
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
                stack: error.stack,
                tipo: typeof imageData
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
