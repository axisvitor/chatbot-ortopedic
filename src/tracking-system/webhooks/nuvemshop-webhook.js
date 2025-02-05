const express = require('express');
const logger = require('../utils/logger');
const { RedisStoreSync } = require('../utils/redis-store-sync');
const { NUVEMSHOP_CONFIG, TRACKING_CONFIG } = require('../config/settings');
const { Track17Service } = require('../services/track17-service');

const router = express.Router();

// Verifica se a integração com a Nuvemshop está habilitada
if (!NUVEMSHOP_CONFIG.enabled) {
    logger.warn('[Nuvemshop] Integração não configurada. Webhook não será inicializado.');
    module.exports = router;
    return;
}

const redis = new RedisStoreSync();
const track17 = new Track17Service();

// Middleware para verificar autenticidade do webhook
const verifyWebhook = (req, res, next) => {
    const token = req.headers['x-nuvemshop-token'];

    // TODO: Implementar verificação de autenticidade do webhook quando tivermos a documentação da Nuvemshop
    // Por enquanto, aceitamos qualquer token para teste
    logger.warn('[Nuvemshop] Aviso: Verificação de autenticidade do webhook não implementada');
    next();
};

// Endpoint para receber notificações de atualização de pedidos
router.post('/order-update', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { event, order } = req.body;

        // Valida o payload
        if (!event || !order || !order.number) {
            logger.warn('[Nuvemshop] Payload inválido recebido:', {
                body: req.body,
                timestamp: new Date().toISOString()
            });
            return res.status(400).json({ error: 'Payload inválido' });
        }

        // Verifica se é um evento suportado
        if (!NUVEMSHOP_CONFIG.webhook.topics.includes(event)) {
            logger.info('[Nuvemshop] Evento não suportado:', {
                event,
                supportedEvents: NUVEMSHOP_CONFIG.webhook.topics,
                timestamp: new Date().toISOString()
            });
            return res.status(200).json({ message: 'Evento não suportado' });
        }

        // Verifica se é um evento relacionado a pedido
        if (!event.includes('order/')) {
            logger.info('[Nuvemshop] Evento ignorado (não relacionado a pedido):', {
                event,
                timestamp: new Date().toISOString()
            });
            return res.status(200).json({ message: 'Evento ignorado' });
        }

        logger.info(`[Nuvemshop] Processando webhook:`, {
            event,
            orderId: order.number,
            timestamp: new Date().toISOString()
        });

        // Processa o pedido
        await processOrderUpdate(event, order);

        const processingTime = Date.now() - startTime;
        logger.info('[Nuvemshop] Processamento concluído:', {
            event,
            orderNumber: order.number,
            processingTime,
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({ 
            message: 'Order processed',
            orderNumber: order.number,
            processingTime 
        });
    } catch (error) {
        const processingTime = Date.now() - startTime;
        logger.error('[Nuvemshop] Erro geral no webhook:', {
            error: error.message,
            stack: error.stack,
            processingTime: `${processingTime}ms`,
            timestamp: new Date().toISOString()
        });
        
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Processa atualização de pedido
async function processOrderUpdate(event, order) {
    try {
        logger.info('[Nuvemshop] Processando atualização de pedido:', {
            event,
            orderId: order.id,
            orderNumber: order.number
        });

        // Verifica se o pedido tem código de rastreio
        if (!order.shipping_tracking) {
            logger.info('[Nuvemshop] Pedido sem código de rastreio:', {
                orderId: order.id,
                orderNumber: order.number
            });
            return;
        }

        // Registra o código de rastreio no 17track
        await registerTracking(order);

        logger.info('[Nuvemshop] Pedido processado com sucesso:', {
            event,
            orderId: order.id,
            orderNumber: order.number,
            trackingCode: order.shipping_tracking
        });
    } catch (error) {
        logger.error('[Nuvemshop] Erro ao processar pedido:', {
            event,
            orderId: order.id,
            orderNumber: order.number,
            error: error.message
        });
        throw error;
    }
}

// Registra código de rastreio no 17track
async function registerTracking(order) {
    try {
        // Extrai dados do pedido
        const trackingData = {
            orderId: order.number,
            code: order.shipping_tracking,
            carrier: order.shipping_carrier_name || 'Correios',
            customerName: order.customer.name,
            estimatedDelivery: order.shipping_estimated_delivery
        };

        // Registra no 17track
        await track17.registerTrackingNumber(trackingData.code, trackingData.carrier);

        // Salva no Redis
        const orderKey = `${NUVEMSHOP_CONFIG.cache.prefix.orders}${order.number}`;
        const orderData = {
            id: order.id,
            number: order.number,
            tracking: {
                code: trackingData.code,
                carrier: trackingData.carrier,
                registeredAt: new Date().toISOString()
            }
        };

        await redis.set(orderKey, JSON.stringify(orderData), NUVEMSHOP_CONFIG.cache.ttl.orders);

        logger.info('[Nuvemshop] Código de rastreio registrado com sucesso:', {
            orderId: order.number,
            trackingCode: trackingData.code,
            carrier: trackingData.carrier
        });

    } catch (error) {
        logger.error('[Nuvemshop] Erro ao registrar código de rastreio:', {
            orderId: order.number,
            trackingCode: order.shipping_tracking,
            error: error.message
        });
        throw error;
    }
}

module.exports = router;
