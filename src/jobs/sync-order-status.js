'use strict';

const { TrackingService } = require('../services/tracking-service');
const { NuvemshopService } = require('../services/nuvemshop-service');
const { RedisStore } = require('../store/redis-store');

class OrderStatusSyncJob {
    constructor() {
        this.trackingService = new TrackingService();
        this.nuvemshopService = new NuvemshopService();
        this.redisStore = new RedisStore();
        this.lockKey = 'job:sync_order_status:lock';
        this.lockTTL = 10 * 60; // 10 minutos
    }

    async acquireLock() {
        const locked = await this.redisStore.set(
            this.lockKey,
            new Date().toISOString(),
            this.lockTTL,
            'NX' // Only set if not exists
        );
        return !!locked;
    }

    async releaseLock() {
        await this.redisStore.del(this.lockKey);
    }

    async run() {
        console.log('[OrderSync] Iniciando sincronização de status dos pedidos');
        
        try {
            // Tenta adquirir lock para evitar execuções simultâneas
            if (!await this.acquireLock()) {
                console.log('[OrderSync] Job já está em execução');
                return;
            }

            // Busca pedidos em aberto
            const openOrders = await this.nuvemshopService.getOpenOrders();
            console.log(`[OrderSync] Encontrados ${openOrders.length} pedidos em aberto`);

            for (const order of openOrders) {
                try {
                    if (!order.shipping_tracking) {
                        continue;
                    }

                    console.log(`[OrderSync] Processando pedido #${order.number}`, {
                        tracking: order.shipping_tracking
                    });

                    // Força refresh do cache para ter dados atualizados
                    const trackingInfo = await this.trackingService.getTrackingInfo(
                        order.shipping_tracking,
                        true // forceRefresh
                    );

                    if (trackingInfo && trackingInfo.status.toLowerCase().includes('entregue')) {
                        await this.nuvemshopService.updateOrderStatus(order.id, 'closed');
                        console.log(`[OrderSync] Pedido #${order.number} marcado como entregue`);
                    }

                } catch (error) {
                    console.error(`[OrderSync] Erro ao processar pedido #${order.number}`, {
                        error: error.message,
                        orderId: order.id
                    });
                    // Continua processando outros pedidos
                }
            }

        } catch (error) {
            console.error('[OrderSync] Erro durante sincronização', {
                error: error.message,
                stack: error.stack
            });
        } finally {
            await this.releaseLock();
        }
    }
}

module.exports = { OrderStatusSyncJob };
