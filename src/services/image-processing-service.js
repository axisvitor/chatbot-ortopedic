const axios = require('axios');
const OpenAI = require('openai');
const { OPENAI_CONFIG, GROQ_CONFIG } = require('../config/settings');

class ImageProcessingService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: GROQ_CONFIG.apiKey,
            baseURL: GROQ_CONFIG.baseUrl
        });
    }

    /**
     * Extrai texto de uma imagem usando Groq Vision
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<string>} Texto extraído e análise da imagem
     */
    async extractTextFromImage(imageUrl) {
        try {
            console.log('[ImageProcessing] Iniciando extração de texto com Groq Vision:', {
                url: imageUrl.substring(0, 50) + '...'
            });
            
            // Baixa a imagem
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);
            const base64Image = buffer.toString('base64');

            // Analisa a imagem com Groq Vision
            const completion = await this.openai.chat.completions.create({
                model: "mixtral-8x7b-32768",
                messages: [
                    {
                        role: "system",
                        content: "Você é um assistente especializado em analisar imagens. Extraia todo o texto visível da imagem e forneça uma descrição detalhada do que você vê. Se for um comprovante de pagamento, extraia informações relevantes como valor, data e tipo de transação."
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Por favor, analise esta imagem em detalhes, extraindo todo o texto visível e descrevendo o que você vê."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1024,
                temperature: 0.2
            });

            const analysis = completion.choices[0]?.message?.content;
            
            if (!analysis) {
                throw new Error('Análise da imagem retornou vazia');
            }

            console.log('[ImageProcessing] Análise concluída com sucesso');
            return analysis;

        } catch (error) {
            console.error('[ImageProcessing] Erro ao extrair texto da imagem:', error);
            throw error;
        }
    }

    /**
     * Verifica se uma imagem é um comprovante de pagamento
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<boolean>} true se for um comprovante
     */
    async isPaymentProof(imageUrl) {
        try {
            const analysis = await this.extractTextFromImage(imageUrl);
            
            // Lista de palavras-chave comuns em comprovantes
            const keywords = [
                /comprovante/i,
                /pagamento/i,
                /transferência/i,
                /transferencia/i,
                /pix/i,
                /valor/i,
                /recibo/i,
                /transação/i,
                /transacao/i,
                /banco/i,
                /r\$\s*[\d,.]+/i, // Valor em reais
                /data\s+\d{2}\/\d{2}\/\d{4}/i, // Data no formato DD/MM/YYYY
            ];

            // Conta quantas palavras-chave foram encontradas
            const matches = keywords.filter(keyword => keyword.test(analysis)).length;
            
            // Se encontrou pelo menos 3 palavras-chave, considera como comprovante
            return matches >= 3;

        } catch (error) {
            console.error('[ImageProcessing] Erro ao verificar comprovante:', error);
            return false;
        }
    }

    /**
     * Extrai número do pedido de uma imagem
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<string|null>} Número do pedido ou null se não encontrado
     */
    async extractOrderNumber(imageUrl) {
        try {
            const analysis = await this.extractTextFromImage(imageUrl);
            
            // Procura por padrões de número de pedido
            const patterns = [
                /pedido[:\s]+#?(\d+)/i,
                /ordem[:\s]+#?(\d+)/i,
                /order[:\s]+#?(\d+)/i,
                /#(\d{4,})/
            ];

            for (const pattern of patterns) {
                const match = analysis.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }

            return null;
        } catch (error) {
            console.error('[ImageProcessing] Erro ao extrair número do pedido:', error);
            return null;
        }
    }

    /**
     * Analisa uma imagem usando modelo fine-tuned com visão
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<{type: string, description: string, extractedText: string, paymentInfo: {amount: string|null, date: string|null, transactionId: string|null}}>}
     */
    async analyzeImage(imageUrl) {
        try {
            // Primeiro, vamos usar o OCR para extrair texto
            const extractedText = await this.extractTextFromImage(imageUrl);

            // Em seguida, vamos usar o Groq Vision para análise visual
            const response = await this.openai.chat.completions.create({
                model: GROQ_CONFIG.models.vision,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Analise esta imagem e me diga o tipo dela. Pode ser:\n" +
                                    "1. Comprovante de pagamento (PIX, transferência, etc)\n" +
                                    "2. Foto de calçado\n" +
                                    "3. Foto de pés para medidas\n" +
                                    "4. Tabela de medidas/numeração\n" +
                                    "5. Documento\n\n" +
                                    "Texto extraído via OCR: " + extractedText
                            },
                            {
                                type: "image_url",
                                image_url: imageUrl,
                            }
                        ]
                    }
                ],
                max_tokens: 1000
            });

            const analysis = response.choices[0].message.content;

            // Classificação da imagem baseada na análise do GPT e no texto OCR
            let imageType = 'unknown';
            let details = {
                type: 'unknown',
                description: analysis,
                extractedText: extractedText
            };

            // Classificação baseada em palavras-chave do OCR e análise do GPT
            if (
                /comprovante|pagamento|transferência|pix|recibo/i.test(extractedText) ||
                /comprovante|pagamento|transferência|pix|recibo/i.test(analysis)
            ) {
                details.type = 'payment_proof';
                // Extrair informações específicas do comprovante
                details.paymentInfo = {
                    amount: this.extractAmount(extractedText),
                    date: this.extractDate(extractedText),
                    transactionId: this.extractTransactionId(extractedText)
                };
            } else if (
                /calçado|sapato|tênis|chinelo/i.test(analysis)
            ) {
                details.type = 'product_photo';
            } else if (
                /medida.*p[ée]|p[ée].*medida/i.test(analysis)
            ) {
                details.type = 'foot_measurement';
            } else if (
                /tabela|numeração|tamanho/i.test(analysis)
            ) {
                details.type = 'size_chart';
            } else if (
                /documento|rg|cpf|identidade/i.test(analysis)
            ) {
                details.type = 'document';
            }

            return details;
        } catch (error) {
            console.error('[ImageProcessing] Erro ao analisar imagem:', error);
            throw error;
        }
    }

    extractAmount(text) {
        const match = text.match(/R\$\s*([\d,.]+)/i);
        return match ? match[1] : null;
    }

    extractDate(text) {
        const match = text.match(/\d{2}\/\d{2}\/\d{4}/);
        return match ? match[0] : null;
    }

    extractTransactionId(text) {
        const match = text.match(/ID:?\s*([A-Za-z0-9]+)/i) || 
                     text.match(/Transação:?\s*([A-Za-z0-9]+)/i);
        return match ? match[1] : null;
    }

    /**
     * Processa uma imagem e retorna informações relevantes
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<{type: string, description: string, orderNumber: string|null, isPaymentProof: boolean}>}
     */
    async processImage(imageUrl) {
        try {
            // Analisa a imagem com Vision
            const { type, description, extractedText, paymentInfo } = await this.analyzeImage(imageUrl);
            
            // Tenta extrair número do pedido
            const orderNumber = await this.extractOrderNumber(imageUrl);
            
            // Verifica se é comprovante
            const isPaymentProof = type === 'payment_proof' || await this.isPaymentProof(imageUrl);

            return {
                type,
                description,
                orderNumber,
                isPaymentProof,
                paymentInfo
            };

        } catch (error) {
            console.error('[ImageProcessing] Erro ao processar imagem:', error);
            throw error;
        }
    }
}

module.exports = { ImageProcessingService };
