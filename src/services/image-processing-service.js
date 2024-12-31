const { createWorker } = require('tesseract.js');
const axios = require('axios');
const OpenAI = require('openai');
const { OPENAI_CONFIG } = require('../config/settings');

class ImageProcessingService {
    constructor() {
        this.worker = null;
        this.openai = new OpenAI({
            apiKey: OPENAI_CONFIG.apiKey
        });
    }

    async initialize() {
        if (!this.worker) {
            this.worker = await createWorker('por');
            await this.worker.loadLanguage('por');
            await this.worker.initialize('por');
        }
    }

    /**
     * Extrai texto de uma imagem
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<string>} Texto extraído
     */
    async extractTextFromImage(imageUrl) {
        try {
            await this.initialize();
            
            // Baixa a imagem
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);

            // Processa a imagem com Tesseract
            const { data: { text } } = await this.worker.recognize(buffer);
            
            return text;
        } catch (error) {
            console.error('[ImageProcessing] Erro ao extrair texto da imagem:', error);
            throw error;
        }
    }

    /**
     * Extrai número do pedido de uma imagem
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<string|null>} Número do pedido ou null se não encontrado
     */
    async extractOrderNumber(imageUrl) {
        try {
            const text = await this.extractTextFromImage(imageUrl);
            
            // Procura por padrões comuns de número de pedido
            const patterns = [
                /pedido\s+(\d{4,})/i,           // "pedido 1234"
                /pedido\s+número\s+(\d{4,})/i,  // "pedido número 1234"
                /pedido\s+#?(\d{4,})/i,         // "pedido #1234"
                /número\s+(\d{4,})/i,           // "número 1234"
                /[#]?(\d{4,})/                  // apenas dígitos ou #1234
            ];

            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }

            console.log('[ImageProcessing] Texto extraído mas número não encontrado:', text);
            return null;
        } catch (error) {
            console.error('[ImageProcessing] Erro ao extrair número do pedido:', error);
            return null;
        }
    }

    /**
     * Verifica se uma imagem parece ser um comprovante de pagamento
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<boolean>} True se parece ser um comprovante
     */
    async isPaymentProof(imageUrl) {
        try {
            const text = await this.extractTextFromImage(imageUrl);
            
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
            const matches = keywords.filter(keyword => keyword.test(text)).length;
            
            // Se encontrou pelo menos 3 palavras-chave, considera como comprovante
            return matches >= 3;

        } catch (error) {
            console.error('[ImageProcessing] Erro ao verificar comprovante:', error);
            return false;
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

            // Em seguida, vamos usar o GPT-4 Vision para análise visual
            const response = await this.openai.chat.completions.create({
                model: "gpt-4-vision-preview",
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

    async terminate() {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}

module.exports = { ImageProcessingService };
