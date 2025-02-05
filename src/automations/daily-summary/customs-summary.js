const axios = require('axios');

class CustomsSummary {
    constructor() {
        const settings = require('../../config/settings');
        const { endpoint, apiKey, paths } = settings.TRACKING_CONFIG;
        const { whatsappNumber } = settings.WHATSAPP_CONFIG;

        this.whatsappNumber = whatsappNumber;
        this.trackingConfig = {
            endpoint,
            apiKey,
            paths
        };

        this.customsKeywords = [
            'customs',
            'taxa',
            'imposto',
            'tributação',
            'alfândega',
            'fiscalização',
            'autoridade competente'
        ];
    }

    async generateDailySummary() {
        try {
            console.log('\n📦 Gerando resumo diário de pacotes...');
            const packagesWithPendingCustoms = await this.getPackagesWithPendingCustoms();
            
            if (packagesWithPendingCustoms.length > 0) {
                const message = this.formatSummaryMessage(packagesWithPendingCustoms);
                await this.sendWhatsAppMessage(message);
                console.log('✅ Resumo diário enviado com sucesso!');
            } else {
                console.log('ℹ️ Nenhum pacote com pendência alfandegária encontrado.');
            }
        } catch (error) {
            console.error('❌ Erro ao gerar resumo diário:', error);
            throw error;
        }
    }

    async getPackagesWithPendingCustoms() {
        try {
            console.log('\n🔍 Buscando pacotes no 17track...');
            const { endpoint, apiKey } = this.trackingConfig;
            
            // Remover http:// ou https:// do endpoint
            const api_url = endpoint.replace('https://', '').replace('http://', '');
            const list_url = `https://${api_url}/track/v2.2/gettracklist`;
            const track_url = `https://${api_url}/track/v2.2/gettrackinfo`;
            
            const headers = {
                '17token': apiKey,
                'Content-Type': 'application/json'
            };

            let allPackages = [];
            let currentPage = 1;
            let hasMorePages = true;

            // Buscar todas as páginas de pacotes
            while (hasMorePages) {
                console.log(`\n📄 Buscando página ${currentPage}...`);
                
                const list_data = {
                    tracking_status: "Tracking",
                    page_no: currentPage,
                    order_by: "RegisterTimeDesc"
                };

                const list_response = await axios.post(list_url, list_data, { headers });
                
                if (list_response.data.code !== 0) {
                    throw new Error(`Erro ao buscar lista: ${list_response.data.message || 'Erro desconhecido'}`);
                }

                if (!list_response.data.data?.accepted) {
                    throw new Error(`Formato de resposta inválido: ${JSON.stringify(list_response.data)}`);
                }

                const packages = list_response.data.data.accepted;
                console.log(`✅ Encontrados ${packages.length} pacotes na página ${currentPage}`);

                // Adiciona os pacotes desta página ao array total
                allPackages = allPackages.concat(packages);

                // Verifica se há mais páginas baseado no número de resultados
                // A API do 17track geralmente retorna 40 resultados por página
                hasMorePages = packages.length === 40; // Se a página está cheia, provavelmente há mais
                currentPage++;

                // Aguarda um pequeno intervalo entre as chamadas para não sobrecarregar a API
                if (hasMorePages) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log(`\n📦 Total de pacotes encontrados: ${allPackages.length}`);

            if (allPackages.length > 0) {
                console.log('\n🔍 Buscando detalhes dos pacotes...');
                console.log(`URL Detalhes: ${track_url}`);

                // Divide os pacotes em lotes de 40 para não sobrecarregar a API
                const batchSize = 40;
                let detailedPackages = [];

                for (let i = 0; i < allPackages.length; i += batchSize) {
                    const batch = allPackages.slice(i, i + batchSize);
                    console.log(`\n📦 Processando lote ${Math.floor(i/batchSize) + 1} de ${Math.ceil(allPackages.length/batchSize)}`);

                    // Preparar lista de pacotes do lote atual
                    const track_data = batch.map(pkg => ({
                        number: pkg.number,
                        carrier: pkg.carrier
                    }));

                    const track_response = await axios.post(track_url, track_data, { headers });

                    if (track_response.data.code !== 0) {
                        throw new Error(`Erro ao buscar detalhes: ${track_response.data.message || 'Erro desconhecido'}`);
                    }

                    if (!track_response.data.data) {
                        throw new Error(`Formato de resposta inválido: ${JSON.stringify(track_response.data)}`);
                    }

                    const batchDetails = track_response.data.data.accepted || [];
                    detailedPackages = detailedPackages.concat(batchDetails);

                    // Aguarda um pequeno intervalo entre os lotes
                    if (i + batchSize < allPackages.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }

                // Filtra apenas os pacotes com pendências
                const packagesWithIssues = detailedPackages.filter(pkg => this.checkTaxation(pkg));
                console.log(`\n🚨 Pacotes com pendências encontrados: ${packagesWithIssues.length}`);
                
                return packagesWithIssues;
            }

            return [];
        } catch (error) {
            console.error('❌ Erro ao buscar pacotes:', error);
            if (error.response) {
                console.error('Status Code:', error.response.status);
                console.error('Resposta:', error.response.data);
            }
            throw error;
        }
    }

    checkTaxation(pkg) {
        try {
            if (!pkg || !pkg.track_info) {
                console.log(`[DEBUG] Pacote inválido ou sem track_info:`, pkg);
                return false;
            }

            const trackInfo = pkg.track_info;
            const latestEvent = trackInfo.latest_event || {};
            const latestStatus = trackInfo.latest_status || {};
            
            const status = (latestStatus.status || '').toLowerCase();
            const eventDescription = (latestEvent.description || '').toLowerCase();
            const trackingNumber = pkg.number || 'N/A';

            console.log(`\n[DEBUG] Verificando pacote: ${trackingNumber}`);
            console.log(`[DEBUG] Status: ${status}`);
            console.log(`[DEBUG] Último evento: ${eventDescription}`);

            // Status que precisam ser incluídos no resumo
            const problemStatuses = ['alert', 'expired', 'undelivered'];
            
            // Verifica status problemáticos
            if (problemStatuses.includes(status)) {
                console.log(`[DEBUG] Status problemático encontrado: ${status}`);
                return true;
            }
                
            // Verifica retenção na alfândega
            if (this.customsKeywords.some(keyword => eventDescription.includes(keyword))) {
                console.log(`[DEBUG] Pacote retido na alfândega: ${eventDescription}`);
                return true;
            }

            return false;
            
        } catch (error) {
            console.error(`[ERRO] Erro ao verificar status:`, error);
            console.log(`[DEBUG] Pacote:`, pkg);
            return false;
        }
    }

    formatSummaryMessage(packages) {
        if (!packages || packages.length === 0) {
            return "Nenhum pacote com pendências.";
        }

        let taxasPendentes = [];
        let emAlerta = [];
        let comProblemas = [];

        packages.forEach(pkg => {
            if (!pkg || !pkg.track_info) return;
                
            const trackInfo = pkg.track_info;
            const latestEvent = trackInfo.latest_event || {};
            const latestStatus = trackInfo.latest_status || {};
            const trackingNumber = pkg.number || 'N/A';
            const status = (latestStatus.status || '').toLowerCase();
            const event = latestEvent.description || '';
            
            // Verifica se está retido na alfândega
            if (this.customsKeywords.some(keyword => event.toLowerCase().includes(keyword))) {
                taxasPendentes.push(`*${trackingNumber}*: ${event}`);
                return;
            }

            // Verifica alertas
            if (status === 'alert') {
                emAlerta.push(`*${trackingNumber}*: ${event}`);
                return;
            }

            // Outros problemas (expired, undelivered)
            if (status === 'expired' || status === 'undelivered') {
                comProblemas.push(`*${trackingNumber}*: ${event}`);
            }
        });

        let message = "📦 *Resumo de Pacotes*\n";
        
        if (taxasPendentes.length > 0) {
            message += "\n💰 *Taxas Pendentes:*\n";
            message += taxasPendentes.join('\n');
        }
        
        if (emAlerta.length > 0) {
            message += "\n⚠️ *Em Alerta:*\n";
            message += emAlerta.join('\n');
        }
        
        if (comProblemas.length > 0) {
            message += "\n❌ *Com Problemas:*\n";
            message += comProblemas.join('\n');
        }
        
        return message;
    }

    async sendWhatsAppMessage(message) {
        try {
            const settings = require('../../config/settings');
            const { apiUrl, token, connectionKey } = settings.WHATSAPP_CONFIG;
            const url = `${apiUrl}/message/send-text?connectionKey=${connectionKey}`;
            
            const data = {
                number: this.whatsappNumber,
                text: message
            };

            const headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };

            await axios.post(url, data, { headers });
            console.log('✅ Mensagem enviada com sucesso!');
        } catch (error) {
            console.error('❌ Erro ao enviar mensagem:', error);
            throw error;
        }
    }

    startScheduler() {
        // Roda todos os dias às 20:00 de Brasília
        const cron = require('node-cron');
        cron.schedule('0 20 * * *', () => {
            console.log('Gerando resumo diário de taxas...');
            this.generateDailySummary();
        }, {
            timezone: "America/Sao_Paulo"
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
