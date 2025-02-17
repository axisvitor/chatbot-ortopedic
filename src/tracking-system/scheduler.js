const cron = require('node-cron');
const { Track17Sync } = require('./sync_17track');
const { NuvemshopTrackingSync } = require('./sync_tracking_codes');
const logger = require('./utils/logger');
const { RedisStoreSync } = require('./utils/redis-store-sync');
const { REDIS_CONFIG } = require('../config/settings');

class Scheduler {
    constructor() {
        this.redis = new RedisStoreSync();
        this.jobs = [];

        // Status keys
        this.lastSyncKeys = {
            track17: `${REDIS_CONFIG.prefix.tracking.sync.track17}last_sync`,
            nuvemshop: `${REDIS_CONFIG.prefix.tracking.sync.nuvemshop}last_sync`
        };
    }

    async start() {
        logger.info('[Scheduler] Iniciando jobs...', {
            timestamp: new Date().toISOString()
        });

        // Job do 17track - a cada 30 minutos
        this.jobs.push(cron.schedule('*/30 * * * *', async () => {
            try {
                logger.info('[Scheduler] Iniciando sincronização 17track:', {
                    timestamp: new Date().toISOString()
                });

                const track17 = new Track17Sync();
                await track17.start();
                
                // Atualiza status com TTL
                await this.redis.set(
                    this.lastSyncKeys.track17, 
                    JSON.stringify({
                        lastSync: new Date().toISOString(),
                        status: 'success'
                    }),
                    REDIS_CONFIG.ttl.tracking.sync
                );

                logger.info('[Scheduler] Sincronização 17track concluída:', {
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                logger.error('[Scheduler] Erro na sincronização 17track:', {
                    error: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });

                // Registra erro com TTL
                await this.redis.set(
                    this.lastSyncKeys.track17,
                    JSON.stringify({
                        lastSync: new Date().toISOString(),
                        status: 'error',
                        error: error.message
                    }),
                    REDIS_CONFIG.ttl.tracking.sync
                );
            }
        }));

        // Job da Nuvemshop - a cada 1 hora
        this.jobs.push(cron.schedule('0 * * * *', async () => {
            try {
                logger.info('[Scheduler] Iniciando sincronização Nuvemshop:', {
                    timestamp: new Date().toISOString()
                });

                const nuvemshop = new NuvemshopTrackingSync();
                await nuvemshop.syncTrackingCodes();
                
                // Atualiza status com TTL
                await this.redis.set(
                    this.lastSyncKeys.nuvemshop,
                    JSON.stringify({
                        lastSync: new Date().toISOString(),
                        status: 'success'
                    }),
                    REDIS_CONFIG.ttl.tracking.sync
                );

                logger.info('[Scheduler] Sincronização Nuvemshop concluída:', {
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                logger.error('[Scheduler] Erro na sincronização Nuvemshop:', {
                    error: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });

                // Registra erro com TTL
                await this.redis.set(
                    this.lastSyncKeys.nuvemshop,
                    JSON.stringify({
                        lastSync: new Date().toISOString(),
                        status: 'error',
                        error: error.message
                    }),
                    REDIS_CONFIG.ttl.tracking.sync
                );
            }
        }));

        logger.info('[Scheduler] Jobs iniciados com sucesso:', {
            jobs: this.jobs.length,
            timestamp: new Date().toISOString()
        });
    }

    async stop() {
        logger.info('[Scheduler] Parando jobs...', {
            timestamp: new Date().toISOString()
        });

        this.jobs.forEach(job => job.stop());
        this.jobs = [];

        logger.info('[Scheduler] Jobs parados com sucesso:', {
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Obtém status das sincronizações
     */
    async getSyncStatus() {
        try {
            const [track17Status, nuvemshopStatus] = await Promise.all([
                this.redis.get(this.lastSyncKeys.track17),
                this.redis.get(this.lastSyncKeys.nuvemshop)
            ]);

            return {
                track17: track17Status ? JSON.parse(track17Status) : null,
                nuvemshop: nuvemshopStatus ? JSON.parse(nuvemshopStatus) : null,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.error('[Scheduler] Erro ao obter status:', {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }
}

module.exports = { Scheduler };
