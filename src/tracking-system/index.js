const cron = require('node-cron');
const { logger } = require('./utils/logger');
const { Track17Service } = require('./services/track17-service');
const { Track17PushService } = require('./services/track17-push');
const { TrackingServiceSync } = require('./services/tracking-service-sync');
const { Track17Sync } = require('./sync_17track');
const { NuvemshopTrackingSync } = require('./sync_tracking_codes');
const NuvemshopService = require('../services/nuvemshop');
const TrackingService = require('./services/tracking-service');
const { CacheService } = require('./services/cache-service');
const { RedisStore } = require('./utils/redis-store');
const { Scheduler } = require('./scheduler');

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

// Exporta todos os módulos
module.exports = {
    TrackingSystem,
    Track17Service,
    Track17PushService,
    TrackingServiceSync,
    Track17Sync,
    NuvemshopTrackingSync,
    NuvemshopService,
    TrackingService,
    CacheService,
    RedisStore,
    Scheduler
};

// Inicia o sistema apenas se este arquivo for executado diretamente
if (require.main === module) {
    const trackingSystem = new TrackingSystem();
    trackingSystem.startScheduler();
}
