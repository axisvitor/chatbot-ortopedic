const { NuvemshopApiBase } = require('./base');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const { CacheService } = require('../../../services/cache-service');

class OrderApi extends NuvemshopApiBase {
    constructor() {
        const cacheService = new CacheService();
        super(cacheService);
        
        this.cachePrefix = NUVEMSHOP_CONFIG.cache.prefix + 'order:';
        this.defaultFields = [
            'id',
            'number',
            'status',
            'payment_status',
            'shipping_status',
            'customer',
            'products',
            'shipping_tracking_number',
            'shipping_tracking_url'
        ].join(',');
    }

    // Validações
    validateOrderId(orderId) {
        if (!orderId || typeof orderId !== 'number') {
            throw new Error('ID do pedido inválido');
        }
    }

    validateOrderNumber(orderNumber) {
        if (!orderNumber || typeof orderNumber !== 'string') {
            throw new Error('Número do pedido inválido');
        }
    }

    validateDateRange(startDate, endDate) {
        if (startDate && !(startDate instanceof Date)) {
            throw new Error('Data inicial inválida');
        }
        if (endDate && !(endDate instanceof Date)) {
            throw new Error('Data final inválida');
        }
        if (startDate && endDate && startDate > endDate) {
            throw new Error('Data inicial não pode ser maior que a data final');
        }
    }

    // Métodos principais
    async getOrder(orderId) {
        this.validateOrderId(orderId);
        return this.handleRequest('get', `/orders/${orderId}`, {
            params: { fields: this.defaultFields }
        });
    }

    async getOrderByNumber(orderNumber) {
        this.validateOrderNumber(orderNumber);
        
        // Gera as chaves do cache
        const cacheKey = `${this.cachePrefix}number:${orderNumber}`;
        const idMapKey = `${this.cachePrefix}number_to_id:${orderNumber}`;
        
        // Tenta buscar do cache primeiro
        const cachedOrder = await this.cacheService.get(cacheKey);
        if (cachedOrder) {
            console.log('[Nuvemshop] Pedido encontrado no cache:', {
                numero: orderNumber,
                id: cachedOrder.id,
                status: cachedOrder.status,
                rastreio: cachedOrder.shipping_tracking_number
            });
            return cachedOrder;
        }

        try {
            // Tenta buscar o ID do pedido do cache
            const orderId = await this.cacheService.get(idMapKey);
            
            if (orderId) {
                console.log('[Nuvemshop] ID do pedido encontrado no cache:', {
                    numero: orderNumber,
                    id: orderId
                });

                try {
                    // Busca direta pelo ID
                    const order = await this.handleRequest('get', `/v1/${NUVEMSHOP_CONFIG.userId}/orders/${orderId}`);
                    
                    if (order && String(order.number) === String(orderNumber)) {
                        // Salva no cache por 5 minutos
                        await this.cacheService.set(cacheKey, order, 300);
                        
                        console.log('[Nuvemshop] Pedido encontrado pelo ID:', {
                            numero: orderNumber,
                            id: order.id,
                            status: order.status,
                            rastreio: order.shipping_tracking_number
                        });
                        
                        return order;
                    } else {
                        // Remove o ID inválido do cache
                        await this.cacheService.delete(idMapKey);
                    }
                } catch (error) {
                    if (error.response?.status === 404) {
                        // Remove o ID inválido do cache
                        await this.cacheService.delete(idMapKey);
                    } else {
                        throw error;
                    }
                }
            }

            // Se não encontrou pelo ID, busca pelo número
            const orders = await this.handleRequest('get', `/v1/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: { 
                    q: orderNumber,
                    fields: this.defaultFields
                }
            });
            
            if (!orders || !Array.isArray(orders)) {
                console.log('[Nuvemshop] Resposta inválida:', orders);
                return null;
            }

            // Encontra o pedido com o número exato
            const order = orders.find(o => String(o.number) === String(orderNumber));
            
            if (order) {
                // Salva o pedido no cache por 5 minutos
                await this.cacheService.set(cacheKey, order, 300);
                
                // Salva o mapeamento número -> id por 1 dia
                await this.cacheService.set(idMapKey, order.id, 86400);
                
                console.log('[Nuvemshop] Pedido encontrado e salvo no cache:', {
                    numero: orderNumber,
                    id: order.id,
                    status: order.status,
                    rastreio: order.shipping_tracking_number
                });
                
                return order;
            }

            console.log('[Nuvemshop] Pedido não encontrado:', {
                numero: orderNumber,
                resultados: orders.length
            });
            
            return null;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar pedido:', {
                numero: orderNumber,
                erro: error.message,
                status: error.response?.status,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    async searchOrders(params = {}) {
        const searchParams = {
            fields: this.defaultFields,
            ...params
        };

        if (params.startDate || params.endDate) {
            this.validateDateRange(params.startDate, params.endDate);
            searchParams.created_at_min = params.startDate?.toISOString();
            searchParams.created_at_max = params.endDate?.toISOString();
        }

        return this.handleRequest('get', `/v1/${NUVEMSHOP_CONFIG.userId}/orders`, { params: searchParams });
    }

    // Métodos de atualização
    async updateOrderStatus(orderId, status, options = {}) {
        this.validateOrderId(orderId);
        if (!status || typeof status !== 'string') {
            throw new Error('Status inválido');
        }

        const data = {
            status,
            ...options
        };

        return this.handleRequest('put', `${NUVEMSHOP_CONFIG.endpoint}/orders/${orderId}`, { data });
    }

    async updateShippingInfo(orderId, trackingNumber, carrier = null) {
        this.validateOrderId(orderId);
        if (!trackingNumber || typeof trackingNumber !== 'string') {
            throw new Error('Número de rastreio inválido');
        }

        const data = {
            shipping_tracking_number: trackingNumber,
            ...(carrier && { shipping_carrier: carrier })
        };

        return this.handleRequest('put', `${NUVEMSHOP_CONFIG.endpoint}/orders/${orderId}`, { data });
    }

    async addOrderNote(orderId, note) {
        this.validateOrderId(orderId);
        if (!note || typeof note !== 'string') {
            throw new Error('Nota inválida');
        }

        const data = { note };
        return this.handleRequest('put', `${NUVEMSHOP_CONFIG.endpoint}/orders/${orderId}`, { data });
    }

    // Métodos de consulta específicos
    async getRecentOrders(days = 7) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        return this.searchOrders({
            startDate,
            endDate,
            sort: '-created_at'
        });
    }

    async getPendingOrders() {
        return this.searchOrders({
            status: ['pending', 'authorized', 'partially_paid'],
            sort: 'created_at'
        });
    }

    async getOrdersByCustomer(customerId) {
        if (!customerId) {
            throw new Error('ID do cliente inválido');
        }

        return this.searchOrders({
            customer_id: customerId,
            sort: '-created_at'
        });
    }

    // Métodos de formatação
    formatOrderStatus(status) {
        const statusMap = {
            'pending': '⏳ Pendente',
            'authorized': '✅ Autorizado',
            'partially_paid': '💰 Parcialmente Pago',
            'paid': '💳 Pago',
            'voided': '❌ Cancelado',
            'refunded': '↩️ Reembolsado',
            'shipped': '📦 Enviado',
            'delivered': '🏠 Entregue'
        };
        return statusMap[status] || status;
    }

    formatShippingStatus(status) {
        const statusMap = {
            'pending': '⏳ Aguardando',
            'ready': '📦 Pronto para Envio',
            'shipped': '🚚 Em Trânsito',
            'delivered': '✅ Entregue',
            'returned': '↩️ Devolvido'
        };
        return statusMap[status] || status;
    }

    async getOrderByNumberNew(orderNumber) {
        try {
            const cacheKey = `order:${orderNumber}`;
            const cachedOrder = await this.cacheService.get(cacheKey);
            
            if (cachedOrder) {
                console.log('📦 Pedido encontrado em cache:', {
                    numero: orderNumber,
                    timestamp: new Date().toISOString()
                });
                return cachedOrder;
            }

            const response = await this.get(`${NUVEMSHOP_CONFIG.endpoint}/${orderNumber}`);
            if (response && response.data) {
                await this.cacheService.set(cacheKey, response.data, 3600); // Cache por 1 hora
                return response.data;
            }
            return null;
        } catch (error) {
            console.error('❌ Erro ao buscar pedido:', {
                numero: orderNumber,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    formatOrderStatusNew(status) {
        const statusMap = {
            'pending': '⏳ Aguardando pagamento',
            'paid': '✅ Pago',
            'authorized': '✅ Autorizado',
            'refunded': '↩️ Reembolsado',
            'voided': '❌ Cancelado',
            'failed': '❌ Falhou',
            'in_process': '🏭 Em processamento',
            'in_separation': '📦 Em separação',
            'ready_for_shipping': '📦 Pronto para envio',
            'shipped': '🚚 Enviado',
            'delivered': '✅ Entregue',
            'canceled': '❌ Cancelado'
        };
        
        return statusMap[status] || `❓ ${status}`;
    }

    formatPrice(price) {
        if (!price) return 'R$ 0,00';
        
        const value = price / 100;
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    }

    // Métodos auxiliares
    calculateDeliveryEstimate(order) {
        if (!order.shipping_min_days || !order.shipping_max_days) {
            return null;
        }

        const shippedDate = order.shipped_at ? new Date(order.shipped_at) : new Date();
        const minDeliveryDate = new Date(shippedDate);
        const maxDeliveryDate = new Date(shippedDate);

        minDeliveryDate.setDate(minDeliveryDate.getDate() + order.shipping_min_days);
        maxDeliveryDate.setDate(maxDeliveryDate.getDate() + order.shipping_max_days);

        return {
            min: minDeliveryDate,
            max: maxDeliveryDate,
            formatted: `${minDeliveryDate.toLocaleDateString('pt-BR')} - ${maxDeliveryDate.toLocaleDateString('pt-BR')}`
        };
    }
}

module.exports = { OrderApi };
