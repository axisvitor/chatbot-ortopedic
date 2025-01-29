const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { RedisStore } = require('../utils/redis-store');
const { REDIS_CONFIG, WHATSAPP_CONFIG } = require('../../config/settings');
const logger = require('../utils/logger');

const redis = new RedisStore();

// Middleware para verificar autenticidade do webhook
const verifyWebhook = (req, res, next) => {
    try {
        const signature = req.headers['17token'];
        const expectedToken = process.env.TRACK17_API_KEY;

        if (!signature || signature !== expectedToken) {
            logger.warn('[17Track] Tentativa de acesso ao webhook com token inválido:', {
                ip: req.ip,
                token: signature ? 'presente mas inválido' : 'ausente',
                timestamp: new Date().toISOString()
            });
            return res.status(401).json({ error: 'Unauthorized' });
        }

        next();
    } catch (error) {
        logger.error('[17Track] Erro na verificação do webhook:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        return res.status(401).json({ error: 'Invalid signature' });
    }
};

// Endpoint para receber atualizações do 17track
router.post('/push', verifyWebhook, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const updates = req.body.data;
        if (!updates || !Array.isArray(updates)) {
            logger.warn('[17Track] Payload inválido recebido:', {
                body: req.body,
                timestamp: new Date().toISOString()
            });
            return res.status(400).json({ error: 'Invalid payload' });
        }

        logger.info(`[17Track] Recebidas ${updates.length} atualizações`);

        let successCount = 0;
        let errorCount = 0;
        const notifications = [];

        for (const update of updates) {
            try {
                const trackingKey = `${REDIS_CONFIG.prefix.tracking}code:${update.number}`;
                const trackingData = {
                    code: update.number,
                    carrier: update.carrier || 'Desconhecido',
                    status: {
                        text: update.track_info?.latest_status?.status || 'Desconhecido',
                        location: update.track_info?.latest_status?.location || 'N/A',
                        time: update.track_info?.latest_status?.time
                    },
                    events: update.track_info?.events || [],
                    lastUpdate: new Date().toISOString(),
                    meta: {
                        webhookReceived: true,
                        updateTimestamp: startTime
                    }
                };

                // Busca dados existentes para preservar informações importantes
                const existingData = await redis.get(trackingKey);
                if (existingData) {
                    const parsed = JSON.parse(existingData);
                    trackingData.orderId = parsed.orderId;
                    trackingData.customerName = parsed.customerName;
                    trackingData.shippingAddress = parsed.shippingAddress;
                    
                    // Verifica se precisa notificar mudança importante
                    if (parsed.status?.text !== trackingData.status.text) {
                        notifications.push({
                            code: update.number,
                            orderId: parsed.orderId,
                            oldStatus: parsed.status?.text,
                            newStatus: trackingData.status.text,
                            customerName: parsed.customerName
                        });
                    }
                }

                // Salva atualização no Redis com TTL
                await redis.set(trackingKey, JSON.stringify(trackingData), REDIS_CONFIG.ttl.tracking.status);
                successCount++;

                logger.info(`[17Track] Atualização processada:`, {
                    code: update.number,
                    status: trackingData.status.text,
                    location: trackingData.status.location,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                errorCount++;
                logger.error(`[17Track] Erro ao processar atualização:`, {
                    code: update.number,
                    error: error.message,
                    stack: error.stack,
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Processa notificações importantes
        if (notifications.length > 0) {
            try {
                await processNotifications(notifications);
            } catch (error) {
                logger.error('[17Track] Erro ao processar notificações:', {
                    error: error.message,
                    notifications,
                    timestamp: new Date().toISOString()
                });
            }
        }

        const processingTime = Date.now() - startTime;
        logger.info('[17Track] Processamento concluído:', {
            total: updates.length,
            success: successCount,
            errors: errorCount,
            notifications: notifications.length,
            processingTime: `${processingTime}ms`,
            timestamp: new Date().toISOString()
        });

        return res.status(200).json({
            message: 'Updates processed',
            stats: {
                total: updates.length,
                success: successCount,
                errors: errorCount,
                notifications: notifications.length,
                processingTime
            }
        });
    } catch (error) {
        logger.error('[17Track] Erro geral no webhook:', {
            error: error.message,
            stack: error.stack,
            timestamp: new Date().toISOString()
        });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Processa notificações importantes
async function processNotifications(notifications) {
    if (!WHATSAPP_CONFIG.notifications.tracking) {
        logger.info('[17Track] Notificações WhatsApp desativadas');
        return;
    }

    for (const notif of notifications) {
        const message = formatNotificationMessage(notif);
        try {
            await sendWhatsAppNotification(message);
            logger.info('[17Track] Notificação enviada:', {
                code: notif.code,
                orderId: notif.orderId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logger.error('[17Track] Erro ao enviar notificação:', {
                error: error.message,
                notification: notif,
                timestamp: new Date().toISOString()
            });
        }
    }
}

// Formata mensagem de notificação
function formatNotificationMessage(notification) {
    const statusEmojis = {
        'InTransit': '📫',
        'Delivered': '✅',
        'Pickup': '🚚',
        'CustomsHold': '📦',
        'NotFound': '❓',
        'Exception': '⚠️',
        'Expired': '⏰'
    };

    const emoji = statusEmojis[notification.newStatus] || '📦';
    
    return `*Atualização de Rastreio* ${emoji}\n\n` +
           `*Pedido:* #${notification.orderId}\n` +
           `*Rastreio:* ${notification.code}\n` +
           `*Cliente:* ${notification.customerName}\n` +
           `*Status Anterior:* ${notification.oldStatus}\n` +
           `*Novo Status:* ${notification.newStatus}`;
}

// Envia notificação via WhatsApp
async function sendWhatsAppNotification(message) {
    // Implementar integração com WhatsApp
    // TODO: Integrar com serviço de WhatsApp quando disponível
    logger.info('[17Track] Simulando envio de notificação:', message);
}

module.exports = router;
