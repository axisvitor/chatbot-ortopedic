const { Track17Service } = require('./services/track17-service');
const { Track17PushService } = require('./services/track17-push-service');
const { RedisStore } = require('./utils/redis-store');
const logger = require('./utils/logger');
const { TRACKING_CONFIG, REDIS_CONFIG } = require('../config/settings');

class Track17Sync {
    constructor() {
        this.track17 = new Track17Service();
        this.track17Push = new Track17PushService();
        this.redis = new RedisStore();
        this.batchSize = 40; // Limite da API do 17track
        this.syncInterval = TRACKING_CONFIG.updateInterval;
        this.config = TRACKING_CONFIG;
    }

    async start() {
        try {
            logger.info('Iniciando sincronização com 17track', {
                batchSize: this.batchSize,
                syncInterval: this.syncInterval
            });
            
            // 1. Registrar novos códigos
            await this.registerNewTrackingCodes();
            
            // 2. Solicita atualizações via push API
            await this.requestPushUpdates();
            
            // 3. Atualizar status dos códigos existentes
            await this.updateExistingTrackings();
            
            logger.info('Sincronização com 17track concluída');
        } catch (error) {
            logger.error('Erro na sincronização com 17track:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async registerNewTrackingCodes() {
        try {
            // Busca códigos não registrados
            const unregisteredCodes = await this.redis.getUnregisteredTrackingCodes();
            
            if (unregisteredCodes.length === 0) {
                logger.info('Nenhum código novo para registrar');
                return;
            }

            logger.info(`Registrando ${unregisteredCodes.length} novos códigos no 17track`);

            // Processa em lotes para respeitar limite da API
            for (let i = 0; i < unregisteredCodes.length; i += this.batchSize) {
                const batch = unregisteredCodes.slice(i, i + this.batchSize);
                
                try {
                    const result = await this.track17.registerForTracking(batch);
                    
                    if (result.success.length > 0) {
                        // Salva no Redis com TTL configurável
                        await this.redis.markCodesAsRegistered(
                            result.success,
                            REDIS_CONFIG.ttl.tracking.default
                        );
                        logger.info(`${result.success.length} códigos registrados com sucesso`);
                    }
                    
                    if (result.failed.length > 0) {
                        logger.warn(`${result.failed.length} códigos falharam ao registrar:`, {
                            failed: result.failed,
                            reasons: result.failed.map(f => f.reason)
                        });
                    }

                    // Aguarda entre lotes para não sobrecarregar a API
                    if (i + this.batchSize < unregisteredCodes.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    logger.error(`Erro ao registrar lote de códigos:`, {
                        batch,
                        error: error.message,
                        stack: error.stack
                    });
                    // Continua com próximo lote mesmo se houver erro
                }
            }
        } catch (error) {
            logger.error('Erro ao registrar novos códigos:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async requestPushUpdates() {
        try {
            const trackingCodes = await this.redis.getAllTrackingCodes();
            if (!trackingCodes || trackingCodes.length === 0) {
                logger.info('Nenhum código para solicitar atualizações via push');
                return;
            }

            const codes = trackingCodes.map(t => t.code);
            
            // Divide em lotes de 40 códigos (limite da API)
            for (let i = 0; i < codes.length; i += this.batchSize) {
                const batch = codes.slice(i, i + this.batchSize);
                await this.track17Push.requestUpdates(batch);
                
                // Atualiza timestamp da última solicitação com TTL configurável
                await this.redis.set(
                    `${REDIS_CONFIG.prefix.tracking}last_push_request`,
                    new Date().toISOString(),
                    REDIS_CONFIG.ttl.tracking.updates
                );
                
                logger.info(`Solicitadas atualizações para lote ${Math.floor(i/this.batchSize) + 1}`, {
                    total: batch.length,
                    remaining: codes.length - (i + batch.length)
                });

                // Aguarda entre lotes
                if (i + this.batchSize < codes.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } catch (error) {
            logger.error('Erro ao solicitar atualizações push:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async updateExistingTrackings() {
        try {
            const trackingCodes = await this.redis.getAllTrackingCodes();
            if (!trackingCodes || trackingCodes.length === 0) {
                logger.info('Nenhum código para atualizar status');
                return;
            }

            for (let i = 0; i < trackingCodes.length; i += this.batchSize) {
                const batch = trackingCodes.slice(i, i + this.batchSize);
                const codes = batch.map(t => t.code);

                try {
                    const updates = await this.track17.getTrackingInfo(codes);
                    
                    // Atualiza no Redis com TTL configurável
                    for (const update of updates) {
                        await this.redis.set(
                            `${REDIS_CONFIG.prefix.tracking}status:${update.code}`,
                            update,
                            REDIS_CONFIG.ttl.tracking.status
                        );
                    }

                    logger.info(`Atualizados ${updates.length} códigos do lote ${Math.floor(i/this.batchSize) + 1}`);

                    // Aguarda entre lotes
                    if (i + this.batchSize < trackingCodes.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    logger.error(`Erro ao atualizar lote de códigos:`, {
                        batch: codes,
                        error: error.message
                    });
                    // Continua com próximo lote mesmo se houver erro
                }
            }
        } catch (error) {
            logger.error('Erro ao atualizar status dos códigos:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
}

// Executa a sincronização
if (require.main === module) {
    const sync = new Track17Sync();
    sync.start()
        .then(() => {
            logger.info('Processo de sincronização finalizado com sucesso');
            process.exit(0);
        })
        .catch(error => {
            logger.error('Erro no processo de sincronização:', {
                error: error.message,
                stack: error.stack
            });
            process.exit(1);
        });
}

module.exports = { Track17Sync };
