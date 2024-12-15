const { GroqServices } = require('./groq-services');
const { WhatsAppService } = require('./whatsapp-service');
const { WhatsAppImageService } = require('./whatsapp-image-service');
const { RedisStore } = require('../store/redis-store');
const { BUSINESS_HOURS } = require('../config/settings');

class AIServices {
    constructor() {
        this.groqServices = new GroqServices();
        this.whatsappService = new WhatsAppService();
        this.whatsappImageService = new WhatsAppImageService();
        this.redisStore = new RedisStore();
    }

    /**
     * Processa um comprovante de pagamento
     * @param {string} imageUrl - URL da imagem
     * @param {Object} options - Opções adicionais
     * @returns {Promise<Object>} Informações do pagamento
     */
    async processPaymentProof(imageUrl, { messageInfo, from } = {}) {
        try {
            console.log('[AI] Processando comprovante:', {
                hasUrl: !!imageUrl,
                hasMessageInfo: !!messageInfo,
                from
            });

            // Baixa e processa a imagem
            const imageBuffer = await this.whatsappImageService.downloadImage(imageUrl, messageInfo);
            
            // Análise com Groq
            const imageAnalysis = await this.groqServices.analyzeImage(imageBuffer);

            // Processa o resultado
            const paymentInfo = {
                imageUrl,
                from,
                amount: this.extractAmount(imageAnalysis),
                bank: this.extractBank(imageAnalysis),
                paymentType: this.extractPaymentType(imageAnalysis),
                analysis: imageAnalysis,
                isPaymentProof: this.isPaymentProof(imageAnalysis),
                timestamp: new Date().toISOString()
            };

            // Log das informações extraídas
            console.log('[AI] Informações extraídas:', {
                amount: paymentInfo.amount,
                bank: paymentInfo.bank,
                paymentType: paymentInfo.paymentType,
                isPaymentProof: paymentInfo.isPaymentProof
            });

            // Armazena no Redis se for comprovante
            if (paymentInfo.isPaymentProof) {
                const redisKey = `payment:${paymentInfo.timestamp}:${from}`;
                await this.redisStore.set(redisKey, JSON.stringify(paymentInfo), 86400 * 30);
            }

            return paymentInfo;
        } catch (error) {
            console.error('[AI] Erro ao processar comprovante:', error);
            throw error;
        }
    }

    /**
     * Verifica se o texto indica um comprovante de pagamento
     * @param {string} analysis - Texto da análise
     * @returns {boolean} true se for comprovante
     */
    isPaymentProof(analysis) {
        const keywords = [
            'comprovante',
            'pagamento',
            'transferência',
            'pix',
            'ted',
            'doc',
            'boleto',
            'recibo'
        ];
        
        const lowerAnalysis = analysis.toLowerCase();
        return keywords.some(keyword => lowerAnalysis.includes(keyword.toLowerCase()));
    }

    /**
     * Extrai o valor do pagamento do texto da análise
     * @param {string} analysis - Texto da análise
     * @returns {number|null} Valor do pagamento ou null se não encontrado
     */
    extractAmount(analysis) {
        try {
            const matches = analysis.match(/R\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)/);
            if (matches) {
                const amount = matches[1].replace(/\./g, '').replace(',', '.');
                return parseFloat(amount);
            }
            return null;
        } catch (error) {
            console.error('[AI] Erro ao extrair valor:', error);
            return null;
        }
    }

    /**
     * Extrai o banco do texto da análise
     * @param {string} analysis - Texto da análise
     * @returns {string|null} Nome do banco ou null se não encontrado
     */
    extractBank(analysis) {
        const banks = [
            'Nubank', 'Itaú', 'Bradesco', 'Santander', 'Banco do Brasil',
            'Caixa', 'Inter', 'C6', 'PicPay', 'Mercado Pago'
        ];

        try {
            const lowerAnalysis = analysis.toLowerCase();
            for (const bank of banks) {
                if (lowerAnalysis.includes(bank.toLowerCase())) {
                    return bank;
                }
            }
            return null;
        } catch (error) {
            console.error('[AI] Erro ao extrair banco:', error);
            return null;
        }
    }

    /**
     * Extrai o tipo de pagamento do texto da análise
     * @param {string} analysis - Texto da análise
     * @returns {string|null} Tipo de pagamento ou null se não encontrado
     */
    extractPaymentType(analysis) {
        const types = {
            'pix': ['pix', 'transferência pix', 'pagamento pix'],
            'ted': ['ted', 'transferência ted', 'transferência eletrônica'],
            'doc': ['doc', 'transferência doc'],
            'boleto': ['boleto', 'pagamento de boleto'],
            'débito': ['débito', 'cartão de débito'],
            'crédito': ['crédito', 'cartão de crédito']
        };

        try {
            const lowerAnalysis = analysis.toLowerCase();
            for (const [type, keywords] of Object.entries(types)) {
                if (keywords.some(keyword => lowerAnalysis.includes(keyword))) {
                    return type;
                }
            }
            return null;
        } catch (error) {
            console.error('[AI] Erro ao extrair tipo de pagamento:', error);
            return null;
        }
    }

    /**
     * Processa uma mensagem de texto
     * @param {string} text - Texto da mensagem
     * @returns {Promise<string>} Resposta do processamento
     */
    async processMessage(text) {
        try {
            // TODO: Implementar integração com OpenAI
            return "Desculpe, ainda não posso processar mensagens de texto.";
        } catch (error) {
            console.error('[AI] Erro ao processar mensagem:', error);
            throw error;
        }
    }

    /**
     * Processa um áudio
     * @param {string} audioUrl - URL do áudio
     * @param {Object} options - Opções adicionais
     * @returns {Promise<string>} Texto transcrito
     */
    async processAudio(audioUrl, { messageInfo, from } = {}) {
        try {
            console.log('[AI] Processando áudio:', {
                hasUrl: !!audioUrl,
                hasMessageInfo: !!messageInfo,
                from
            });

            // Processa o áudio com Groq
            const transcription = await this.groqServices.processWhatsAppAudio({
                audioMessage: {
                    ...messageInfo,
                    url: audioUrl
                }
            });

            // Log da transcrição
            console.log('[AI] Áudio transcrito:', {
                length: transcription.length,
                preview: transcription.substring(0, 100) + '...'
            });

            return transcription;
        } catch (error) {
            console.error('[AI] Erro ao processar áudio:', error);
            throw error;
        }
    }

    /**
     * Verifica se uma mensagem precisa de atendimento humano
     * @param {string} message - Mensagem do usuário
     * @returns {Promise<boolean>} true se precisar de atendimento humano
     */
    async needsHumanSupport(message) {
        try {
            const keywords = [
                'falar com atendente',
                'falar com humano',
                'atendimento humano',
                'pessoa real',
                'não quero falar com robô',
                'preciso de ajuda urgente',
                'problema grave',
                'reclamação'
            ];

            const lowerMessage = message.toLowerCase();
            return keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
        } catch (error) {
            console.error('[AI] Erro ao verificar necessidade de suporte:', error);
            return true; // Em caso de erro, melhor encaminhar para humano
        }
    }

    /**
     * Verifica se uma mensagem está relacionada a questões financeiras
     * @param {string} message - Mensagem do usuário
     * @returns {Promise<boolean>} true se for questão financeira
     */
    async isFinancialIssue(message) {
        try {
            const keywords = [
                'pagamento',
                'reembolso',
                'estorno',
                'cobrança',
                'fatura',
                'boleto',
                'cartão',
                'pix',
                'transferência',
                'dinheiro',
                'valor',
                'preço',
                'desconto',
                'promoção'
            ];

            const lowerMessage = message.toLowerCase();
            return keywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
        } catch (error) {
            console.error('[AI] Erro ao verificar questão financeira:', error);
            return false;
        }
    }
}

module.exports = { AIServices };
