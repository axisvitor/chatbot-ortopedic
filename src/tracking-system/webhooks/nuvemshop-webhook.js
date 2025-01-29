const express = require('express');
const router = express.Router();
const { RedisStore } = require('../utils/redis-store');
const { Track17Service } = require('../services/track17-service');
const { REDIS_CONFIG, WHATSAPP_CONFIG, NUVEMSHOP_CONFIG } = require('../../config/settings');
const logger = require('../utils/logger');

const redis = new RedisStore();
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

        // Procura por informações de rastreio no pedido
        const fulfillment = order.fulfillments?.find(f => f.tracking_info?.code);
        
        if (!fulfillment?.tracking_info?.code) {
            logger.info('[Nuvemshop] Pedido sem código de rastreio:', {
                orderId: order.number,
                timestamp: new Date().toISOString()
            });
            return res.status(200).json({ 
                message: 'Pedido sem código de rastreio',
                orderId: order.number
            });
        }

        // Prepara dados de rastreio
        const trackingKey = `${REDIS_CONFIG.prefix.tracking}code:${fulfillment.tracking_info.code}`;
        const trackingData = {
            code: fulfillment.tracking_info.code,
            carrier: fulfillment.shipping?.carrier?.name || 'Correios',
            status: fulfillment.status || 'pendente',
            lastUpdate: order.updated_at,
            estimatedDelivery: fulfillment.tracking_info.estimated_delivery_date || null,
            orderStatus: order.status,
            orderId: order.number,
            customerName: order.customer?.name || 'N/A',
            shippingAddress: order.shipping_address ? 
                `${order.shipping_address.street}, ${order.shipping_address.number} - ${order.shipping_address.city}/${order.shipping_address.state}` : 
                'N/A',
            meta: {
                registered17track: false,
                attempts: 0,
                errors: [],
                lastSync: new Date().toISOString()
            }
        };

        // Salva o código de rastreio no Redis com TTL
        await redis.set(trackingKey, JSON.stringify(trackingData), REDIS_CONFIG.ttl.tracking.status);
        logger.info(`[Nuvemshop] Código de rastreio salvo:`, {
            orderId: order.number,
            code: trackingData.code,
            timestamp: new Date().toISOString()
        });

        // Registra o código no 17track
        try {
            const registration = await track17.registerForTracking(trackingData.code);
            if (registration.success.includes(trackingData.code)) {
                trackingData.meta.registered17track = true;
                await redis.set(trackingKey, JSON.stringify(trackingData), REDIS_CONFIG.ttl.tracking.status);
                
                logger.info(`[Nuvemshop] Código registrado no 17track:`, {
                    code: trackingData.code,
                    orderId: order.number,
                    timestamp: new Date().toISOString()
                });

                // Notifica sobre novo rastreio
                if (WHATSAPP_CONFIG.notifications.tracking) {
                    try {
                        await sendTrackingNotification(trackingData);
                    } catch (notifError) {
                        logger.error('[Nuvemshop] Erro ao enviar notificação:', {
                            error: notifError.message,
                            code: trackingData.code,
                            orderId: order.number,
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            } else if (registration.failed.includes(trackingData.code)) {
                logger.warn(`[Nuvemshop] Falha ao registrar no 17track:`, {
                    code: trackingData.code,
                    orderId: order.number,
                    timestamp: new Date().toISOString()
                });
                // Será tentado novamente pelo job de sincronização
            }
        } catch (track17Error) {
            logger.error('[Nuvemshop] Erro ao registrar no 17track:', {
                code: trackingData.code,
                orderId: order.number,
                error: track17Error.message,
                stack: track17Error.stack,
                timestamp: new Date().toISOString()
            });
            // Não falha o webhook por erro no 17track
        }

        const processingTime = Date.now() - startTime;
        logger.info('[Nuvemshop] Processamento concluído:', {
            orderId: order.number,
            event,
            processingTime: `${processingTime}ms`,
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            message: 'Pedido processado',
            orderId: order.number,
            trackingCode: trackingData.code,
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
