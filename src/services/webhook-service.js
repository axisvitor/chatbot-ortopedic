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

    async handleOrderEvent(data) {
        try {
            console.log(`[Webhook] Processando evento de pedido: ${data.event}`, {
                orderId: data.id,
                storeId: data.store_id
            });

            // Invalida cache do pedido
            await this.cacheService.invalidatePattern(`order:${data.id}`);

            // Notifica departamentos relevantes
            switch (data.event) {
                case 'order/created':
                    await this.notifyNewOrder(data);
                    break;
                case 'order/paid':
                    await this.notifyOrderPaid(data);
                    break;
                case 'order/cancelled':
                    await this.notifyOrderCancelled(data);
                    break;
            }

            return true;
        } catch (error) {
            console.error('[Webhook] Erro ao processar evento de pedido:', error);
            return false;
        }
    }

    async handleProductEvent(data) {
        try {
            console.log(`[Webhook] Processando evento de produto: ${data.event}`, {
                productId: data.id,
                storeId: data.store_id
            });

            // Invalida cache do produto
            await this.cacheService.invalidatePattern(`product:${data.id}`);

            // Atualiza índices de busca se necessário
            if (data.event === 'product/created' || data.event === 'product/updated') {
                await this.updateSearchIndex(data);
            } else if (data.event === 'product/deleted') {
                await this.removeFromSearchIndex(data);
            }

            return true;
        } catch (error) {
            console.error('[Webhook] Erro ao processar evento de produto:', error);
            return false;
        }
    }

    async handleStoreDataDeletion(data) {
        try {
            console.log('[Webhook] Processando solicitação de exclusão de dados da loja', {
                storeId: data.store_id
            });

            // Remove todos os dados da loja do cache
            await this.cacheService.invalidatePattern(`store:${data.store_id}`);

            // Remove dados da loja do banco
            await this.cleanupStoreData(data.store_id);

            return true;
        } catch (error) {
            console.error('[Webhook] Erro ao processar exclusão de dados da loja:', error);
            return false;
        }
    }

    async handleCustomerDataDeletion(data) {
        try {
            console.log('[Webhook] Processando solicitação de exclusão de dados do cliente', {
                storeId: data.store_id,
                customerId: data.customer?.id,
                orders: data.orders_to_redact
            });

            // Remove dados do cliente do cache
            await this.cacheService.invalidatePattern(`customer:${data.customer.id}`);

            // Remove dados dos pedidos associados
            if (data.orders_to_redact?.length > 0) {
                for (const orderId of data.orders_to_redact) {
                    await this.cacheService.invalidatePattern(`order:${orderId}`);
                }
            }

            // Remove dados do cliente do banco
            await this.cleanupCustomerData(data.customer.id, data.orders_to_redact);

            return true;
        } catch (error) {
            console.error('[Webhook] Erro ao processar exclusão de dados do cliente:', error);
            return false;
        }
    }

    async handleCustomerDataRequest(data) {
        try {
            console.log('[Webhook] Processando solicitação de dados do cliente', {
                storeId: data.store_id,
                customerId: data.customer?.id,
                orders: data.orders_requested,
                checkouts: data.checkouts_requested,
                drafts: data.drafts_orders_requested
            });

            // Coleta dados do cliente
            const customerData = await this.collectCustomerData(data);

            // Envia relatório para a loja
            await this.sendCustomerDataReport(data.store_id, customerData);

            return true;
        } catch (error) {
            console.error('[Webhook] Erro ao processar solicitação de dados do cliente:', error);
            return false;
        }
    }

    // Métodos auxiliares
    async notifyNewOrder(data) {
        try {
            const order = await this.nuvemshopService.getOrder(data.id);
            if (!order) return;

            // Formata a mensagem
            const message = `🛍️ *Novo Pedido #${order.number}*\n\n` +
                          `📅 Data: ${new Date(order.created_at).toLocaleString('pt-BR')}\n` +
                          `💰 Total: ${this.nuvemshopService.formatPrice(order.total)}\n` +
                          `👤 Cliente: ${order.customer.name}\n\n` +
                          `*Produtos:*\n${order.products.map(p => `▫️ ${p.quantity}x ${p.name}`).join('\n')}`;

            // Notifica departamentos relevantes via WhatsApp
            await this.whatsappService.sendMessage(process.env.SALES_DEPT_NUMBER, message);
            
            // Se for pedido internacional
            if (order.shipping_address?.country !== 'BR') {
                await this.whatsappService.forwardToFinancial(data, order.number);
            }

            console.log('[Webhook] Notificação de novo pedido enviada:', {
                orderId: order.number,
                total: order.total,
                customer: order.customer.name
            });
        } catch (error) {
            console.error('[Webhook] Erro ao notificar novo pedido:', error);
        }
    }

    async notifyOrderPaid(data) {
        try {
            const order = await this.nuvemshopService.getOrder(data.id);
            if (!order) return;

            // Formata a mensagem
            const message = `💳 *Pagamento Confirmado - Pedido #${order.number}*\n\n` +
                          `📅 Data Pagamento: ${new Date().toLocaleString('pt-BR')}\n` +
                          `💰 Valor: ${this.nuvemshopService.formatPrice(order.total)}\n` +
                          `💳 Forma: ${order.payment_details.method}\n` +
                          `👤 Cliente: ${order.customer.name}`;

            // Notifica o cliente
            if (order.customer.phone) {
                await this.whatsappService.sendMessage(
                    order.customer.phone,
                    `${message}\n\n_Obrigado pela sua compra! Em breve você receberá informações sobre o envio._`
                );
            }

            // Notifica equipe de expedição
            await this.whatsappService.sendMessage(process.env.SHIPPING_DEPT_NUMBER, message);

            console.log('[Webhook] Notificação de pagamento enviada:', {
                orderId: order.number,
                paymentMethod: order.payment_details.method,
                customer: order.customer.name
            });
        } catch (error) {
            console.error('[Webhook] Erro ao notificar pagamento:', error);
        }
    }

    async notifyOrderCancelled(data) {
        try {
            const order = await this.nuvemshopService.getOrder(data.id);
            if (!order) return;

            // Formata a mensagem
            const message = `❌ *Pedido Cancelado #${order.number}*\n\n` +
                          `📅 Data Cancelamento: ${new Date().toLocaleString('pt-BR')}\n` +
                          `💰 Valor: ${this.nuvemshopService.formatPrice(order.total)}\n` +
                          `❓ Motivo: ${order.cancel_reason || 'Não especificado'}\n` +
                          `👤 Cliente: ${order.customer.name}`;

            // Notifica departamentos relevantes
            await this.whatsappService.sendMessage(process.env.SALES_DEPT_NUMBER, message);
            await this.whatsappService.sendMessage(process.env.FINANCIAL_DEPT_NUMBER, message);

            // Se houver reembolso necessário
            if (order.financial_status === 'paid') {
                const refundMessage = `⚠️ *Atenção: Reembolso Necessário*\n\n` +
                                    `Pedido #${order.number} necessita de reembolso.\n` +
                                    `Valor: ${this.nuvemshopService.formatPrice(order.total)}\n` +
                                    `Método: ${order.payment_details.method}`;
                
                await this.whatsappService.sendMessage(process.env.FINANCIAL_DEPT_NUMBER, refundMessage);
            }

            console.log('[Webhook] Notificação de cancelamento enviada:', {
                orderId: order.number,
                reason: order.cancel_reason,
                requiresRefund: order.financial_status === 'paid'
            });
        } catch (error) {
            console.error('[Webhook] Erro ao notificar cancelamento:', error);
        }
    }

    async updateSearchIndex(data) {
        try {
            const product = await this.nuvemshopService.getProduct(data.id);
            if (!product) return;

            // Atualiza índices de busca no Redis
            const searchKey = `search:products:${product.id}`;
            const searchData = {
                id: product.id,
                name: product.name,
                sku: product.sku,
                price: product.price,
                categories: product.categories.map(c => c.name),
                tags: product.tags,
                updatedAt: new Date().toISOString()
            };

            await this.redisStore.set(searchKey, JSON.stringify(searchData));

            console.log('[Webhook] ��ndice de busca atualizado:', {
                productId: product.id,
                name: product.name
            });
        } catch (error) {
            console.error('[Webhook] Erro ao atualizar índice de busca:', error);
        }
    }

    async removeFromSearchIndex(data) {
        try {
            // Remove do índice de busca
            const searchKey = `search:products:${data.id}`;
            await this.redisStore.del(searchKey);

            console.log('[Webhook] Produto removido do índice:', {
                productId: data.id
            });
        } catch (error) {
            console.error('[Webhook] Erro ao remover do índice de busca:', error);
        }
    }

    async cleanupStoreData(storeId) {
        try {
            // Lista de padrões para limpar
            const patterns = [
                `store:${storeId}:*`,
                `products:${storeId}:*`,
                `orders:${storeId}:*`,
                `customers:${storeId}:*`,
                `search:${storeId}:*`
            ];

            // Remove todos os dados relacionados à loja
            for (const pattern of patterns) {
                const keys = await this.redisStore.keys(pattern);
                if (keys.length > 0) {
                    await Promise.all(keys.map(key => this.redisStore.del(key)));
                }
            }

            console.log('[Webhook] Dados da loja removidos:', {
                storeId,
                patternsProcessed: patterns.length
            });
        } catch (error) {
            console.error('[Webhook] Erro ao limpar dados da loja:', error);
        }
    }

    async cleanupCustomerData(customerId, orderIds) {
        try {
            // Remove dados do cliente
            await this.redisStore.del(`customers:${customerId}`);

            // Remove dados dos pedidos associados
            if (orderIds?.length > 0) {
                await Promise.all(orderIds.map(orderId => 
                    this.redisStore.del(`orders:${orderId}`)
                ));
            }

            console.log('[Webhook] Dados do cliente removidos:', {
                customerId,
                ordersRemoved: orderIds?.length || 0
            });
        } catch (error) {
            console.error('[Webhook] Erro ao limpar dados do cliente:', error);
        }
    }

    async sendCustomerDataReport(storeId, data) {
        try {
            // Formata o relatório
            const report = {
                timestamp: new Date().toISOString(),
                storeId,
                customer: {
                    id: data.customer.id,
                    name: data.customer.name,
                    email: data.customer.email,
                    phone: data.customer.phone,
                    document: data.customer.document
                },
                orders: data.orders,
                checkouts: data.checkouts,
                drafts: data.drafts
            };

            // Envia para o email da loja
            // Aqui você implementaria o envio do email com o relatório
            console.log('[Webhook] Relatório de dados preparado:', {
                storeId,
                customerId: data.customer.id,
                reportSize: JSON.stringify(report).length
            });

            return report;
        } catch (error) {
            console.error('[Webhook] Erro ao enviar relatório de dados:', error);
        }
    }

    extractMessageFromWebhook(webhookData) {
        try {
            console.log('🔍 [Webhook] Dados recebidos:', {
                tipo: webhookData?.type,
                temBody: !!webhookData?.body,
                temMensagem: !!webhookData?.body?.message,
                headers: webhookData?.headers,
                timestamp: new Date().toISOString()
            });

            // Validações básicas
            if (!webhookData?.body?.key?.remoteJid || !webhookData?.body?.message) {
                console.log('⚠️ [Webhook] Dados inválidos:', {
                    temRemoteJid: !!webhookData?.body?.key?.remoteJid,
                    temMessage: !!webhookData?.body?.message,
                    raw: JSON.stringify(webhookData, null, 2)
                });
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
                isGroup: webhookData.body.isGroup || false,
                text: webhookData.body.text || webhookData.body.message.conversation || null
            };

            console.log('📝 [Webhook] Dados básicos extraídos:', {
                tipo: messageData.type,
                de: messageData.from,
                messageId: messageData.messageId,
                texto: messageData.text,
                timestamp: new Date(messageData.timestamp * 1000).toISOString()
            });

            // Adiciona dados da mídia se presente
            const message = webhookData.body.message;
            if (message.imageMessage) {
                messageData.imageMessage = message.imageMessage;
                console.log('🖼️ [Webhook] Imagem detectada:', {
                    mimetype: message.imageMessage.mimetype,
                    caption: message.imageMessage.caption?.substring(0, 100)
                });
            }
            if (message.audioMessage) {
                messageData.audioMessage = message.audioMessage;
                console.log('🎵 [Webhook] Áudio detectado:', {
                    seconds: message.audioMessage.seconds,
                    mimetype: message.audioMessage.mimetype
                });
            }
            if (message.documentMessage) {
                messageData.documentMessage = message.documentMessage;
                console.log('📄 [Webhook] Documento detectado:', {
                    filename: message.documentMessage.fileName,
                    mimetype: message.documentMessage.mimetype
                });
            }

            console.log('✅ [Webhook] Mensagem processada:', {
                tipo: messageData.type,
                de: messageData.from,
                messageId: messageData.messageId,
                temTexto: !!messageData.text,
                textoPreview: messageData.text?.substring(0, 100),
                temImagem: !!messageData.imageMessage,
                temAudio: !!messageData.audioMessage,
                temDocumento: !!messageData.documentMessage,
                isGroup: messageData.isGroup,
                timestamp: new Date().toISOString()
            });

            return messageData;
        } catch (error) {
            console.error('❌ [Webhook] Erro ao extrair mensagem:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    getMessageType(webhookBody) {
        if (!webhookBody?.message) return 'unknown';

        // Verifica primeiro o texto direto do webhook
        if (webhookBody.text) return 'text';

        // Verifica a estrutura da mensagem
        const message = webhookBody.message;
        if (message.conversation) return 'text';
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
