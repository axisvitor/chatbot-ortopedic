const { trackingService } = require('../../services');
const { settings } = require('../../config/settings');
const axios = require('axios');
const cron = require('node-cron');

class CustomsSummary {
    constructor() {
        this.whatsappNumber = settings.whatsappNumber;
    }

    async sendWhatsAppMessage(message) {
        try {
            const { apiUrl, token, connectionKey, endpoints } = settings.WHATSAPP_CONFIG;
            const endpoint = endpoints.text;
            
            const response = await axios.post(`${apiUrl}/${endpoint.path}`, {
                to: this.whatsappNumber,
                content: message,
                delay: settings.WHATSAPP_CONFIG.messageDelay
            }, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Connection-Key': connectionKey
                }
            });

            if (response.data && response.data.success) {
                console.log('Mensagem enviada com sucesso para:', this.whatsappNumber);
            } else {
                throw new Error('Falha ao enviar mensagem: ' + JSON.stringify(response.data));
            }
        } catch (error) {
            console.error('Erro ao enviar mensagem WhatsApp:', error);
            throw error;
        }
    }

    async generateDailySummary() {
        try {
            // Busca direto do 17track
            const pendingPackages = await trackingService.getPackagesWithPendingCustoms();
            
            if (!pendingPackages || pendingPackages.length === 0) {
                const noPackagesMessage = `📦 Resumo Diário de Taxas Pendentes\n\nNenhum pacote aguardando pagamento de taxa na alfândega.`;
                await this.sendWhatsAppMessage(noPackagesMessage);
                return;
            }

            const trackingCodes = pendingPackages.map(pkg => pkg.trackingNumber);
            const totalPackages = trackingCodes.length;

            // Cria mensagem simplificada
            const summaryMessage = `📦 Resumo Diário de Taxas Pendentes\n\n` +
                `Total de pacotes aguardando pagamento: ${totalPackages}\n\n` +
                `Códigos de rastreamento:\n${trackingCodes.join('\n')}`;

            // Envia mensagem
            await this.sendWhatsAppMessage(summaryMessage);
            console.log('Resumo diário enviado com sucesso');
        } catch (error) {
            console.error('Erro ao gerar resumo diário:', error);
            const errorMessage = `⚠️ Erro ao gerar resumo diário de taxas pendentes. Por favor, verifique o sistema.`;
            await this.sendWhatsAppMessage(errorMessage);
        }
    }

    startScheduler() {
        // Roda todos os dias às 20:00
        cron.schedule('0 20 * * *', () => {
            console.log('Gerando resumo diário de taxas...');
            this.generateDailySummary();
        });
        
        console.log('Agendador de resumo diário iniciado');
    }

    // Método para testes
    async test() {
        console.log('Iniciando teste do resumo diário...');
        await this.generateDailySummary();
        console.log('Teste concluído!');
    }
}

// Exporta a instância
const customsSummary = new CustomsSummary();
module.exports = customsSummary;
