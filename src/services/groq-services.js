const axios = require('axios');
const FormData = require('form-data');
const { detectImageFormatFromBuffer, validateGroqResponse } = require('../utils/image-format');

class GroqServices {
    constructor() {
        // Modelo atual recomendado para visão
        this.models = {
            vision: 'llama-3.2-90b-vision-preview',
            audio: 'whisper-large-v3-turbo'
        };

        // Configurações padrão para análise de imagem
        this.imageAnalysisConfig = {
            prompt: 'Analise esta imagem e me diga se é um comprovante de pagamento válido. Se for, extraia as informações relevantes como valor, data, beneficiário e tipo de transação.',
            maxRetries: 3,
            retryDelay: 1000
        };

        // Cliente axios com configuração base
        this.axiosInstance = axios.create({
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 segundos
        });
    }

    /**
     * Prepara os dados da imagem para envio
     * @param {Buffer} buffer - Buffer da imagem
     * @returns {Object} Objeto com formato e dados base64
     */
    async prepareImageData(buffer) {
        if (!Buffer.isBuffer(buffer)) {
            throw new Error('Dados inválidos: buffer esperado');
        }

        // Detecta o formato
        const detectedFormat = detectImageFormatFromBuffer(buffer);
        if (!detectedFormat) {
            throw new Error('Formato de imagem não reconhecido');
        }

        // Converte para base64
        const base64Data = buffer.toString('base64');

        return {
            format: detectedFormat,
            base64: base64Data
        };
    }

    /**
     * Analisa uma imagem usando a API Groq
     * @param {Buffer} imageData - Buffer da imagem
     * @returns {Promise<string>} Resultado da análise
     */
    async analyzeImage(imageData) {
        let attempt = 0;
        let lastError;

        while (attempt < this.imageAnalysisConfig.maxRetries) {
            try {
                // Prepara os dados da imagem
                const { format, base64 } = await this.prepareImageData(imageData);

                // Log detalhado
                console.log('[Groq] Enviando imagem para análise:', {
                    format,
                    bufferSize: imageData.length,
                    base64Length: base64.length,
                    attempt: attempt + 1,
                    model: this.models.vision
                });

                // Prepara a requisição
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
                    temperature: 0.1 // Mais preciso
                };

                // Faz a requisição
                const response = await this.axiosInstance.post(
                    'https://api.groq.com/v1/chat/completions',
                    requestData
                );

                // Valida a resposta
                const validation = validateGroqResponse(response);
                if (!validation.isValid) {
                    throw new Error(validation.error);
                }

                return validation.content;

            } catch (error) {
                console.error(`[Groq] Erro na tentativa ${attempt + 1}:`, {
                    message: error.message,
                    status: error.response?.status,
                    data: error.response?.data
                });

                lastError = error;
                attempt++;

                // Se não for a última tentativa, espera antes de tentar novamente
                if (attempt < this.imageAnalysisConfig.maxRetries) {
                    await new Promise(resolve => 
                        setTimeout(resolve, this.imageAnalysisConfig.retryDelay * attempt)
                    );
                }
            }
        }

        // Se todas as tentativas falharam
        const errorMessage = lastError?.response?.data?.error?.message || lastError?.message;
        throw new Error(`Falha ao analisar imagem após ${attempt} tentativas: ${errorMessage}`);
    }

    /**
     * Transcreve áudio usando a API Groq
     * @param {Buffer} audioBuffer - Buffer do áudio
     * @param {string} mimeType - Tipo MIME do áudio
     * @returns {Promise<string>} Texto transcrito
     */
    async transcribeAudio(audioBuffer, mimeType) {
        try {
            if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
                throw new Error('Áudio inválido: buffer não fornecido ou inválido');
            }

            if (!mimeType || typeof mimeType !== 'string') {
                throw new Error('Tipo MIME do áudio não fornecido');
            }

            // Converte o buffer para base64
            const base64Audio = audioBuffer.toString('base64');

            // Log do áudio
            console.log('[Groq] Preparando áudio para transcrição:', {
                bufferSize: audioBuffer.length,
                mimeType,
                base64Length: base64Audio.length,
                model: this.models.audio
            });

            // Prepara os dados para envio
            const requestData = {
                model: this.models.audio,
                file: `data:${mimeType};base64,${base64Audio}`,
                language: 'pt'
            };

            const response = await this.axiosInstance.post(
                'https://api.groq.com/v1/audio/transcriptions',
                requestData
            );

            if (!response?.data?.text) {
                throw new Error('Resposta da API não contém texto transcrito');
            }

            return response.data.text;

        } catch (error) {
            console.error('[Groq] Erro ao transcrever áudio:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }
}

module.exports = { GroqServices };
