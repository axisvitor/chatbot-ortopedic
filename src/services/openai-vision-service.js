const axios = require('axios');
const { OPENAI_CONFIG } = require('../config/settings');
const { detectImageFormatFromBuffer } = require('../utils/image-format');

class OpenAIVisionService {
    constructor() {
        this.axios = axios.create({
            baseURL: OPENAI_CONFIG.baseUrl,
            headers: {
                'Authorization': `Bearer ${OPENAI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
    }

    /**
     * Processa uma imagem e retorna a análise
     * @param {Buffer} buffer Buffer da imagem
     * @param {Object} message Mensagem com informações adicionais
     * @param {number} attempt Número da tentativa (para retry)
     * @returns {Promise<Object>} Resultado da análise
     */
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
            if (base64Size > 20 * 1024 * 1024) { // 20MB limite OpenAI
                throw new Error('Imagem muito grande. Máximo permitido: 20MB');
            }

            // Monta o payload para a OpenAI Vision
            const payload = {
                model: OPENAI_CONFIG.models.vision,
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
                                    detail: OPENAI_CONFIG.visionConfig.detail
                                }
                            }
                        ]
                    }
                ],
                ...OPENAI_CONFIG.visionConfig
            };

            console.log('📤 Enviando imagem para análise:', {
                imageFormat,
                base64Size: Math.round(base64Size / 1024) + 'KB',
                hasOCR: !!message?.extractedText,
                timestamp: new Date().toISOString()
            });

            const response = await this.axios.post('/chat/completions', payload);

            if (response.status !== 200) {
                console.error(`❌ Erro na API OpenAI (Tentativa ${attempt}):`, {
                    status: response.status,
                    data: response.data,
                    timestamp: new Date().toISOString()
                });
                throw new Error(`Erro na API OpenAI: ${response.status} - ${JSON.stringify(response.data)}`);
            }

            // Processa a resposta
            const content = response.data.choices[0].message.content;
            
            console.log('✅ Análise concluída:', {
                responseLength: content.length,
                timestamp: new Date().toISOString()
            });

            return JSON.parse(content);

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

    /**
     * Analisa uma imagem usando base64
     * @param {string} base64Image Imagem em base64
     * @param {Object} options Opções adicionais
     * @returns {Promise<Object>} Resultado da análise
     */
    async analyzeImage(base64Image, options = {}) {
        try {
            console.log('🔍 Iniciando análise com OpenAI Vision...', {
                temCaption: !!options.caption,
                mimetype: options.mimetype
            });

            // Prepara o prompt para a análise
            const prompt = this.buildAnalysisPrompt(options.caption);

            const payload = {
                model: OPENAI_CONFIG.models.vision,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: prompt
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${options.mimetype || 'image/jpeg'};base64,${base64Image}`,
                                    detail: OPENAI_CONFIG.visionConfig.detail
                                }
                            }
                        ]
                    }
                ],
                ...OPENAI_CONFIG.visionConfig
            };

            console.log('📤 Enviando requisição para OpenAI Vision...');
            const response = await this.axios.post('/chat/completions', payload);

            if (!response.data?.choices?.[0]?.message?.content) {
                throw new Error('Resposta inválida da API OpenAI Vision');
            }

            console.log('✅ Análise concluída com sucesso:', {
                statusCode: response.status,
                tamanhoResposta: JSON.stringify(response.data).length
            });

            return JSON.parse(response.data.choices[0].message.content);

        } catch (error) {
            console.error('❌ Erro na análise com OpenAI Vision:', {
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

module.exports = { OpenAIVisionService }; 