const axios = require('axios');
const FormData = require('form-data');
const { detectImageFormatFromBuffer } = require('../utils/image-format');
const { GROQ_CONFIG } = require('../config/settings');

class GroqServices {
    constructor() {
        this.axios = axios.create({
            timeout: 30000,
        });
    }

    async generateText(messages, attempt = 1) {
        try {
            const response = await this.axios.post(GROQ_CONFIG.chatUrl, { messages }, {
                headers: {
                    'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`
                }
            });

            if (response.status !== 200) {
                console.error(`❌ Erro na API Groq (Tentativa ${attempt}):`, response.status, response.data);
                throw new Error(`Erro na API Groq: ${response.status} - ${JSON.stringify(response.data)}`);
            }

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error(`❌ Erro ao gerar texto (Tentativa ${attempt}):`, error.message);
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                return this.generateText(messages, attempt + 1);
            }
            throw new Error(`Falha ao gerar texto após ${attempt} tentativas: ${error.message}`);
        }
    }

    async generateEmbeddings(text, attempt = 1) {
        try {
            const response = await this.axios.post(GROQ_CONFIG.embeddingsUrl, { input: text }, {
                headers: {
                    'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`
                }
            });

            if (response.status !== 200) {
                console.error(`❌ Erro na API Groq (Tentativa ${attempt}):`, response.status, response.data);
                throw new Error(`Erro na API Groq: ${response.status} - ${JSON.stringify(response.data)}`);
            }

            return response.data.data[0].embedding;
        } catch (error) {
            console.error(`❌ Erro ao gerar embeddings (Tentativa ${attempt}):`, error.message);
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                return this.generateEmbeddings(text, attempt + 1);
            }
            throw new Error(`Falha ao gerar embeddings após ${attempt} tentativas: ${error.message}`);
        }
    }

    async processImage(buffer, attempt = 1) {
        try {
            const imageFormat = detectImageFormatFromBuffer(buffer);
            if (!imageFormat) {
                throw new Error('Formato de imagem não suportado.');
            }

            const formData = new FormData();
            formData.append('file', buffer, `image.${imageFormat.split('/')[1]}`);

            const response = await this.axios.post(GROQ_CONFIG.visionUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`
                },
                timeout: 30000
            });

            if (response.status !== 200) {
                console.error(`❌ Erro na API Groq (Tentativa ${attempt}):`, response.status, response.data);
                throw new Error(`Erro na API Groq: ${response.status} - ${JSON.stringify(response.data)}`);
            }

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error(`❌ Erro ao processar imagem (Tentativa ${attempt}):`, error.message);
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                return this.processImage(buffer, attempt + 1);
            }
            throw new Error(`Falha ao processar imagem após ${attempt} tentativas: ${error.message}`);
        }
    }

    async transcribeAudio(audioBuffer, attempt = 1) {
        try {
            const formData = new FormData();
            formData.append('file', audioBuffer, 'audio.wav');
            formData.append('model', GROQ_CONFIG.models.audio);
            formData.append('language', GROQ_CONFIG.audioConfig.language);
            formData.append('response_format', GROQ_CONFIG.audioConfig.response_format);
            formData.append('temperature', GROQ_CONFIG.audioConfig.temperature);

            console.log(' Enviando áudio para transcrição:', {
                tamanho: audioBuffer.length,
                modelo: GROQ_CONFIG.models.audio,
                idioma: GROQ_CONFIG.audioConfig.language,
                tentativa: attempt,
                timestamp: new Date().toISOString()
            });

            const response = await this.axios.post(GROQ_CONFIG.audioUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`
                },
                timeout: 30000
            });

            if (response.status !== 200) {
                console.error(` Erro na API Groq (Tentativa ${attempt}):`, response.status, response.data);
                throw new Error(`Erro na API Groq: ${response.status} - ${JSON.stringify(response.data)}`);
            }

            // Log da resposta completa para debug
            console.log(' Resposta da API Groq:', {
                status: response.status,
                headers: response.headers,
                data: JSON.stringify(response.data, null, 2),
                timestamp: new Date().toISOString()
            });

            // Extrai o texto da transcrição com tratamento de diferentes formatos
            let transcription;
            if (typeof response.data === 'string') {
                transcription = response.data;
            } else if (typeof response.data === 'object') {
                if (response.data.text && typeof response.data.text === 'string') {
                    transcription = response.data.text;
                } else if (response.data.transcription && typeof response.data.transcription === 'string') {
                    transcription = response.data.transcription;
                } else {
                    console.error(' Formato de resposta inesperado:', {
                        data: response.data,
                        tipo: typeof response.data,
                        timestamp: new Date().toISOString()
                    });
                    throw new Error('Formato de resposta inesperado da API Groq');
                }
            } else {
                console.error(' Tipo de resposta inesperado:', {
                    tipo: typeof response.data,
                    valor: response.data,
                    timestamp: new Date().toISOString()
                });
                throw new Error(`Tipo de resposta inesperado: ${typeof response.data}`);
            }

            if (!transcription) {
                throw new Error('Transcrição vazia ou nula');
            }

            console.log(' Áudio transcrito com sucesso:', {
                tamanho: transcription.length,
                preview: transcription.substring(0, 100),
                tentativa: attempt,
                timestamp: new Date().toISOString()
            });

            return transcription;
        } catch (error) {
            console.error(` Erro ao transcrever áudio (Tentativa ${attempt}):`, {
                erro: error.message,
                stack: error.stack,
                tentativa: attempt,
                timestamp: new Date().toISOString()
            });
            if (attempt < 3) {
                console.log(` Tentando novamente (${attempt + 1}/3)...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                return this.transcribeAudio(audioBuffer, attempt + 1);
            }
            throw new Error(`Falha ao transcrever áudio após ${attempt} tentativas: ${error.message}`);
        }
    }
}

module.exports = { GroqServices };
