const moment = require('moment-timezone');
const logger = require('../../../utils/logger');
const { NuvemshopBase } = require('../base');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');

class OrderService extends NuvemshopBase {
    constructor(cacheService) {
        super(cacheService);
    }

    /**
     * Busca pedido por número
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<Object>} Pedido encontrado
     */
    async getOrderByNumber(orderNumber) {
        try {
            logger.debug('BuscandoPedidoPorNumero', {
                numero: orderNumber,
                timestamp: new Date().toISOString()
            });
            
            // Remove caracteres não numéricos
            const cleanNumber = String(orderNumber).replace(/\D/g, '');
            
            // Busca usando o endpoint de busca geral primeiro
            const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: {
                    q: cleanNumber,
                    fields: 'id,number,status,payment_status,shipping_status,customer,products,shipping_tracking_number,shipping_tracking_url'
                }
            });

            if (response.status === 200 && response.data) {
                // Encontra o pedido com o número exato
                const order = Array.isArray(response.data) ? 
                    response.data.find(o => String(o.number) === cleanNumber) :
                    (String(response.data.number) === cleanNumber ? response.data : null);

                if (order) {
                    logger.info('PedidoEncontrado', {
                        numeroOriginal: orderNumber,
                        numeroLimpo: cleanNumber,
                        id: order.id,
                        status: order.status,
                        rastreio: order.shipping_tracking_number,
                        timestamp: new Date().toISOString()
                    });
                    return order;
                }
            }
            
            // Se não encontrou, tenta buscar diretamente pelo número
            const directResponse = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: {
                    number: cleanNumber,
                    fields: 'id,number,status,payment_status,shipping_status,customer,products,shipping_tracking_number,shipping_tracking_url'
                }
            });

            if (directResponse.status === 200 && directResponse.data) {
                const order = Array.isArray(directResponse.data) ?
                    directResponse.data[0] :
                    directResponse.data;

                if (order) {
                    logger.info('PedidoEncontradoBuscaDireta', {
                        numeroOriginal: orderNumber,
                        numeroLimpo: cleanNumber,
                        id: order.id,
                        status: order.status,
                        rastreio: order.shipping_tracking_number,
                        timestamp: new Date().toISOString()
                    });
                    return order;
                }
            }

            logger.warn('PedidoNaoEncontrado', {
                numero: orderNumber,
                timestamp: new Date().toISOString()
            });
            return null;
        } catch (error) {
            logger.error('ErroBuscarPedido', {
                erro: error.message,
                stack: error.stack,
                pedido: orderNumber,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Busca pedidos recentes por telefone
     * @param {string} phone - Telefone para busca
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de pedidos
     */
    async getRecentOrdersByPhone(phone, options = {}) {
        try {
            // Remove caracteres não numéricos
            const cleanPhone = phone.replace(/\D/g, '');
            
            // Busca pedidos dos últimos 30 dias
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const params = {
                created_at_min: thirtyDaysAgo.toISOString(),
                per_page: options.per_page || 10,
                page: options.page || 1,
                status: options.status || ['pending', 'paid', 'packed', 'shipped']
            };

            const { data: orders } = await this.getOrders(params);

            // Filtra por telefone
            const filteredOrders = orders.filter(order => {
                const customerPhone = order.customer?.phone?.replace(/\D/g, '');
                return customerPhone && customerPhone.includes(cleanPhone);
            });

            logger.info('PedidosEncontradosPorTelefone', {
                telefone: phone,
                total: filteredOrders.length,
                timestamp: new Date().toISOString()
            });

            return filteredOrders;
        } catch (error) {
            logger.error('ErroBuscarPedidosPorTelefone', {
                erro: error.message,
                stack: error.stack,
                telefone: phone,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    /**
     * Verifica se o pedido está com pagamento pendente
     * @param {string} orderId - ID do pedido
     * @returns {Promise<boolean>} true se pagamento pendente
     */
    async isOrderPendingPayment(orderId) {
        try {
            const order = await this.getOrder(orderId);
            return order && order.payment_status === 'pending';
        } catch (error) {
            logger.error('ErroVerificarStatusPagamento', {
                erro: error.message,
                stack: error.stack,
                pedidoId: orderId,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Busca pedidos com paginação
     * @param {Object} options - Opções de busca
     * @returns {Promise<Object>} Pedidos e informações de paginação
     */
    async getOrders(options = {}) {
        const cacheKey = this.generateCacheKey('orders', 'list', options);
        return this.getCachedData(
            cacheKey,
            async () => {
                const params = {
                    page: options.page || 1,
                    per_page: Math.min(options.per_page || 50, 200),
                    ...options
                };

                const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, { params });
                
                return {
                    data: response.data,
                    pagination: {
                        total: parseInt(response.headers['x-total-count'] || 0),
                        currentPage: params.page,
                        perPage: params.per_page,
                        links: this.parseLinkHeader(response.headers.link)
                    }
                };
            },
            NUVEMSHOP_CONFIG.cache.ordersTtl
        );
    }

    /**
     * Busca detalhes específicos do pedido
     */
    async getOrderTracking(orderId) {
        const order = await this.getOrder(orderId);
        return order?.shipping_tracking || null;
    }

    async getOrderTotal(orderId) {
        const order = await this.getOrder(orderId);
        return order?.total || 0;
    }

    async getOrderPaymentStatus(orderId) {
        const order = await this.getOrder(orderId);
        return order?.payment_status || null;
    }

    async getOrderFinancialStatus(orderId) {
        const order = await this.getOrder(orderId);
        return order?.financial_status || null;
    }

    async getOrderShippingAddress(orderId) {
        const order = await this.getOrder(orderId);
        return order?.shipping_address || null;
    }

    async getOrderBillingAddress(orderId) {
        const order = await this.getOrder(orderId);
        return order?.billing_address || null;
    }

    async getOrderItems(orderId) {
        const order = await this.getOrder(orderId);
        return order?.products || [];
    }

    async getOrderCustomer(orderId) {
        const order = await this.getOrder(orderId);
        return order?.customer || null;
    }

    async getOrderShippingMethod(orderId) {
        const order = await this.getOrder(orderId);
        return order?.shipping_option || null;
    }

    async getOrderShippingCost(orderId) {
        const order = await this.getOrder(orderId);
        return order?.shipping_cost || 0;
    }

    async getOrderSubtotal(orderId) {
        const order = await this.getOrder(orderId);
        return order?.subtotal || 0;
    }

    /**
     * Busca pedido por código de rastreamento
     * @param {string} trackingNumber - Código de rastreamento
     * @returns {Promise<Object|null>} Pedido encontrado ou null
     */
    async getOrderByTrackingNumber(trackingNumber) {
        try {
            const { data: orders } = await this.getOrders({
                shipping_tracking_number: trackingNumber
            });

            if (!orders || orders.length === 0) {
                logger.warn('PedidoNaoEncontradoPorRastreio', {
                    rastreio: trackingNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Retorna o pedido mais recente se houver múltiplos
            const order = orders[0];
            logger.info('PedidoEncontradoPorRastreio', {
                trackingNumber,
                orderId: order.id,
                status: order.status,
                timestamp: new Date().toISOString()
            });

            return order;
        } catch (error) {
            logger.error('ErroBuscarPedidoPorRastreio', {
                rastreio: trackingNumber,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }
}

module.exports = { OrderService };
