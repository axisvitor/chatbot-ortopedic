const cron = require('node-cron');
const { logger } = require('./utils/logger');
const NuvemshopService = require('./services/nuvemshop-service');
const TrackingService = require('./services/tracking-service');

class TrackingSystem {
    constructor() {
        this.nuvemshop = new NuvemshopService();
        this.tracking = new TrackingService();
    }

    async registerNewTrackings() {
        try {
            logger.info('Iniciando registro de novos códigos de rastreio');
            
            // Busca pedidos com códigos de rastreio
            const orders = await this.nuvemshop.getNewOrdersWithTracking();
            
            if (orders.length === 0) {
                logger.info('Nenhum novo pedido com rastreio encontrado');
                return;
            }

            // Registra os códigos no 17track
            await this.tracking.registerTrackingNumbers(orders);
            
            logger.info('Registro de códigos concluído com sucesso');
        } catch (error) {
            logger.error('Erro no processo de registro:', error);
        }
    }

    startScheduler() {
        // Executa todos os dias à meia-noite
        cron.schedule('0 0 * * *', async () => {
            await this.registerNewTrackings();
        });
        logger.info('Agendador iniciado - registro programado para meia-noite');
    }
}

// Inicia o sistema
const trackingSystem = new TrackingSystem();
trackingSystem.startScheduler();
