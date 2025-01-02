const axios = require('axios');
const FormData = require('form-data');
const { detectImageFormatFromBuffer } = require('../utils/image-format');
const { GROQ_CONFIG } = require('../config/settings');

class GroqServices {
    constructor() {
        this.axios = axios.create({
            timeout: 30000,
        });

        this.chat = {
            completions: {
                create: async (params) => {
                    try {
                        const response = await axios.post(
                            'https://api.groq.com/openai/v1/chat/completions',
                            params,
                            {
                                headers: {
                                    'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`,
                                    'Content-Type': 'application/json'
                                }
                            }
                        );
                        return response.data;
                    } catch (error) {
                        console.error('❌ Erro na chamada à API da Groq:', {
                            erro: error.message,
                            status: error.response?.status,
                            data: error.response?.data
                        });
                        throw error;
                    }
                }
            }
        };

        this.vision = new GroqVisionService({
            apiKey: GROQ_CONFIG.apiKey,
            baseUrl: 'https://api.groq.com/v1'
        });
    }

    async generateText(messages, options = {}) {
        try {
            const response = await this.chat.completions.create({
                model: options.model || 'mixtral-8x7b-32768',
                messages: messages,
                temperature: options.temperature || 0.7,
                max_tokens: options.max_tokens || 1024,
                stream: false
            });

            return response.choices[0].message.content;
        } catch (error) {
            console.error('❌ Erro ao gerar texto:', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
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

    async processImage(buffer, message, attempt = 1) {
        try {
            // Detecta o formato da imagem
            const imageFormat = await detectImageFormatFromBuffer(buffer);
            if (!imageFormat) {
                throw new Error('Formato de imagem não suportado');
            }

            // Converte o buffer para base64
            const base64Image = buffer.toString('base64');

            // Verifica o tamanho do payload base64
            const base64Size = base64Image.length * 0.75; // Tamanho aproximado em bytes
            if (base64Size > 4 * 1024 * 1024) { // 4MB limite
                throw new Error('Imagem muito grande. Máximo permitido: 4MB');
            }

            // Monta o payload no formato correto do Groq Vision
            const payload = {
                model: GROQ_CONFIG.models.vision,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: 'Analise esta imagem em detalhes. Determine:\n' +
                                    '1. O tipo da imagem (comprovante de pagamento, foto de calçado, foto de pés para medidas, tabela de medidas/numeração)\n' +
                                    '2. Uma descrição detalhada do que você vê\n' +
                                    '3. Se for um comprovante de pagamento, extraia: valor, data e ID da transação\n' +
                                    (message?.extractedText ? `\nTexto extraído via OCR: ${message.extractedText}` : '')
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${imageFormat};base64,${base64Image}`,
                                    detail: "high"
                                }
                            }
                        ]
                    }
                ],
                temperature: 0.2,
                max_tokens: 1024,
                top_p: 0.2,
                stream: false,
                response_format: { "type": "json_object" }
            };

            console.log('📤 Enviando imagem para análise:', {
                imageFormat,
                base64Size: Math.round(base64Size / 1024) + 'KB',
                hasOCR: !!message?.extractedText,
                timestamp: new Date().toISOString()
            });

            const response = await this.axios.post(GROQ_CONFIG.visionUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`
                },
                timeout: 30000
            });

            if (response.status !== 200) {
                console.error(`❌ Erro na API Groq (Tentativa ${attempt}):`, {
                    status: response.status,
                    data: response.data,
                    timestamp: new Date().toISOString()
                });
                throw new Error(`Erro na API Groq: ${response.status} - ${JSON.stringify(response.data)}`);
            }

            // Processa a resposta
            const content = response.data.choices[0].message.content;
            
            console.log('✅ Análise concluída:', {
                responseLength: content.length,
                timestamp: new Date().toISOString()
            });

            return JSON.parse(content); // Agora retorna um objeto JSON estruturado

        } catch (error) {
            console.error(`❌ Erro ao processar imagem (Tentativa ${attempt}):`, {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            // Tenta novamente se não excedeu o número máximo de tentativas
            if (attempt < 3) {
                console.log(`🔄 Tentando novamente (${attempt + 1}/3)...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                return this.processImage(buffer, message, attempt + 1);
            }

            throw error;
        }
    }

    async analyzeImageWithVision(base64Image, options = {}) {
        try {
            return await this.vision.analyzeImage(base64Image, options);
        } catch (error) {
            console.error(`❌ Erro ao analisar imagem com Groq Vision:`, error.message);
            throw error;
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

            // URL correta da API Groq
            const transcriptionUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';

            console.log('🎯 Enviando áudio para transcrição:', {
                url: transcriptionUrl,
                tamanho: audioBuffer.length,
                modelo: GROQ_CONFIG.models.audio,
                idioma: GROQ_CONFIG.audioConfig.language,
                tentativa: attempt,
                timestamp: new Date().toISOString()
            });

            const response = await this.axios.post(transcriptionUrl, formData, {
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

            // Log da resposta completa para debug
            console.log('🔍 Resposta da API Groq:', {
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
                    console.error('❌ Formato de resposta inesperado:', {
                        data: response.data,
                        tipo: typeof response.data,
                        timestamp: new Date().toISOString()
                    });
                    throw new Error('Formato de resposta inesperado da API Groq');
                }
            } else {
                console.error('❌ Tipo de resposta inesperado:', {
                    tipo: typeof response.data,
                    valor: response.data,
                    timestamp: new Date().toISOString()
                });
                throw new Error(`Tipo de resposta inesperado: ${typeof response.data}`);
            }

            if (!transcription) {
                throw new Error('Transcrição vazia ou nula');
            }

            console.log('✅ Áudio transcrito com sucesso:', {
                tamanho: transcription.length,
                preview: transcription.substring(0, 100),
                tentativa: attempt,
                timestamp: new Date().toISOString()
            });

            return transcription;
        } catch (error) {
            console.error(`❌ Erro ao transcrever áudio (Tentativa ${attempt}):`, {
                erro: error.message,
                stack: error.stack,
                tentativa: attempt,
                timestamp: new Date().toISOString()
            });
            if (attempt < 3) {
                console.log(`🔄 Tentando novamente (${attempt + 1}/3)...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                return this.transcribeAudio(audioBuffer, attempt + 1);
            }
            throw new Error(`Falha ao transcrever áudio após ${attempt} tentativas: ${error.message}`);
        }
    }
}

class GroqVisionService {
    constructor(config) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl || 'https://api.groq.com/v1';
    }

    async analyzeImage(base64Image, options = {}) {
        try {
            console.log('🔍 Iniciando análise com Groq Vision...', {
                temCaption: !!options.caption,
                mimetype: options.mimetype
            });

            // Prepara o prompt para a análise
            const prompt = this.buildAnalysisPrompt(options.caption);

            // Prepara os dados para envio
            const formData = new FormData();
            formData.append('image', Buffer.from(base64Image, 'base64'), {
                filename: 'image.jpg',
                contentType: options.mimetype || 'image/jpeg'
            });
            formData.append('prompt', prompt);

            // Configura a requisição
            const config = {
                method: 'post',
                url: `${this.baseUrl}/vision/analyze`,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    ...formData.getHeaders()
                },
                data: formData
            };

            console.log('📤 Enviando requisição para Groq Vision...');
            const response = await axios(config);

            // Valida a resposta
            if (!response.data || !response.data.analysis) {
                throw new Error('Resposta inválida da API Groq Vision');
            }

            console.log('✅ Análise concluída com sucesso:', {
                statusCode: response.status,
                tamanhoResposta: JSON.stringify(response.data).length
            });

            return response.data.analysis;

        } catch (error) {
            console.error('❌ Erro na análise com Groq Vision:', {
                erro: error.message,
                stack: error.stack,
                status: error.response?.status,
                resposta: error.response?.data
            });
            throw error;
        }
    }

    buildAnalysisPrompt(caption) {
        return `
            Analise esta imagem em detalhes. Se for um comprovante de pagamento, extraia as seguintes informações:
            - Valor da transação
            - Data da transação
            - Tipo de transação (PIX, transferência, boleto, etc)
            - Status do pagamento
            - Informações adicionais relevantes

            Contexto adicional da imagem: ${caption || 'Nenhum'}

            Por favor, forneça uma análise detalhada e estruturada.
        `.trim();
    }
}

module.exports = { GroqServices };
