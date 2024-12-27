const { OrderApi } = require('./nuvemshop/api/order');
const { RedisStore } = require('../store/redis-store');
const { TrackingService } = require('./tracking-service');
const { formatTimeAgo } = require('../utils/date-utils');
const { NUVEMSHOP_CONFIG } = require('../config/settings');

class OrderValidationService {
    constructor(nuvemshopClient = null) {
        this.orderApi = new OrderApi(nuvemshopClient);
        this.redisStore = new RedisStore();
        this.trackingService = new TrackingService();
        this.MAX_ATTEMPTS = 5; // Limite de tentativas por usuário
        this.BLOCK_TIME = 1800; // 30 minutos em segundos
        this.CACHE_TTL = NUVEMSHOP_CONFIG.cache.ttl.orders.recent; // 5 minutos para pedidos recentes
    }

    /**
     * Verifica tentativas de validação do usuário
     * @param {string} phoneNumber - Número do WhatsApp
     * @returns {Promise<boolean>} - Se o usuário está bloqueado
     */
    async checkAttempts(phoneNumber) {
        const key = `validation_attempts:${phoneNumber}`;
        const attempts = await this.redisStore.get(key) || 0;
        
        if (attempts >= this.MAX_ATTEMPTS) {
            return true;
        }
        return false;
    }

    /**
     * Incrementa tentativas de validação
     * @param {string} phoneNumber - Número do WhatsApp
     */
    async incrementAttempts(phoneNumber) {
        const key = `validation_attempts:${phoneNumber}`;
        const attempts = await this.redisStore.get(key) || 0;
        await this.redisStore.set(key, attempts + 1, this.BLOCK_TIME);
    }

    /**
     * Reseta tentativas de validação
     * @param {string} phoneNumber - Número do WhatsApp
     */
    async resetAttempts(phoneNumber) {
        const key = `validation_attempts:${phoneNumber}`;
        await this.redisStore.del(key);
    }

    /**
     * Verifica se o texto é um número de pedido válido
     * @param {string} text - Texto a ser verificado
     * @returns {boolean} True se for número de pedido válido
     */
    isValidOrderNumber(text) {
        if (!text) return false;
        
        // Remove caracteres especiais e espaços
        const cleanText = text.replace(/[^0-9]/g, '');
        
        // Verifica se é um número com pelo menos 4 dígitos
        return /^\d{4,}$/.test(cleanText);
    }

    /**
     * Extrai número do pedido do texto
     * @param {string} text - Texto com número do pedido
     * @returns {string|null} Número do pedido ou null
     */
    extractOrderNumber(text) {
        if (!text) return null;
        
        // Remove caracteres especiais e espaços
        const cleanText = text.replace(/[^0-9]/g, '');
        
        // Retorna se for um número válido
        if (this.isValidOrderNumber(cleanText)) {
            return cleanText;
        }
        
        return null;
    }

    /**
     * Valida número do pedido
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<Object|null>} Pedido ou null se não encontrado
     */
    async validateOrderNumber(orderNumber) {
        try {
            // Remove caracteres especiais e espaços
            const cleanNumber = String(orderNumber).replace(/[^0-9]/g, '');
            
            // Valida o formato do número
            if (!this.isValidOrderNumber(cleanNumber)) {
                console.log('❌ Número de pedido inválido:', {
                    numero: cleanNumber,
                    numeroOriginal: orderNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }
            
            console.log('🔍 Validando pedido:', {
                numero: cleanNumber,
                numeroOriginal: orderNumber,
                timestamp: new Date().toISOString()
            });

            // Busca o pedido
            const order = await this.orderApi.getOrderByNumber(cleanNumber);
            
            if (!order) {
                console.log('❌ Pedido não encontrado:', {
                    numero: cleanNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Se tem código de rastreio, busca informações atualizadas
            let trackingDetails = null;
            if (order.shipping_tracking_number) {
                try {
                    console.log('🔍 Buscando rastreamento:', {
                        codigo: order.shipping_tracking_number,
                        timestamp: new Date().toISOString()
                    });
                    
                    trackingDetails = await this.trackingService.getTrackingInfo(order.shipping_tracking_number);
                    
                    if (trackingDetails?.success) {
                        console.log('✅ Rastreamento encontrado:', {
                            codigo: order.shipping_tracking_number,
                            status: trackingDetails.status,
                            ultima_atualizacao: trackingDetails.lastEvent?.time,
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (error) {
                    console.error('⚠️ Erro ao buscar rastreamento:', {
                        codigo: order.shipping_tracking_number,
                        erro: error.message,
                        timestamp: new Date().toISOString()
                    });
                    // Não falha se o rastreamento der erro
                }
            }

            // Formata as informações com os detalhes de rastreamento
            return this.formatSafeOrderInfo(order, trackingDetails);
        } catch (error) {
            console.error('❌ Erro ao validar pedido:', {
                erro: error.message,
                numero: orderNumber,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Formata informações seguras do pedido
     * @param {Object} order - Pedido completo
     * @param {Object} trackingDetails - Detalhes do rastreamento
     * @returns {Object} Informações seguras do pedido
     */
    formatSafeOrderInfo(order, trackingDetails = null) {
        try {
            // Garantir que temos os dados mínimos
            if (!order || !order.number) {
                throw new Error('Dados do pedido incompletos');
            }

            // Tradução de status
            const statusMap = {
                'open': 'Aberto',
                'closed': 'Fechado',
                'cancelled': 'Cancelado',
                'shipped': 'Enviado',
                'pending': 'Pendente',
                'paid': 'Pago',
                'voided': 'Cancelado'
            };

            // Formata status de envio
            let shippingStatus = 'Não disponível';
            if (order.shipping_status) {
                shippingStatus = statusMap[order.shipping_status.toLowerCase()] || order.shipping_status;
            } else if (order.fulfillments && order.fulfillments.length > 0) {
                const lastFulfillment = order.fulfillments[order.fulfillments.length - 1];
                if (lastFulfillment.status) {
                    shippingStatus = statusMap[lastFulfillment.status.toLowerCase()] || lastFulfillment.status;
                }
            }

            // Formata status de pagamento
            const paymentStatus = statusMap[order.payment_status] || 'Não disponível';

            // Formata data
            const orderDate = order.created_at 
                ? new Date(order.created_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'Não disponível';

            // Formata valor total
            const orderTotal = order.total 
                ? new Intl.NumberFormat('pt-BR', { 
                    style: 'currency', 
                    currency: order.currency || 'BRL' 
                  }).format(order.total)
                : 'Não disponível';

            // Formata produtos
            const products = Array.isArray(order.products) 
                ? order.products.map(product => ({
                    nome: product.name,
                    quantidade: product.quantity,
                    preco: new Intl.NumberFormat('pt-BR', { 
                        style: 'currency', 
                        currency: order.currency || 'BRL' 
                    }).format(product.price)
                  }))
                : [];

            // Formata rastreamento com detalhes do 17Track
            const tracking = {
                codigo: order.shipping_tracking_number || 'Não disponível',
                status: 'Não disponível',
                ultima_atualizacao: null,
                detalhes: null
            };

            // Se tiver detalhes do 17Track, adiciona as informações
            if (trackingDetails?.success) {
                tracking.status = trackingDetails.status || tracking.status;
                tracking.ultima_atualizacao = trackingDetails.lastEvent?.time || null;
                tracking.detalhes = trackingDetails.lastEvent?.description || null;
            }

            return {
                numero_pedido: order.number,
                cliente: order.customer?.name || 'Não disponível',
                data: orderDate,
                status: statusMap[order.status] || order.status,
                valor_total: orderTotal,
                produtos: products,
                status_envio: shippingStatus,
                rastreamento: tracking
            };

        } catch (error) {
            console.error('❌ Erro ao formatar pedido:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Formata mensagem de rastreamento
     * @param {string} trackingNumber - Código de rastreio
     * @returns {string} Mensagem formatada
     */
    formatTrackingMessage(trackingNumber) {
        if (!trackingNumber) return null;

        return `🚚 *Rastreamento do Pedido*\n\n` +
            `📦 Código de Rastreio: ${trackingNumber}\n\n` +
            `🔍 Acompanhe seu pedido em:\n` +
            `https://t.17track.net/pt-br#nums=${trackingNumber}\n\n` +
            `_Clique no link acima para ver o status atualizado da entrega_`;
    }

    /**
     * Formata mensagem de pedido para WhatsApp
     * @param {Object} orderInfo - Informações seguras do pedido
     * @param {string} userPhone - Telefone do usuário
     * @returns {string} Mensagem formatada
     */
    async formatOrderMessage(orderInfo, userPhone = null) {
        try {
            // Log das informações que serão formatadas
            console.log('📋 Formatando mensagem:', {
                numero: orderInfo.numero_pedido,
                cliente: orderInfo.cliente,
                status: orderInfo.status,
                rastreio: orderInfo.rastreamento?.codigo,
                produtos: orderInfo.produtos?.length,
                timestamp: new Date().toISOString()
            });

            // Monta mensagem base
            let message = `🛍️ *Detalhes do Pedido #${orderInfo.numero_pedido}*\n\n`;
            message += `👤 Cliente: ${orderInfo.cliente}\n`;
            message += `📅 Data: ${orderInfo.data}\n`;
            message += `📦 Status: ${orderInfo.status}\n`;
            message += `💰 Valor Total: ${orderInfo.valor_total}\n\n`;
            
            // Lista de produtos
            if (Array.isArray(orderInfo.produtos) && orderInfo.produtos.length > 0) {
                message += `*Produtos:*\n`;
                orderInfo.produtos.forEach(produto => {
                    message += `▫️ ${produto.quantidade}x ${produto.nome} - ${produto.preco}\n`;
                });
            }

            // Status de envio e rastreamento
            message += `\n📦 Status do Envio: ${orderInfo.status_envio}`;

            // Se tem código de rastreio, busca atualizações
            if (orderInfo.rastreamento?.codigo !== 'Não disponível') {
                const trackingInfo = await this.trackingService.getTrackingInfo(orderInfo.rastreamento.codigo);
                
                message += `\n📬 Rastreamento: ${orderInfo.rastreamento.codigo}`;

                if (trackingInfo?.events?.length > 0) {
                    const lastEvent = trackingInfo.events[0];
                    message += `\n📍 Status: ${lastEvent.description}`;
                    message += `\n🕒 Última Atualização: ${new Date(lastEvent.timestamp).toLocaleString('pt-BR')}`;
                    if (lastEvent.location) {
                        message += `\n📌 Local: ${lastEvent.location}`;
                    }
                }
            }

            return message;
        } catch (error) {
            console.error('❌ Erro ao formatar mensagem:', error);
            throw error;
        }
    }

    /**
     * Busca e formata status de rastreamento
     * @param {string} trackingNumber - Código de rastreio
     * @returns {Promise<string>} Mensagem formatada com status atual
     */
    async getTrackingStatus(trackingNumber) {
        return this.trackingService.getTrackingStatus(trackingNumber);
    }

    formatOrderTrackingResponse(trackingInfo) {
        if (!trackingInfo) return null;

        // Remove ponto e vírgula extra da URL se existir
        if (trackingInfo.url) {
            trackingInfo.url = trackingInfo.url.replace(/;$/, '');
        }

        return `🚚 *Status do Rastreamento*\n\n` +
            `📦 Código: ${trackingInfo.code}\n` +
            `📍 Status: ${trackingInfo.status}\n` +
            `Última atualização: ${new Date().toLocaleString('pt-BR')}`;
    }
}

module.exports = { OrderValidationService }; 