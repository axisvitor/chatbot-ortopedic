const { NuvemshopApiBase } = require('./base');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const { CacheService } = require('../../../services/cache-service');

class OrderApi extends NuvemshopApiBase {
    constructor(client = null) {
        const cacheService = new CacheService();
        super(client, cacheService);
        
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
        // Converte para número se for string
        const numericId = typeof orderId === 'string' ? parseInt(orderId, 10) : orderId;
        
        if (!numericId || isNaN(numericId)) {
            throw new Error('ID do pedido inválido');
        }
        
        return numericId; // Retorna o ID convertido
    }

    validateOrderNumber(orderNumber) {
        if (!orderNumber || (typeof orderNumber !== 'string' && typeof orderNumber !== 'number')) {
            throw new Error('Número do pedido inválido');
        }
        return orderNumber.toString(); // Garante que é string
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
    async getOrderByNumber(orderNumber) {
        this.validateOrderNumber(orderNumber);
        
        // Gera as chaves do cache
        const cacheKey = `${this.cachePrefix}number:${orderNumber}`;
        
        // Tenta buscar do cache primeiro
        const cachedOrder = await this.cacheService.get(cacheKey);
        if (cachedOrder) {
            console.log('[Nuvemshop] Pedido encontrado no cache:', {
                numero: orderNumber,
                timestamp: new Date().toISOString()
            });
            return JSON.parse(cachedOrder);
        }

        try {
            console.log('[Nuvemshop] Buscando pedido:', {
                numero: orderNumber,
                timestamp: new Date().toISOString()
            });

            // Busca pelo endpoint correto de busca
            const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/orders/search`, {
                params: {
                    q: orderNumber,
                    fields: this.defaultFields
                }
            });

            if (!response?.data || !Array.isArray(response.data) || response.data.length === 0) {
                console.log('[Nuvemshop] Pedido não encontrado:', {
                    numero: orderNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Como filtramos pelo número exato, deve retornar apenas um pedido
            const order = response.data[0];
            
            // Salva no cache por 5 minutos
            await this.cacheService.set(cacheKey, JSON.stringify(order), 300);
            
            console.log('[Nuvemshop] Pedido encontrado:', {
                numero: orderNumber,
                id: order.id,
                status: order.status,
                rastreio: order.shipping_tracking_number
            });
            
            return order;

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

    async getOrder(orderId) {
        const numericId = this.validateOrderId(orderId);
        
        // Tenta buscar do cache primeiro
        const cacheKey = `${this.cachePrefix}${numericId}`;
        const cachedOrder = await this.cacheService.get(cacheKey);
        if (cachedOrder) {
            console.log('[Nuvemshop] Pedido encontrado no cache:', {
                id: numericId,
                timestamp: new Date().toISOString()
            });
            return JSON.parse(cachedOrder);
        }

        try {
            console.log('[Nuvemshop] Buscando pedido:', {
                id: numericId,
                timestamp: new Date().toISOString()
            });

            // Busca direta pelo ID
            const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/orders/${numericId}`, {
                params: {
                    fields: this.defaultFields
                }
            });

            if (response?.data) {
                // Salva no cache
                await this.cacheService.set(
                    cacheKey, 
                    JSON.stringify(response.data),
                    NUVEMSHOP_CONFIG.cache.ttl
                );
                return response.data;
            }

            return null;
        } catch (error) {
            if (error.response?.status === 404) {
                console.log('[Nuvemshop] Pedido não encontrado:', {
                    id: numericId,
                    timestamp: new Date().toISOString()
                });
                return null;
            }
            console.error('[Nuvemshop] Erro ao buscar pedido:', {
                id: numericId,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    async searchOrders(params = {}) {
        try {
            const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: {
                    fields: this.defaultFields,
                    per_page: params.per_page || 50,
                    page: params.page || 1,
                    created_at_min: params.created_at_min,
                    created_at_max: params.created_at_max,
                    updated_at_min: params.updated_at_min,
                    updated_at_max: params.updated_at_max,
                    since_id: params.since_id
                }
            });

            return response.data || [];
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar pedidos:', {
                params,
                erro: error.message,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    async getRecentOrders(days = 7) {
        const minDate = new Date();
        minDate.setDate(minDate.getDate() - days);

        return this.searchOrders({
            created_at_min: minDate.toISOString(),
            per_page: 50,
            sort_by: 'created_at',
            sort_direction: 'desc'
        });
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

        return this.handleRequest('put', `/v1/${NUVEMSHOP_CONFIG.userId}/orders/${orderId}`, { data });
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

        return this.handleRequest('put', `/v1/${NUVEMSHOP_CONFIG.userId}/orders/${orderId}`, { data });
    }

    async addOrderNote(orderId, note) {
        this.validateOrderId(orderId);
        if (!note || typeof note !== 'string') {
            throw new Error('Nota inválida');
        }

        const data = { note };
        return this.handleRequest('put', `/v1/${NUVEMSHOP_CONFIG.userId}/orders/${orderId}`, { data });
    }

    // Métodos de consulta específicos
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

            const response = await this.get(`/v1/${NUVEMSHOP_CONFIG.userId}/orders/${orderNumber}`);
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

    async handleRequest(method, endpoint, options = {}) {
        const requestConfig = {
            method,
            url: `/v1/${NUVEMSHOP_CONFIG.userId}${endpoint}`,
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authentication': `bearer ${NUVEMSHOP_CONFIG.accessToken}`,
                'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)',
                ...options.headers
            }
        };

        try {
            console.log('[Nuvemshop] Request:', {
                ...requestConfig,
                headers: {
                    ...requestConfig.headers,
                    Authentication: '[REDACTED]'
                }
            });

            const response = await this.client(requestConfig);
            return response.data;
        } catch (error) {
            // Log detalhado do erro
            console.log('[Nuvemshop] Erro na response:', {
                status: error.response?.status,
                data: error.response?.data,
                url: endpoint
            });

            // Trata erros específicos
            if (error.response?.status === 401) {
                console.error('[Nuvemshop] Erro de autenticação. Verifique o token de acesso.');
                throw new Error('Erro de autenticação na API da Nuvemshop');
            }

            if (error.response?.status === 404) {
                return null;
            }

            // Propaga outros erros
            throw error;
        }
    }
}

module.exports = { OrderApi };
