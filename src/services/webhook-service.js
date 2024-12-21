const crypto = require('crypto');
const { NUVEMSHOP_CONFIG } = require('../config/settings');

class WebhookService {
    constructor() {
        this.userAgent = 'API Loja Ortopedic (suporte@lojaortopedic.com.br)';
    }

    verifyNuvemshopWebhook(data, hmacHeader) {
        try {
            const calculatedHmac = crypto
                .createHmac('sha256', NUVEMSHOP_CONFIG.accessToken)
                .update(data)
                .digest('hex');

            return hmacHeader === calculatedHmac;
        } catch (error) {
            console.error('[Webhook] Erro ao verificar HMAC:', error);
            return false;
        }
    }

    handleNuvemshopWebhook(data, headers) {
        try {
            const hmacHeader = headers['x-linkedstore-hmac-sha256'];
            
            // Verifica a assinatura do webhook
            if (!this.verifyNuvemshopWebhook(JSON.stringify(data), hmacHeader)) {
                console.error('[Webhook] Assinatura HMAC inválida');
                return null;
            }

            // Processa eventos específicos
            switch (data.event) {
                case 'order/created':
                case 'order/updated':
                case 'order/paid':
                case 'order/cancelled':
                    return this.handleOrderEvent(data);
                
                case 'product/created':
                case 'product/updated':
                case 'product/deleted':
                    return this.handleProductEvent(data);
                
                case 'store/redact':
                    return this.handleStoreDataDeletion(data);
                
                case 'customers/redact':
                    return this.handleCustomerDataDeletion(data);
                
                case 'customers/data_request':
                    return this.handleCustomerDataRequest(data);
                
                default:
                    console.warn('[Webhook] Evento não tratado:', data.event);
                    return null;
            }
        } catch (error) {
            console.error('[Webhook] Erro ao processar webhook:', error);
            return null;
        }
    }

    handleOrderEvent(data) {
        console.log(`[Webhook] Processando evento de pedido: ${data.event}`, {
            orderId: data.id,
            storeId: data.store_id
        });
        // Implementar lógica específica para eventos de pedido
    }

    handleProductEvent(data) {
        console.log(`[Webhook] Processando evento de produto: ${data.event}`, {
            productId: data.id,
            storeId: data.store_id
        });
        // Implementar lógica específica para eventos de produto
    }

    handleStoreDataDeletion(data) {
        console.log('[Webhook] Processando solicitação de exclusão de dados da loja', {
            storeId: data.store_id
        });
        // Implementar lógica de exclusão de dados da loja
    }

    handleCustomerDataDeletion(data) {
        console.log('[Webhook] Processando solicitação de exclusão de dados do cliente', {
            storeId: data.store_id,
            customerId: data.customer?.id,
            orders: data.orders_to_redact
        });
        // Implementar lógica de exclusão de dados do cliente
    }

    handleCustomerDataRequest(data) {
        console.log('[Webhook] Processando solicitação de dados do cliente', {
            storeId: data.store_id,
            customerId: data.customer?.id,
            orders: data.orders_requested,
            checkouts: data.checkouts_requested,
            drafts: data.drafts_orders_requested
        });
        // Implementar lógica de relatório de dados do cliente
    }

    extractMessageFromWebhook(webhookData) {
        try {
            console.log('[Webhook] Processando dados:', {
                type: webhookData?.type,
                hasBody: !!webhookData?.body,
                hasMessage: !!webhookData?.body?.message
            });

            // Validações básicas
            if (!webhookData?.body?.key?.remoteJid || !webhookData?.body?.message) {
                console.log('[Webhook] Dados inválidos:', webhookData);
                return null;
            }

            // Extrai dados básicos
            const messageData = {
                type: this.getMessageType(webhookData.body),
                from: webhookData.body.key.remoteJid.replace('@s.whatsapp.net', ''),
                messageId: webhookData.body.key.id,
                timestamp: webhookData.body.messageTimestamp,
                pushName: webhookData.body.pushName,
                device: webhookData.body.device,
                isGroup: webhookData.body.isGroup || false
            };

            // Extrai texto da mensagem
            const message = webhookData.body.message;
            messageData.text = message.conversation || 
                             message.extendedTextMessage?.text ||
                             message.imageMessage?.caption ||
                             message.documentMessage?.caption ||
                             null;

            // Adiciona dados da mídia se presente
            if (message.imageMessage) {
                messageData.imageMessage = message.imageMessage;
            }
            if (message.audioMessage) {
                messageData.audioMessage = message.audioMessage;
            }
            if (message.documentMessage) {
                messageData.documentMessage = message.documentMessage;
            }

            console.log('[Webhook] Mensagem extraída:', {
                type: messageData.type,
                from: messageData.from,
                messageId: messageData.messageId,
                hasText: !!messageData.text,
                textPreview: messageData.text?.substring(0, 100),
                hasImage: !!messageData.imageMessage,
                hasAudio: !!messageData.audioMessage,
                hasDocument: !!messageData.documentMessage,
                isGroup: messageData.isGroup
            });

            return messageData;
        } catch (error) {
            console.error('[Webhook] Erro ao extrair mensagem:', error);
            return null;
        }
    }

    getMessageType(webhookBody) {
        const message = webhookBody.message;
        if (!message) return 'unknown';

        if (message.conversation || message.extendedTextMessage) return 'text';
        if (message.imageMessage) return 'image';
        if (message.audioMessage) return 'audio';
        if (message.documentMessage) return 'document';
        
        return 'unknown';
    }

    async registerWebhook(event, url) {
        try {
            const response = await fetch(`${NUVEMSHOP_CONFIG.api.url}/webhooks`, {
                method: 'POST',
                headers: {
                    'Authentication': `bearer ${NUVEMSHOP_CONFIG.accessToken}`,
                    'Content-Type': 'application/json',
                    'User-Agent': this.userAgent
                },
                body: JSON.stringify({ event, url })
            });

            if (!response.ok) {
                throw new Error(`Erro ao registrar webhook: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('[Webhook] Erro ao registrar webhook:', error);
            throw error;
        }
    }
}

module.exports = { WebhookService };
