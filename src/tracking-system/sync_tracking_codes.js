require('dotenv').config({ path: '../../../.env' });
const { RedisStoreSync } = require('./utils/redis-store-sync');
const DatabaseService = require('./utils/database-service');
const axios = require('axios');
const logger = require('./utils/logger');
const { NUVEMSHOP_CONFIG } = require('../../config/settings');
const { TrackingServiceSync } = require('./services/tracking-service-sync');

class NuvemshopTrackingSync {
    constructor() {
        this.redis = new RedisStoreSync();
        this.database = new DatabaseService();
        this.config = NUVEMSHOP_CONFIG;
        
        if (!this.config.accessToken || !this.config.userId || !this.config.apiUrl) {
            throw new Error('Configurações da Nuvemshop incompletas');
        }
    }

    async getOrdersFromLastMonth() {
        try {
            // Pegar o início do dia atual
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            
            // Calcular exatamente 30 dias atrás à meia-noite
            const thirtyDaysAgo = new Date(now);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            logger.info('Sincronizando pedidos da Nuvemshop:', {
                dataInicial: thirtyDaysAgo.toISOString(),
                apiUrl: this.config.apiUrl
            });
            
            const headers = {
                'Authentication': `bearer ${this.config.accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)',
                'Accept': 'application/json'
            };

            let allOrders = [];
            let page = 1;
            let hasMore = true;

            while (hasMore) {
                try {
                    logger.info(`Buscando página ${page} de pedidos`);
                    const response = await axios.get(`${this.config.apiUrl}/orders`, {
                        headers,
                        params: {
                            updated_at_min: thirtyDaysAgo.toISOString(),
                            per_page: 200,
                            page
                        }
                    });

                    const orders = response.data;
                    if (orders && orders.length > 0) {
                        allOrders = allOrders.concat(orders);
                        page++;
                        
                        // Cache dos pedidos com TTL configurável
                        await this.redis.set(
                            `${this.config.cache.prefix}orders:page:${page}`,
                            orders,
                            this.config.cache.ttl.orders.recent
                        );
                    } else {
                        hasMore = false;
                    }

                    // Aguarda 1 segundo entre as requisições para evitar rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));

                } catch (error) {
                    logger.error('Erro ao buscar página de pedidos:', {
                        page,
                        error: error.message
                    });
                    hasMore = false;
                }
            }

            logger.info(`Total de pedidos encontrados: ${allOrders.length}`);
            return allOrders;

        } catch (error) {
            logger.error('Erro ao buscar pedidos:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async syncTrackingCodes() {
        try {
            logger.info('Iniciando sincronização de códigos de rastreio');
            const orders = await this.getOrdersFromLastMonth();
            
            const trackingCodes = new Set();
            let totalProcessed = 0;
            const trackingUpdates = [];

            for (const order of orders) {
                if (order.shipping_tracking_number) {
                    const trackingData = {
                        orderId: order.id,
                        orderNumber: order.number,
                        trackingCode: order.shipping_tracking_number,
                        trackingUrl: order.shipping_tracking_url || null,
                        updatedAt: new Date().toISOString(),
                        status: order.shipping_status || 'pending'
                    };

                    // Salva no Redis para cache
                    await this.redis.set(
                        `${this.config.cache.prefix}tracking:${order.id}`,
                        trackingData,
                        this.config.cache.ttl.tracking.codes
                    );

                    trackingCodes.add(order.shipping_tracking_number);
                    trackingUpdates.push(trackingData);
                    totalProcessed++;
                }
            }

            // Salva no arquivo JSON para persistência de longo prazo
            if (trackingUpdates.length > 0) {
                await this.database.saveTrackingData(trackingUpdates);
            }

            logger.info('Sincronização concluída:', {
                totalProcessados: totalProcessed,
                codigosUnicos: trackingCodes.size
            });

            return {
                processed: totalProcessed,
                uniqueCodes: trackingCodes.size
            };
            
        } catch (error) {
            logger.error('Erro na sincronização:', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
}

// Executar a sincronização
if (require.main === module) {
    const sync = new NuvemshopTrackingSync();
    sync.syncTrackingCodes()
        .then(() => {
            logger.info('Processo de sincronização finalizado com sucesso');
            process.exit(0);
        })
        .catch(error => {
            logger.error('Erro no processo de sincronização:', error);
            process.exit(1);
        });
}
