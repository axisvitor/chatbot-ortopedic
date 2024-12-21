require('dotenv').config();
const { AIServices } = require('./services/ai-services');
const { WhatsAppService } = require('./services/whatsapp-service');
const { GroqServices } = require('./services/groq-services');
const { MediaManagerService } = require('./services/media-manager-service');
const { BUSINESS_HOURS } = require('./config/settings');

class ChatbotController {
    constructor() {
        this.groqServices = new GroqServices();
        this.aiServices = new AIServices(this.groqServices);
        this.whatsappService = new WhatsAppService();
        this.mediaManager = new MediaManagerService(
            this.aiServices.audioService,
            this.aiServices.imageService
        );
    }

    async processMessage(message) {
        try {
            console.log('📩 Mensagem recebida:', {
                type: message.type,
                from: message.from,
                hasText: !!message.text,
                hasImage: !!message.imageMessage,
                hasAudio: !!message.audioMessage,
                timestamp: new Date().toISOString()
            });

            if (!message || !message.type) {
                console.error('❌ Mensagem inválida:', message);
                return "Desculpe, ocorreu um erro ao processar sua mensagem. Formato inválido.";
            }

            let response = '';

            if (message.type === 'text') {
                const nameProcessResult = await this.aiServices.processUserName(message.from, message.text);
                if (nameProcessResult) {
                    return;
                }
            }

            if (message.text && await this.aiServices.needsHumanSupport(message.text)) {
                return this.handleHumanSupportRequest(message);
            }

            switch (message.type) {
                case 'text':
                    if (await this.aiServices.isFinancialIssue(message.text)) {
                        return this.handleFinancialIssue(message);
                    }
                    const productQuery = await this.aiServices.processProductQuery(message.text);
                    if (productQuery) {
                        return productQuery;
                    }
                    response = await this.aiServices.processMessage(message.text, {
                        from: message.from,
                        messageId: message.messageId,
                        businessHours: this.isBusinessHours()
                    });
                    break;
                case 'image':
                    response = await this.mediaManager.processImage(message);
                    break;
                case 'audio':
                    response = await this.mediaManager.processAudio(message);
                    break;
                default:
                    response = "Desculpe, não entendi o tipo da sua mensagem.";
            }

            return response;

        } catch (error) {
            console.error('❌ Erro ao processar mensagem:', error);
            if (error.message === 'MEDIA_ERROR') {
                return "Desculpe, ocorreu um erro ao processar sua mídia. Por favor, tente novamente.";
            } else if (error.message === 'TIMEOUT_ERROR') {
                return "Desculpe, a operação demorou muito para ser concluída. Por favor, tente novamente.";
            } else if (error.message === 'AI_SERVICE_ERROR') {
                return "Desculpe, ocorreu um erro no serviço de inteligência artificial. Por favor, tente novamente.";
            } else {
                return "Desculpe, ocorreu um erro inesperado ao processar sua mensagem.";
            }
        }
    }

    handleHumanSupportRequest(message) {
        if (!this.isBusinessHours()) {
            return BUSINESS_HOURS.messages.outOfHours;
        }

        this.whatsappService.forwardToHumanSupport(message);
        return "Entendi que você precisa falar com um atendente. Estou transferindo seu atendimento para nossa equipe. Em breve alguém entrará em contato.";
    }

    handleFinancialIssue(message) {
        if (!this.isBusinessHours()) {
            return BUSINESS_HOURS.messages.outOfHours;
        }

        this.whatsappService.forwardToFinancial(message);
        return "Sua mensagem foi encaminhada para nosso setor financeiro. Em breve entraremos em contato.";
    }

    isBusinessHours() {
        const now = new Date();
        const day = now.toLocaleDateString('en-US', { weekday: 'lowercase' });
        
        const schedule = BUSINESS_HOURS.schedule[day];
        if (!schedule.start || !schedule.end) {
            return false;
        }

        const currentTime = now.toLocaleTimeString('pt-BR', { 
            timeZone: BUSINESS_HOURS.timezone,
            hour12: false 
        });

        return currentTime >= schedule.start && currentTime <= schedule.end;
    }
}

module.exports = { ChatbotController };

if (require.main === module) {
    const server = require('./server');
    server.start();
}
