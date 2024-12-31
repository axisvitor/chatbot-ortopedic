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
     * @returns {Promise<{type: string, description: string}>} Tipo e descrição da imagem
     */
    async analyzeImage(imageUrl) {
        try {
            const response = await this.openai.chat.completions.create({
                model: "ft:gpt-4o-2024-08-06:gest-o-jd::AgY9wrxj",
                messages: [
                    {
                        role: "system",
                        content: "Você é um assistente especializado em analisar imagens para um e-commerce de calçados."
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Identifique o tipo desta imagem:\n" +
                                      "- Se for um comprovante de pagamento (PIX, transferência, etc)\n" +
                                      "- Se for uma foto de calçado\n" + 
                                      "- Se for uma foto de pés para medidas\n" +
                                      "- Se for uma tabela de medidas/numeração\n" +
                                      "- Se for um documento\n" +
                                      "Descreva detalhadamente o que você vê na imagem."
                            },
                            {
                                type: "image_url",
                                image_url: imageUrl
                            }
                        ]
                    }
                ],
                max_tokens: 300
            });

            const analysis = response.choices[0].message.content;
            
            // Categoriza a imagem com base na análise
            const types = {
                payment_proof: /(comprovante|recibo|pagamento|pix|transferência|transacao)/i,
                product_photo: /(calçado|sapato|tênis|tenis|sandália|sandalia|chinelo|bota|sapatilha|tamanco)/i,
                foot_photo: /(pé|pe|pés|pes|calcanhar|dedos|tornozelo|medida)/i,
                size_chart: /(tabela|medida|tamanho|numeração|numeracao)/i,
                document: /(documento|identidade|cpf|rg|carteira)/i
            };

            let imageType = 'other';
            for (const [type, pattern] of Object.entries(types)) {
                if (pattern.test(analysis)) {
                    imageType = type;
                    break;
                }
            }

            return {
                type: imageType,
                description: analysis
            };

        } catch (error) {
            console.error('[ImageProcessing] Erro ao analisar imagem:', error);
            throw error;
        }
    }

    /**
     * Processa uma imagem e retorna informações relevantes
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<{type: string, description: string, orderNumber: string|null, isPaymentProof: boolean}>}
     */
    async processImage(imageUrl) {
        try {
            // Analisa a imagem com Vision
            const { type, description } = await this.analyzeImage(imageUrl);
            
            // Tenta extrair número do pedido
            const orderNumber = await this.extractOrderNumber(imageUrl);
            
            // Verifica se é comprovante
            const isPaymentProof = type === 'payment_proof' || await this.isPaymentProof(imageUrl);

            return {
                type,
                description,
                orderNumber,
                isPaymentProof
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
