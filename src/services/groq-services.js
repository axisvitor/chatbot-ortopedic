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
            formData.append('model', 'whisper-1');
            formData.append('language', 'pt');

            console.log(' Enviando áudio para transcrição:', {
                tamanho: audioBuffer.length,
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

            const transcription = response.data.text;
            console.log(' Áudio transcrito com sucesso:', {
                tamanho: transcription.length,
                preview: transcription.substring(0, 100),
                tentativa: attempt,
                timestamp: new Date().toISOString()
            });

            return transcription;
        } catch (error) {
            console.error(` Erro ao transcrever áudio (Tentativa ${attempt}):`, error.message);
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                return this.transcribeAudio(audioBuffer, attempt + 1);
            }
            throw new Error(`Falha ao transcrever áudio após ${attempt} tentativas: ${error.message}`);
        }
    }
}

module.exports = { GroqServices };
