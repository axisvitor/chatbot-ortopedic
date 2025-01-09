const { settings } = require('../../config/settings');
const axios = require('axios');
const cron = require('node-cron');

class CustomsSummary {
    constructor() {
        this.whatsappNumber = settings.whatsappNumber;
        this.customsKeywords = [
            // Inglês
            'customs hold',
            'tax payment required',
            'pending clearance',
            'customs inspection',
            'customs fee',
            'import duty',
            // Português
            'retido na alfândega',
            'taxa a pagar',
            'imposto a pagar',
            'tributação pendente',
            'desembaraço pendente',
            'declaração necessária',
            'taxa alfandegária'
        ];
        this.noTaxKeywords = [
            // Inglês
            'clearance complete',
            'customs cleared',
            'released by customs',
            'import cleared',
            // Português
            'desembaraço concluído',
            'liberado pela alfândega',
            'imposto pago',
            'taxa paga'
        ];
        this.customsStatus = [
            'InTransit_CustomsProcessing',
            'Exception_Security',
            'DeliveryFailure_Security',
            'CustomsHold'
        ];
    }

    async sendWhatsAppMessage(message) {
        try {
            const { apiUrl, token, connectionKey } = settings.WHATSAPP_CONFIG;
            const url = `${apiUrl}/message/send-text?connectionKey=${connectionKey}`;
            
            const response = await axios.post(url, {
                phoneNumber: this.whatsappNumber,
                text: message,
                delayMessage: '3'
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.data && response.data.error === false) {
                console.log('Mensagem enviada com sucesso para:', this.whatsappNumber);
                console.log('ID da mensagem:', response.data.messageId);
            } else {
                throw new Error('Falha ao enviar mensagem: ' + JSON.stringify(response.data));
            }
        } catch (error) {
            console.error('Erro ao enviar mensagem WhatsApp:', error);
            throw error;
        }
    }

    checkTaxation(trackingInfo) {
        if (!trackingInfo) return false;

        const status = trackingInfo.package_status || '';
        const latestEvent = (trackingInfo.latest_event_info || '').toLowerCase();

        console.log('[Tracking] Verificando status:', status);
        console.log('[Tracking] Último evento:', latestEvent);

        // Verifica se já foi liberado
        if (this.noTaxKeywords.some(keyword => latestEvent.includes(keyword.toLowerCase()))) {
            console.log('[Tracking] Desembaraço já concluído');
            return false;
        }

        // Verifica status de alfândega
        if (this.customsStatus.includes(status)) {
            console.log('[Tracking] Status indica taxação:', status);
            return true;
        }

        // Verifica palavras-chave de taxação
        for (const keyword of this.customsKeywords) {
            if (latestEvent.includes(keyword.toLowerCase())) {
                console.log('[Tracking] Palavra-chave encontrada:', keyword);
                return true;
            }
        }

        return false;
    }

    async getPackagesWithPendingCustoms() {
        try {
            console.log('[Tracking] Buscando pacotes com taxas pendentes...');
            const { apiUrl, token, paths } = settings.TRACK17_CONFIG;
            let page = 1;
            let totalPages = 1;
            const pendingPackages = [];

            while (page <= totalPages) {
                const response = await axios.post(`https://${apiUrl}${paths.status}`, {
                    tracking_status: "Tracking",
                    page_size: 40,
                    page_no: page
                }, {
                    headers: {
                        '17token': token,
                        'Content-Type': 'application/json'
                    }
                });

                const data = response.data;
                if (!data || data.code !== 0 || !data.data?.accepted) {
                    throw new Error('Resposta inválida da API');
                }

                // Atualiza total de páginas na primeira iteração
                if (page === 1 && data.page) {
                    const totalItems = data.page.data_total || 0;
                    const pageSize = data.page.page_size || 40;
                    totalPages = Math.ceil(totalItems / pageSize);
                    console.log(`[Tracking] Total de ${totalItems} pacotes encontrados em ${totalPages} páginas`);
                }

                // Filtra pacotes com taxa
                for (const item of data.data.accepted) {
                    if (this.checkTaxation(item)) {
                        pendingPackages.push({
                            tracking_number: item.number,
                            status: item.package_status || 'Unknown',
                            latest_event: item.latest_event_info || ''
                        });
                    }
                }

                page++;
            }

            console.log(`[Tracking] Busca concluída. ${pendingPackages.length} pacotes com taxas encontrados`);
            return pendingPackages;

        } catch (error) {
            console.error('[Tracking] Erro ao buscar pacotes:', error);
            throw error;
        }
    }

    async generateDailySummary() {
        try {
            const pendingPackages = await this.getPackagesWithPendingCustoms();
            
            if (!pendingPackages || pendingPackages.length === 0) {
                const noPackagesMessage = "*📦 Resumo Diário - Taxas Pendentes*\n\nNenhum pacote com taxa pendente encontrado.";
                await this.sendWhatsAppMessage(noPackagesMessage);
                return;
            }

            // Formata a mensagem
            let message = "*📦 Resumo Diário - Taxas Pendentes*\n\n";
            for (const package of pendingPackages) {
                message += `*Rastreio:* ${package.tracking_number}\n`;
                message += `*Status:* ${package.status}\n`;
                if (package.latest_event) {
                    message += `*Último evento:* ${package.latest_event}\n`;
                }
                message += "\n";
            }

            await this.sendWhatsAppMessage(message);
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
