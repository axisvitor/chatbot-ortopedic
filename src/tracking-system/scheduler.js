const cron = require('node-cron');
const { Track17Sync } = require('./sync_17track');
const { NuvemshopTrackingSync } = require('./sync_tracking_codes');
const logger = require('./utils/logger');
const { RedisStore } = require('./utils/redis-store');

class Scheduler {
    constructor() {
        this.redis = new RedisStore();
        this.jobs = [];
    }

    async start() {
        logger.info('Iniciando scheduler de jobs...');

        // Job do 17track - a cada 30 minutos
        this.jobs.push(cron.schedule('*/30 * * * *', async () => {
            try {
                logger.info('Iniciando sincronização com 17track');
                const track17 = new Track17Sync();
                await track17.start();
                await this.redis.set('last_track17_sync', new Date().toISOString());
                logger.info('Sincronização com 17track concluída');
            } catch (error) {
                logger.error('Erro na sincronização com 17track:', error);
            }
        }));

        // Job da Nuvemshop - a cada 1 hora
        this.jobs.push(cron.schedule('0 * * * *', async () => {
            try {
                logger.info('Iniciando sincronização com Nuvemshop');
                const nuvemshop = new NuvemshopTrackingSync();
                await nuvemshop.syncTrackingCodes();
                await this.redis.set('last_nuvemshop_sync', new Date().toISOString());
                logger.info('Sincronização com Nuvemshop concluída');
            } catch (error) {
                logger.error('Erro na sincronização com Nuvemshop:', error);
            }
        }));

        logger.info('Scheduler iniciado com sucesso');
    }

    stop() {
        logger.info('Parando scheduler...');
        this.jobs.forEach(job => job.stop());
        this.jobs = [];
        logger.info('Scheduler parado');
    }
}

module.exports = { Scheduler };
