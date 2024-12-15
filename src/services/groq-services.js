const axios = require('axios');
const FormData = require('form-data');
const { detectImageFormatFromBuffer } = require('../utils/image-format');

class GroqServices {
    constructor() {
        this.models = {
            vision: 'llama-3.2-90b-vision-preview',
            audio: 'whisper-large-v3-turbo'
        };

        this.imageAnalysisConfig = {
            prompt: 'Analise esta imagem e me diga se é um comprovante de pagamento válido. Se for, extraia as informações relevantes como valor, data, beneficiário e tipo de transação.',
            maxRetries: 3,
            retryDelay: 1000
        };

        this.axiosInstance = axios.create({
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
    }

    async prepareImageData(imageData) {
        let buffer;
        
        // Log inicial dos dados recebidos
        console.log('[Groq] Preparando dados da imagem:', {
            type: typeof imageData,
            isBuffer: Buffer.isBuffer(imageData),
            length: imageData?.length,
            isString: typeof imageData === 'string',
            startsWithHttp: typeof imageData === 'string' && imageData.startsWith('http')
        });

        // Converte para Buffer se necessário
        if (typeof imageData === 'string') {
            // Se for uma URL, faz o download
            if (imageData.startsWith('http')) {
                try {
                    const response = await axios({
                        method: 'GET',
                        url: imageData,
                        responseType: 'arraybuffer',
                        timeout: 10000,
                        maxContentLength: 10 * 1024 * 1024 // 10MB
                    });
                    buffer = Buffer.from(response.data);
                } catch (error) {
                    throw new Error(`Falha ao baixar imagem: ${error.message}`);
                }
            } 
            // Se for uma data URL
            else if (imageData.startsWith('data:')) {
                const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                    buffer = Buffer.from(matches[2], 'base64');
                } else {
                    throw new Error('Data URL inválida');
                }
            } 
            // Se for base64 puro
            else {
                try {
                    buffer = Buffer.from(imageData, 'base64');
                } catch (error) {
                    throw new Error('String base64 inválida');
                }
            }
        } else if (Buffer.isBuffer(imageData)) {
            buffer = imageData;
        } else {
            throw new Error('Dados inválidos: esperado Buffer, URL ou string base64');
        }

        // Validação do buffer
        if (!buffer || buffer.length < 8) {
            throw new Error('Buffer inválido ou muito pequeno');
        }

        // Log do buffer para debug
        console.log('[Groq] Buffer recebido:', {
            length: buffer.length,
            firstBytes: buffer.slice(0, 32).toString('hex').toUpperCase(),
            isJPEG: buffer.slice(0, 2).toString('hex').toUpperCase() === 'FFD8',
            isPNG: buffer.slice(0, 8).toString('hex').toUpperCase().includes('89504E47')
        });

        // Detecta o formato
        const detectedFormat = detectImageFormatFromBuffer(buffer);
        if (!detectedFormat) {
            throw new Error('Formato de imagem não reconhecido');
        }

        // Converte para base64
        const base64Data = buffer.toString('base64');

        return {
            format: detectedFormat,
            base64: base64Data,
            buffer
        };
    }

    async analyzeImage(imageData) {
        let attempt = 0;
        let lastError;

        while (attempt < this.imageAnalysisConfig.maxRetries) {
            try {
                const { format, base64, buffer } = await this.prepareImageData(imageData);

                console.log('[Groq] Enviando imagem para análise:', {
                    format,
                    bufferSize: buffer.length,
                    base64Length: base64.length,
                    attempt: attempt + 1,
                    model: this.models.vision
                });

                const requestData = {
                    model: this.models.vision,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:${format};base64,${base64}`
                                    }
                                },
                                {
                                    type: 'text',
                                    text: this.imageAnalysisConfig.prompt
                                }
                            ]
                        }
                    ],
                    temperature: 0.1
                };

                const response = await this.axiosInstance.post(
                    'https://api.groq.com/v1/chat/completions',
                    requestData
                );

                if (!response?.data?.choices?.[0]?.message?.content) {
                    throw new Error('Resposta inválida da API');
                }

                return response.data.choices[0].message.content;

            } catch (error) {
                console.error(`[Groq] Erro na tentativa ${attempt + 1}:`, {
                    message: error.message,
                    status: error.response?.status,
                    data: error.response?.data
                });

                lastError = error;
                attempt++;

                if (attempt < this.imageAnalysisConfig.maxRetries) {
                    await new Promise(resolve => 
                        setTimeout(resolve, this.imageAnalysisConfig.retryDelay * attempt)
                    );
                }
            }
        }

        throw new Error(`Falha ao analisar imagem após ${attempt} tentativas: ${lastError.message}`);
    }
}

module.exports = { GroqServices };
