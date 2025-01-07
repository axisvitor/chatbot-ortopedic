const { Track17Service } = require('./services/track17-service');
const { Track17PushService } = require('./services/track17-push-service');
const { RedisStore } = require('./utils/redis-store');
const logger = require('./utils/logger');

class Track17Sync {
    constructor() {
        this.track17 = new Track17Service();
        this.track17Push = new Track17PushService();
        this.redis = new RedisStore();
        this.batchSize = 40;
        this.syncInterval = 60 * 60 * 1000; // 60 minutos
    }

    async start() {
        try {
            logger.info('Iniciando sincronização com 17track');
            
            // 1. Registrar novos códigos
            await this.registerNewTrackingCodes();
            
            // 2. Solicita atualizações via push API
            await this.requestPushUpdates();
            
            // 3. Atualizar status dos códigos existentes
            await this.updateExistingTrackings();
            
            logger.info('Sincronização com 17track concluída');
        } catch (error) {
            logger.error('Erro na sincronização com 17track:', error);
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
                        await this.redis.markCodesAsRegistered(result.success);
                        logger.info(`${result.success.length} códigos registrados com sucesso`);
                    }
                    
                    if (result.failed.length > 0) {
                        logger.warn(`${result.failed.length} códigos falharam ao registrar:`, result.failed);
                    }

                    // Aguarda entre lotes para não sobrecarregar a API
                    if (i + this.batchSize < unregisteredCodes.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    logger.error(`Erro ao registrar lote de códigos:`, {
                        batch,
                        error: error.message
                    });
                    // Continua com próximo lote mesmo se houver erro
                }
            }
        } catch (error) {
            logger.error('Erro ao registrar novos códigos:', error);
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
                logger.info(`Solicitadas atualizações para lote ${i/this.batchSize + 1}`, {
                    total: batch.length
                });
            }
        } catch (error) {
            logger.error('Erro ao solicitar atualizações push:', error);
        }
    }

    async updateExistingTrackings() {
        try {
            // Busca códigos registrados que precisam de atualização
            const trackingsToUpdate = await this.redis.getTrackingsForUpdate();
            
            if (trackingsToUpdate.length === 0) {
                logger.info('Nenhum código para atualizar');
                return;
            }

            logger.info(`Atualizando ${trackingsToUpdate.length} códigos de rastreio`);

            // Processa em lotes
            for (let i = 0; i < trackingsToUpdate.length; i += this.batchSize) {
                const batch = trackingsToUpdate.slice(i, i + this.batchSize);
                const trackingCodes = batch.map(t => t.code);
                
                try {
                    const updates = await this.track17.getTrackingInfo(trackingCodes);
                    
                    for (const update of updates) {
                        const tracking = batch.find(t => t.code === update.code);
                        if (!tracking) continue;

                        // Verifica se houve mudança de status
                        if (tracking.status?.text !== update.status.text) {
                            logger.info(`Status alterado para código ${update.code}:`, {
                                old: tracking.status?.text,
                                new: update.status.text
                            });
                        }

                        // Atualiza no Redis
                        await this.redis.saveTrackingCode(tracking.orderId, {
                            ...update,
                            orderId: tracking.orderId
                        });
                    }

                    // Atualiza timestamp da última verificação
                    await this.redis.updateLastCheck(trackingCodes);

                    // Aguarda entre lotes
                    if (i + this.batchSize < trackingsToUpdate.length) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    logger.error(`Erro ao atualizar lote de códigos:`, {
                        codes: trackingCodes,
                        error: error.message
                    });
                    // Continua com próximo lote mesmo se houver erro
                }
            }
        } catch (error) {
            logger.error('Erro ao atualizar códigos existentes:', error);
            throw error;
        }
    }
}

// Executa a sincronização
if (require.main === module) {
    const sync = new Track17Sync();
    sync.start().catch(error => {
        logger.error('Falha na sincronização:', error);
        process.exit(1);
    });
}

module.exports = { Track17Sync };
