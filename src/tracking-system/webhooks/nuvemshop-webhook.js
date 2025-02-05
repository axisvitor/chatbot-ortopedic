const express = require('express');
const logger = require('../utils/logger');
const { RedisStoreSync } = require('../utils/redis-store-sync');
const { NUVEMSHOP_CONFIG, TRACKING_CONFIG } = require('../config/settings');
const { Track17Service } = require('../services/track17-service');

const router = express.Router();
const redis = new RedisStoreSync();
const track17 = new Track17Service();

// Middleware para verificar autenticidade do webhook
const verifyWebhook = (req, res, next) => {
    const token = req.headers['x-nuvemshop-token'];
    const expectedToken = NUVEMSHOP_CONFIG.webhook.secret;

    if (!token || token !== expectedToken) {
        logger.warn('[Nuvemshop] Tentativa de acesso ao webhook com token inválido:', {
            ip: req.ip,
            token: token ? 'presente mas inválido' : 'ausente',
            timestamp: new Date().toISOString()
        });
        return res.status(401).json({ error: 'Token inválido' });
    }

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

/**
 * Processa atualização de pedido
 * @param {string} event - Tipo do evento
 * @param {Object} order - Dados do pedido
 * @returns {Promise<void>}
 */
async function processOrderUpdate(event, order) {
    try {
        // Valida dados do pedido
        if (!order.number || !order.shipping_status) {
            logger.warn('[Nuvemshop] Pedido inválido:', {
                order,
                timestamp: new Date().toISOString()
            });
            return;
        }

        // Salva dados do pedido no Redis
        const orderKey = `${NUVEMSHOP_CONFIG.cache.prefix}order:${order.number}`;
        const orderData = {
            number: order.number,
            status: order.shipping_status,
            customer: {
                name: order.customer?.name,
                email: order.customer?.email,
                phone: order.customer?.phone
            },
            shipping: {
                address: order.shipping_address,
                carrier: order.shipping_carrier,
                tracking: order.shipping_tracking
            },
            lastUpdate: new Date().toISOString(),
            meta: {
                source: 'nuvemshop',
                webhookReceived: true,
                event
            }
        };

        await redis.set(orderKey, JSON.stringify(orderData), NUVEMSHOP_CONFIG.cache.ttl.order);

        // Se tem código de rastreio, registra no 17track
        if (order.shipping_tracking) {
            await registerTracking(order);
        }

        logger.info('[Nuvemshop] Pedido processado:', {
            orderNumber: order.number,
            status: order.shipping_status,
            tracking: order.shipping_tracking || 'N/A',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('[Nuvemshop] Erro ao processar pedido:', {
            orderNumber: order.number,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

/**
 * Registra código de rastreio no 17track
 * @param {Object} order - Dados do pedido
 * @returns {Promise<void>}
 */
async function registerTracking(order) {
    try {
        // Verifica se já está registrado
        const trackingKey = `${TRACKING_CONFIG.cache.prefix}tracking:${order.shipping_tracking}`;
        const existingTracking = await redis.get(trackingKey);
        
        if (existingTracking) {
            const parsed = JSON.parse(existingTracking);
            if (parsed.meta?.registered17track) {
                logger.info('[Nuvemshop] Rastreio já registrado:', {
                    orderNumber: order.number,
                    tracking: order.shipping_tracking,
                    timestamp: new Date().toISOString()
                });
                return;
            }
        }

        // Registra no 17track
        const registration = await track17.registerForTracking(order.shipping_tracking);
        
        if (registration.success) {
            // Salva status no Redis
            const trackingData = {
                code: order.shipping_tracking,
                orderId: order.number,
                customerName: order.customer?.name,
                carrier: order.shipping_carrier,
                status: 'pending',
                lastUpdate: new Date().toISOString(),
                meta: {
                    registered17track: true,
                    source: 'nuvemshop',
                    orderNumber: order.number
                }
            };

            await redis.set(trackingKey, JSON.stringify(trackingData), TRACKING_CONFIG.cache.ttl.tracking);

            // Envia notificação de rastreio registrado
            const notification = formatTrackingNotification(trackingData);
            await sendTrackingNotification(notification);
        }

    } catch (error) {
        logger.error('[Nuvemshop] Erro ao registrar rastreio:', {
            orderNumber: order.number,
            tracking: order.shipping_tracking,
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        throw error;
    }
}

// Formata mensagem de notificação de novo rastreio
function formatTrackingNotification(trackingData) {
    return `*Novo Rastreio Registrado* 📦\n\n` +
           `*Pedido:* #${trackingData.orderId}\n` +
           `*Rastreio:* ${trackingData.code}\n` +
           `*Cliente:* ${trackingData.customerName}\n` +
           `*Transportadora:* ${trackingData.carrier}\n` +
           (trackingData.estimatedDelivery ? 
            `*Previsão de Entrega:* ${new Date(trackingData.estimatedDelivery).toLocaleDateString('pt-BR')}\n` : '') +
           `\nO código já está sendo monitorado e você receberá atualizações importantes sobre a entrega.`;
}

// Envia notificação de novo rastreio
async function sendTrackingNotification(trackingData) {
    const message = formatTrackingNotification(trackingData);
    // TODO: Integrar com serviço de WhatsApp quando disponível
    logger.info('[Nuvemshop] Simulando envio de notificação:', {
        message,
        orderId: trackingData.orderId,
        timestamp: new Date().toISOString()
    });
}

module.exports = router;
