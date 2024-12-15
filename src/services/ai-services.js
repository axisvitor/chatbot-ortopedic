const { GroqServices } = require('./groq-services');
const { WhatsAppService } = require('./whatsapp-service');
const { RedisStore } = require('../store/redis-store');
const { BUSINESS_HOURS } = require('../config/settings');

class AIServices {
    constructor() {
        this.groqServices = new GroqServices();
        this.whatsappService = new WhatsAppService();
        this.redisStore = new RedisStore();
    }

    /**
     * Processa um comprovante de pagamento
     * @param {string} imageUrl - URL ou dados base64 da imagem
     * @param {Object} customerInfo - Informações do cliente
     * @returns {Promise<Object>} Informações extraídas do comprovante
     */
    async processPaymentProof(imageUrl, customerInfo = {}) {
        try {
            console.log('[AI] Processando comprovante de pagamento:', {
                imageUrl: imageUrl?.substring(0, 50) + '...',
                hasCustomerInfo: !!customerInfo
            });

            // Verifica se a URL é válida
            if (!imageUrl || typeof imageUrl !== 'string') {
                throw new Error('URL da imagem inválida');
            }

            // Análise da imagem usando Groq
            const imageAnalysis = await this.groqServices.analyzeImage(imageUrl);

            // Extrai informações relevantes da análise
            const paymentInfo = {
                imageUrl: imageUrl,
                customerName: customerInfo.name || null,
                customerPhone: customerInfo.phone || null,
                amount: this.extractAmount(imageAnalysis),
                bank: this.extractBank(imageAnalysis),
                paymentType: this.extractPaymentType(imageAnalysis),
                analysis: imageAnalysis,
                timestamp: new Date().toISOString()
            };

            // Log das informações extraídas
            console.log('[AI] Informações extraídas:', {
                amount: paymentInfo.amount,
                bank: paymentInfo.bank,
                paymentType: paymentInfo.paymentType
            });

            // Armazena no Redis para histórico
            const redisKey = `payment:${paymentInfo.timestamp}:${paymentInfo.customerPhone}`;
            await this.redisStore.set(redisKey, JSON.stringify(paymentInfo), 86400 * 30);

            // Notifica o departamento financeiro
            await this.whatsappService.notifyFinancialDepartment(paymentInfo);

            return paymentInfo;
        } catch (error) {
            console.error('[AI] Erro ao processar comprovante:', error);
            throw error;
        }
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
     * Verifica se é horário comercial
     * @returns {boolean} true se estiver em horário comercial
     */
    isBusinessHours() {
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0 = Domingo, 1 = Segunda, ...
        
        // Verifica se é fim de semana
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            return false;
        }

        // Converte para timezone do Brasil
        const brasilTime = now.toLocaleString('en-US', { timeZone: BUSINESS_HOURS.timezone });
        const currentHour = new Date(brasilTime).getHours();

        // Verifica se está dentro do horário comercial
        return currentHour >= 8 && currentHour < 18;
    }

    /**
     * Verifica se uma mensagem precisa de atendimento humano
     * @param {string} message - Mensagem do usuário
     * @returns {Promise<boolean>} true se precisar de atendimento humano
     */
    async needsHumanSupport(message) {
        try {
            // Palavras-chave que indicam necessidade de atendimento humano
            const humanKeywords = [
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
            return humanKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
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
            const financialKeywords = [
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
            return financialKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
        } catch (error) {
            console.error('[AI] Erro ao verificar questão financeira:', error);
            return false;
        }
    }
}

module.exports = { AIServices };
