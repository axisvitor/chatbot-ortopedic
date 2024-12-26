const { NuvemshopApiBase } = require('./base');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');

class OrderApi extends NuvemshopApiBase {
    constructor() {
        super();
        this.cachePrefix = NUVEMSHOP_CONFIG.cache.prefix + 'order:';
        this.defaultFields = [
            'id',
            'number',
            'status',
            'total',
            'created_at',
            'updated_at',
            'completed_at',
            'cancel_reason',
            'customer',
            'shipping',
            'shipping_status',
            'shipping_tracking_number',
            'shipping_min_days',
            'shipping_max_days',
            'payment_details',
            'products',
            'note'
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
        const params = {
            q: orderNumber,
            fields: this.defaultFields
        };

        const orders = await this.handleRequest('get', '/orders', { params });
        return orders.find(order => order.number === orderNumber);
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

        return this.handleRequest('get', '/orders', { params: searchParams });
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

        return this.handleRequest('put', `/orders/${orderId}`, { data });
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

        return this.handleRequest('put', `/orders/${orderId}`, { data });
    }

    async addOrderNote(orderId, note) {
        this.validateOrderId(orderId);
        if (!note || typeof note !== 'string') {
            throw new Error('Nota inválida');
        }

        const data = { note };
        return this.handleRequest('put', `/orders/${orderId}`, { data });
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

            const response = await this.get(`${this.endpoint}/${orderNumber}`);
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
