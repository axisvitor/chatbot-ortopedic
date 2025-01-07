const express = require('express');
const router = express.Router();
const { RedisStore } = require('../utils/redis-store');
const { Track17Service } = require('../services/track17-service');
const logger = require('../utils/logger');

const redis = new RedisStore();
const track17 = new Track17Service();

// Middleware para verificar autenticidade do webhook
const verifyWebhook = (req, res, next) => {
    const token = req.headers['x-nuvemshop-token'];
    const expectedToken = process.env.NUVEMSHOP_WEBHOOK_TOKEN;

    if (!token || token !== expectedToken) {
        logger.warn('Tentativa de acesso ao webhook com token inválido:', {
            ip: req.ip,
            token: token ? 'presente mas inválido' : 'ausente'
        });
        return res.status(401).json({ error: 'Unauthorized' });
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
            logger.warn('Payload inválido recebido:', req.body);
            return res.status(400).json({ error: 'Invalid payload' });
        }

        // Verifica se é um evento relacionado a pedido
        if (!event.includes('order/')) {
            logger.info('Evento ignorado (não relacionado a pedido):', event);
            return res.status(200).json({ message: 'Evento ignorado' });
        }

        logger.info(`Processando webhook para pedido #${order.number}`, { event });

        // Procura por informações de rastreio no pedido
        const fulfillment = order.fulfillments?.find(f => f.tracking_info?.code);
        
        if (!fulfillment?.tracking_info?.code) {
            logger.info(`Pedido #${order.number} sem código de rastreio`);
            return res.status(200).json({ 
                message: 'Pedido sem código de rastreio',
                orderId: order.number
            });
        }

        // Prepara dados de rastreio
        const trackingData = {
            code: fulfillment.tracking_info.code,
            carrier: fulfillment.shipping?.carrier?.name || 'Correios',
            status: fulfillment.status || 'pendente',
            lastUpdate: order.updated_at,
            estimatedDelivery: fulfillment.tracking_info.estimated_delivery_date || null,
            orderStatus: order.status,
            customerName: order.customer?.name || 'N/A',
            shippingAddress: order.shipping_address ? 
                `${order.shipping_address.street}, ${order.shipping_address.number} - ${order.shipping_address.city}/${order.shipping_address.state}` : 
                'N/A',
            meta: {
                registered17track: false,
                attempts: 0,
                errors: []
            }
        };

        // Salva o código de rastreio no Redis
        await redis.saveTrackingCode(order.number, trackingData);
        logger.info(`Código de rastreio salvo para pedido #${order.number}`);

        // Registra o código no 17track
        try {
            const registration = await track17.registerForTracking(trackingData.code);
            if (registration.success.includes(trackingData.code)) {
                await redis.markCodesAsRegistered([trackingData.code]);
                logger.info(`Código ${trackingData.code} registrado no 17track`);
            } else if (registration.failed.includes(trackingData.code)) {
                logger.warn(`Falha ao registrar código ${trackingData.code} no 17track`);
                // Será tentado novamente pelo job de sincronização
            }
        } catch (track17Error) {
            logger.error('Erro ao registrar no 17track:', {
                code: trackingData.code,
                error: track17Error.message
            });
            // Não falha o webhook por erro no 17track
        }

        const processingTime = Date.now() - startTime;
        logger.info(`Webhook processado em ${processingTime}ms`);

        return res.status(200).json({ 
            message: 'Tracking atualizado',
            orderId: order.number,
            trackingCode: trackingData.code,
            processingTime
        });
    } catch (error) {
        const processingTime = Date.now() - startTime;
        logger.error('Erro ao processar webhook:', {
            error: error.message,
            stack: error.stack,
            processingTime
        });
        
        return res.status(500).json({ 
            error: 'Erro interno',
            message: error.message
        });
    }
});

module.exports = router;
