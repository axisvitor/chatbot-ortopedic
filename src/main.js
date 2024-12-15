require('dotenv').config();
const { AIServices } = require('./services/ai-services');
const { WhatsAppService } = require('./services/whatsapp-service');
const { BUSINESS_HOURS } = require('./config/settings');

class ChatbotController {
    constructor() {
        this.aiServices = new AIServices();
        this.whatsappService = new WhatsAppService();
    }

    /**
     * Processa uma mensagem recebida
     * @param {Object} message - Mensagem recebida
     * @returns {Promise<string>} Resposta para o usuário
     */
    async processMessage(message) {
        try {
            console.log('📩 Mensagem recebida:', {
                type: message.type,
                from: message.from,
                hasText: !!message.text,
                hasImage: !!message.imageMessage,
                hasAudio: !!message.audioMessage
            });

            let response = '';

            // Verifica se é uma resposta com o nome do comprador
            if (message.type === 'text') {
                const nameProcessResult = await this.aiServices.processUserName(message.from, message.text);
                if (nameProcessResult) {
                    return; // Resposta já foi enviada pelo processUserName
                }
            }

            // Verifica se precisa de atendimento humano
            if (message.text && await this.aiServices.needsHumanSupport(message.text)) {
                return this.handleHumanSupportRequest(message);
            }

            // Processa com base no tipo de mensagem
            switch (message.type) {
                case 'text':
                    // Se for questão financeira, encaminha para setor
                    if (await this.aiServices.isFinancialIssue(message.text)) {
                        return this.handleFinancialIssue(message);
                    }
                    
                    // Processa com OpenAI
                    response = await this.aiServices.processMessage(message.text);
                    break;

                case 'image':
                    console.log('🖼️ Processando imagem...', {
                        hasUrl: !!message.imageUrl,
                        hasMessageInfo: !!message.imageMessage,
                        mimetype: message.imageMessage?.mimetype
                    });
                    
                    const imageAnalysis = await this.aiServices.processPaymentProof(message.imageUrl, {
                        messageInfo: message.imageMessage,
                        from: message.from
                    });
                    
                    // Não retorna nenhuma resposta, pois o processPaymentProof já cuida disso
                    return '';

                case 'audio':
                    console.log('🎤 Processando áudio...', {
                        hasUrl: !!message.audioUrl,
                        hasMessageInfo: !!message.audioMessage,
                        duration: message.audioMessage?.seconds
                    });

                    // Transcreve o áudio
                    const transcription = await this.aiServices.processAudio(message.audioUrl, {
                        messageInfo: message.audioMessage,
                        from: message.from
                    });

                    // Processa o texto transcrito
                    response = await this.aiServices.processMessage(transcription);
                    break;

                default:
                    response = "Desculpe, não consigo processar este tipo de mensagem. Por favor, envie texto, imagem ou áudio.";
            }

            return response;

        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
            return "Desculpe, ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.";
        }
    }

    /**
     * Trata solicitação de atendimento humano
     * @param {Object} message - Mensagem recebida
     * @returns {string} Resposta para o usuário
     */
    handleHumanSupportRequest(message) {
        // Verifica horário comercial
        if (!this.isBusinessHours()) {
            return BUSINESS_HOURS.autoReply.humanSupportNeeded;
        }

        // Encaminha para atendimento humano
        this.whatsappService.forwardToHumanSupport(message);
        return "Entendi que você precisa falar com um atendente. Estou transferindo seu atendimento para nossa equipe. Em breve alguém entrará em contato.";
    }

    /**
     * Trata questões financeiras
     * @param {Object} message - Mensagem recebida
     * @returns {string} Resposta para o usuário
     */
    handleFinancialIssue(message) {
        // Verifica horário comercial
        if (!this.isBusinessHours()) {
            return BUSINESS_HOURS.autoReply.financialDepartment;
        }

        // Encaminha para setor financeiro
        this.whatsappService.forwardToFinancial(message);
        return "Sua mensagem foi encaminhada para nosso setor financeiro. Em breve entraremos em contato.";
    }

    /**
     * Verifica se é horário comercial
     * @returns {boolean} true se estiver em horário comercial
     */
    isBusinessHours() {
        const now = new Date();
        const day = now.toLocaleDateString('en-US', { weekday: 'lowercase' });
        
        // Verifica se tem horário definido para o dia
        const schedule = BUSINESS_HOURS.schedule[day];
        if (!schedule.start || !schedule.end) {
            return false;
        }

        // Converte horário atual para timezone configurado
        const currentTime = now.toLocaleTimeString('pt-BR', { 
            timeZone: BUSINESS_HOURS.timezone,
            hour12: false 
        });

        // Compara com horário de funcionamento
        return currentTime >= schedule.start && currentTime <= schedule.end;
    }
}

// Exporta a classe
module.exports = { ChatbotController };

// Se executado diretamente, inicia o servidor
if (require.main === module) {
    const server = require('./server');
}
