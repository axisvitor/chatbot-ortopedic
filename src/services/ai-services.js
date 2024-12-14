'use strict';

const { OpenAI } = require('openai');
const { OPENAI_CONFIG } = require('../config/settings');

class AIServices {
    constructor(trackingService, whatsappService, groqServices, redisStore) {
        this.openai = new OpenAI({ apiKey: OPENAI_CONFIG.apiKey });
        this.trackingService = trackingService;
        this.whatsappService = whatsappService;
        this.groqServices = groqServices;
        this.redisStore = redisStore;
        this.assistantId = OPENAI_CONFIG.assistantId;
    }

    async createThread() {
        return await this.openai.beta.threads.create();
    }

    async processMessage(message, context = {}) {
        try {
            if (!message || message.trim() === '') {
                throw new Error('Mensagem vazia ou inválida');
            }

            if (!this.assistantId) {
                throw new Error('Assistant ID não configurado');
            }

            // Tenta recuperar o threadId do Redis
            let threadId = await this.redisStore.get(`thread:${context.phone}`);
            
            // Cria um novo thread se não existir
            if (!threadId) {
                const thread = await this.createThread();
                threadId = thread.id;
                await this.redisStore.set(`thread:${context.phone}`, threadId);
            }

            // Adiciona a mensagem ao thread
            await this.openai.beta.threads.messages.create(threadId, {
                role: "user",
                content: message
            });

            // Executa o assistant
            const run = await this.openai.beta.threads.runs.create(threadId, {
                assistant_id: this.assistantId
            });

            // Aguarda a conclusão
            let runStatus = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
            while (runStatus.status !== 'completed') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                runStatus = await this.openai.beta.threads.runs.retrieve(threadId, run.id);
                
                if (runStatus.status === 'requires_action') {
                    // Processa funções chamadas pelo assistant
                    const actions = runStatus.required_action.submit_tool_outputs.tool_calls;
                    const toolOutputs = [];
                    
                    for (const action of actions) {
                        if (action.function.name === 'checkOrderStatus') {
                            const { trackingNumber, cpf } = JSON.parse(action.function.arguments);
                            const status = await this.checkOrderStatus(trackingNumber, cpf);
                            toolOutputs.push({
                                tool_call_id: action.id,
                                output: JSON.stringify(status)
                            });
                        }
                    }

                    if (toolOutputs.length > 0) {
                        await this.openai.beta.threads.runs.submitToolOutputs(threadId, run.id, {
                            tool_outputs: toolOutputs
                        });
                    }
                }
                
                if (runStatus.status === 'failed') {
                    throw new Error(`Assistant run failed: ${runStatus.last_error?.message || 'Unknown error'}`);
                }
            }

            // Obtém as mensagens
            const messages = await this.openai.beta.threads.messages.list(threadId);
            const lastMessage = messages.data[0];

            if (!lastMessage || !lastMessage.content || !lastMessage.content[0]) {
                throw new Error('Resposta do Assistant inválida');
            }

            return lastMessage.content[0].text.value;
        } catch (error) {
            console.error('Error processing message:', error);
            throw error;
        }
    }

    async checkOrderStatus(trackingNumber, cpf) {
        try {
            const trackingInfo = await this.trackingService.processTrackingRequest(trackingNumber, cpf);
            return trackingInfo;
        } catch (error) {
            console.error('Error checking order status:', error);
            throw error;
        }
    }

    async processAudio(messageData) {
        try {
            console.log('🎙️ Iniciando processamento de áudio...');
            const transcription = await this.groqServices.processWhatsAppAudio(messageData);
            console.log('✅ Áudio processado com sucesso:', transcription);
            return transcription;
        } catch (error) {
            console.error('❌ Erro no processamento de áudio:', error);
            
            // Mensagens de erro personalizadas
            if (error.message.includes('Dados insuficientes')) {
                return "Desculpe, não consegui acessar o áudio. Por favor, tente enviar novamente ou digite sua mensagem.";
            }
            if (error.message.includes('formato')) {
                return "Este formato de áudio não é suportado. Por favor, tente gravar novamente.";
            }
            if (error.message.includes('muito grande')) {
                return "O áudio é muito longo. Por favor, tente uma mensagem mais curta.";
            }
            
            return "Sinto muito, estou tendo dificuldades para processar áudios no momento. Por favor, tente digitar sua mensagem.";
        }
    }

    async processPaymentProof(imageUrl, customerInfo = {}) {
        try {
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

            // Armazena no Redis para histórico
            await this.redisStore.set(
                `payment:${paymentInfo.timestamp}:${paymentInfo.customerPhone}`,
                paymentInfo,
                86400 * 30 // 30 dias
            );

            // Notifica o departamento financeiro
            await this.whatsappService.notifyFinancialDepartment(paymentInfo);

            return paymentInfo;
        } catch (error) {
            console.error('Error processing payment proof:', error);
            throw error;
        }
    }

    extractAmount(analysis) {
        const amountRegex = /R\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)/;
        const match = analysis.match(amountRegex);
        return match ? match[0] : null;
    }

    extractBank(analysis) {
        const banks = [
            'Banco do Brasil', 'Bradesco', 'Itaú', 'Santander', 'Caixa',
            'Nubank', 'Inter', 'C6', 'PicPay', 'Mercado Pago'
        ];

        for (const bank of banks) {
            if (analysis.toLowerCase().includes(bank.toLowerCase())) {
                return bank;
            }
        }
        return null;
    }

    extractPaymentType(analysis) {
        const types = {
            'pix': 'PIX',
            'transferência': 'Transferência',
            'ted': 'TED',
            'doc': 'DOC',
            'boleto': 'Boleto'
        };

        for (const [key, value] of Object.entries(types)) {
            if (analysis.toLowerCase().includes(key)) {
                return value;
            }
        }
        return null;
    }
}

module.exports = { AIServices };
