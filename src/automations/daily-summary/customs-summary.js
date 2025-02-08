import axios from 'axios';

class Logger {
    debug(msg, ...args) {
        console.debug(`[DEBUG] ${msg}`, ...args);
    }
    info(msg, ...args) {
        console.info(`[INFO] ${msg}`, ...args);
    }
    error(msg, ...args) {
        console.error(`[ERROR] ${msg}`, ...args);
    }
}

export class CustomsSummary {
    constructor(config, httpClient = axios, logger = new Logger()) {
        this.validateConfig(config);
        
        const { endpoint, apiKey, whatsappNumber } = config;
        
        this.whatsappNumber = whatsappNumber;
        this.trackingConfig = {
            endpoint,
            apiKey
        };
        
        this.httpClient = httpClient;
        this.logger = logger;

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

    validateConfig(config) {
        const required = ['endpoint', 'apiKey', 'whatsappNumber'];
        const missing = required.filter(key => !config[key]);
        if (missing.length > 0) {
            throw new Error(`Missing required config: ${missing.join(', ')}`);
        }
    }

    async makeRequest(fn, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error) {
                if (i === retries - 1) throw error;
                const delay = 1000 * Math.pow(2, i);
                this.logger.info(`Retry ${i + 1}/${retries} after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async generateDailySummary() {
        this.logger.info('Iniciando geração do resumo diário');
        try {
            const packagesWithPendingCustoms = await this.getPackagesWithPendingCustoms();
            
            if (packagesWithPendingCustoms.length > 0) {
                const message = this.formatSummaryMessage(packagesWithPendingCustoms);
                await this.sendWhatsAppMessage(message);
                this.logger.info('✅ Resumo diário enviado com sucesso!');
            } else {
                this.logger.info('ℹ️ Nenhum pacote com pendência alfandegária encontrado.');
            }
            
            return { success: true, packagesCount: packagesWithPendingCustoms.length };
        } catch (error) {
            this.logger.error('Erro ao gerar resumo diário:', error);
            throw error;
        }
    }

    async getPackagesWithPendingCustoms() {
        try {
            this.logger.info('🔍 Buscando pacotes no 17track...');
            const { endpoint, apiKey } = this.trackingConfig;
            
            // Remover http:// ou https:// do endpoint
            const api_url = endpoint.replace(/^https?:\/\//, '');
            const list_url = `https://${api_url}/track/v2.2/gettracklist`;
            const track_url = `https://${api_url}/track/v2.2/gettrackinfo`;
            
            const headers = {
                '17token': apiKey,
                'Content-Type': 'application/json'
            };

            const allPackages = await this.getAllPackages(list_url, headers);
            
            if (allPackages.length === 0) {
                return [];
            }

            const detailedPackages = await this.getDetailedPackages(allPackages, track_url, headers);
            const packagesWithIssues = detailedPackages.filter(pkg => this.checkTaxation(pkg));
            
            this.logger.info(`🚨 Pacotes com pendências encontrados: ${packagesWithIssues.length}`);
            return packagesWithIssues;
            
        } catch (error) {
            this.logger.error('Erro ao buscar pacotes:', error);
            if (error.response) {
                this.logger.error('Status Code:', error.response.status);
                this.logger.error('Resposta:', error.response.data);
            }
            throw error;
        }
    }

    async getAllPackages(list_url, headers) {
        let allPackages = [];
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages) {
            this.logger.info(`📄 Buscando página ${currentPage}...`);
            
            const list_data = {
                tracking_status: "Tracking",
                page_no: currentPage,
                order_by: "RegisterTimeDesc"
            };

            const response = await this.makeRequest(() => 
                this.httpClient.post(list_url, list_data, { headers })
            );
            
            if (response.data.code !== 0) {
                throw new Error(`Erro ao buscar lista: ${response.data.message || 'Erro desconhecido'}`);
            }

            if (!response.data.data?.accepted) {
                throw new Error(`Formato de resposta inválido: ${JSON.stringify(response.data)}`);
            }

            const packages = response.data.data.accepted;
            this.logger.info(`✅ Encontrados ${packages.length} pacotes na página ${currentPage}`);

            allPackages = allPackages.concat(packages);
            hasMorePages = packages.length === 40;
            currentPage++;

            if (hasMorePages) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        this.logger.info(`📦 Total de pacotes encontrados: ${allPackages.length}`);
        return allPackages;
    }

    async getDetailedPackages(packages, track_url, headers) {
        if (packages.length === 0) return [];

        this.logger.info('🔍 Buscando detalhes dos pacotes...');
        
        const batchSize = 40;
        const batches = Array.from({ length: Math.ceil(packages.length / batchSize) }, (_, i) =>
            packages.slice(i * batchSize, (i + 1) * batchSize)
        );

        let detailedPackages = [];
        
        for (let i = 0; i < batches.length; i++) {
            this.logger.info(`📦 Processando lote ${i + 1} de ${batches.length}`);
            
            const track_data = batches[i].map(pkg => ({
                number: pkg.number,
                carrier: pkg.carrier
            }));

            const response = await this.makeRequest(() =>
                this.httpClient.post(track_url, track_data, { headers })
            );

            if (response.data.code !== 0) {
                throw new Error(`Erro ao buscar detalhes: ${response.data.message || 'Erro desconhecido'}`);
            }

            if (!response.data.data) {
                throw new Error(`Formato de resposta inválido: ${JSON.stringify(response.data)}`);
            }

            const batchDetails = response.data.data.accepted || [];
            detailedPackages = detailedPackages.concat(batchDetails);

            if (i < batches.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return detailedPackages;
    }

    checkTaxation(pkg) {
        try {
            if (!pkg?.track_info) {
                this.logger.debug('Pacote inválido ou sem track_info:', pkg);
                return false;
            }

            const { latest_event = {}, latest_status = {} } = pkg.track_info;
            const status = (latest_status.status || '').toLowerCase();
            const eventDescription = (latest_event.description || '').toLowerCase();
            const trackingNumber = pkg.number || 'N/A';

            this.logger.debug(`Verificando pacote: ${trackingNumber}`);
            this.logger.debug(`Status: ${status}`);
            this.logger.debug(`Último evento: ${eventDescription}`);

            const problemStatuses = ['alert', 'expired', 'undelivered'];
            
            if (problemStatuses.includes(status)) {
                this.logger.debug(`Status problemático encontrado: ${status}`);
                return true;
            }
                
            if (this.customsKeywords.some(keyword => eventDescription.includes(keyword))) {
                this.logger.debug(`Pacote retido na alfândega: ${eventDescription}`);
                return true;
            }

            return false;
            
        } catch (error) {
            this.logger.error('Erro ao verificar status:', error);
            this.logger.debug('Pacote:', pkg);
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

            await this.httpClient.post(url, data, { headers });
            this.logger.info('✅ Mensagem enviada com sucesso!');
        } catch (error) {
            this.logger.error('Erro ao enviar mensagem:', error);
            throw error;
        }
    }

    startScheduler() {
        // Roda todos os dias às 20:00 de Brasília
        const cron = require('node-cron');
        cron.schedule('0 20 * * *', () => {
            this.logger.info('Gerando resumo diário de taxas...');
            this.generateDailySummary();
        }, {
            timezone: "America/Sao_Paulo"
        });
        
        this.logger.info('Agendador de resumo diário iniciado');
    }

    // Método para testes
    async test() {
        this.logger.info('Iniciando teste do resumo diário...');
        await this.generateDailySummary();
        this.logger.info('Teste concluído!');
    }
}

// Exporta a instância
const customsSummary = new CustomsSummary(require('../../config/settings'));
module.exports = customsSummary;
