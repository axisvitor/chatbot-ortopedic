const axios = require('axios');
const { NUVEMSHOP_CONFIG } = require('../config/settings');
const { CacheService } = require('./cache-service');

class NuvemshopService {
    constructor() {
        this.client = null;
        this.cacheService = new CacheService();
        this.initializeClient();
    }

    initializeClient() {
        this.client = axios.create({
            baseURL: `${NUVEMSHOP_CONFIG.api.url}/v1/${NUVEMSHOP_CONFIG.userId}`,
            headers: {
                'Authentication': `bearer ${NUVEMSHOP_CONFIG.accessToken}`,
                'Content-Type': 'application/json; charset=utf-8',
                'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)'
            },
            timeout: NUVEMSHOP_CONFIG.api.timeout
        });

        this.setupInterceptors();
    }

    setupInterceptors() {
        this.client.interceptors.response.use(
            response => response,
            async error => {
                if (error.response) {
                    const { status, data } = error.response;
                    
                    switch (status) {
                        case 400:
                            console.error('[Nuvemshop] Erro de JSON inválido:', data);
                            break;
                        case 402:
                            console.error('[Nuvemshop] Pagamento necessário. API inacessível.');
                            break;
                        case 415:
                            console.error('[Nuvemshop] Content-Type inválido');
                            break;
                        case 422:
                            console.error('[Nuvemshop] Campos inválidos:', data);
                            break;
                        case 429:
                            console.error('[Nuvemshop] Limite de taxa excedido');
                            const reset = error.response.headers['x-rate-limit-reset'];
                            if (reset) {
                                return new Promise(resolve => {
                                    setTimeout(() => resolve(this.client(error.config)), reset);
                                });
                            }
                            break;
                        case 500:
                        case 502:
                        case 503:
                        case 504:
                            console.error('[Nuvemshop] Erro do servidor:', status);
                            return this.retryRequest(error.config);
                    }
                }
                return Promise.reject(error);
            }
        );
    }

    /**
     * Gera uma chave de cache única
     * @param {string} prefix - Prefixo da chave
     * @param {string|number} identifier - Identificador único
     * @param {Object} params - Parâmetros adicionais
     * @returns {string} Chave de cache
     */
    generateCacheKey(prefix, identifier = '', params = {}) {
        const paramsString = Object.entries(params)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => `${key}=${value}`)
            .join('&');

        return `${NUVEMSHOP_CONFIG.cache.prefix}${prefix}:${identifier}${paramsString ? `:${paramsString}` : ''}`;
    }

    /**
     * Obtém dados do cache ou da API
     * @param {string} cacheKey - Chave do cache
     * @param {Function} fetchFunction - Função para buscar dados da API
     * @param {number} ttl - Tempo de vida do cache em segundos
     * @returns {Promise<any>} Dados do cache ou da API
     */
    async getCachedData(cacheKey, fetchFunction, ttl) {
        try {
            // Tenta obter do cache
            const cachedData = await this.cacheService.get(cacheKey);
            if (cachedData) {
                console.log('[Nuvemshop] Cache hit:', cacheKey);
                return JSON.parse(cachedData);
            }

            // Se não estiver no cache, busca da API
            console.log('[Nuvemshop] Cache miss:', cacheKey);
            const data = await fetchFunction();
            
            // Armazena no cache
            await this.cacheService.set(cacheKey, JSON.stringify(data), ttl);
            
            return data;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao obter dados:', error);
            throw error;
        }
    }

    /**
     * Invalida cache por prefixo
     * @param {string} prefix - Prefixo das chaves a serem invalidadas
     */
    async invalidateCache(prefix) {
        try {
            const pattern = `${NUVEMSHOP_CONFIG.cache.prefix}${prefix}:*`;
            const keys = await this.cacheService.keys(pattern);
            
            if (keys.length > 0) {
                await Promise.all(keys.map(key => this.cacheService.del(key)));
                console.log(`[Nuvemshop] Cache invalidado: ${keys.length} chaves`);
            }
        } catch (error) {
            console.error('[Nuvemshop] Erro ao invalidar cache:', error);
        }
    }

    /**
     * Obtém produto por ID
     * @param {number} productId - ID do produto
     * @returns {Promise<Object>} Dados do produto
     */
    async getProduct(productId) {
        const cacheKey = this.generateCacheKey('product', productId);
        return this.getCachedData(
            cacheKey,
            async () => {
                const response = await this.client.get(`/products/${productId}`);
                return response.data;
            },
            NUVEMSHOP_CONFIG.cache.productsTtl
        );
    }

    /**
     * Obtém lista de produtos
     * @param {Object} options - Opções de paginação e filtros
     * @returns {Promise<Object>} Lista de produtos
     */
    async getProducts(options = {}) {
        const cacheKey = this.generateCacheKey('products', 'list', options);
        return this.getCachedData(
            cacheKey,
            async () => {
                const params = {
                    page: options.page || 1,
                    per_page: Math.min(options.per_page || 50, 200),
                    ...options
                };

                const response = await this.client.get('/products', { params });
                
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
            NUVEMSHOP_CONFIG.cache.productsTtl
        );
    }

    /**
     * Obtém pedido por ID
     * @param {number} orderId - ID do pedido
     * @returns {Promise<Object>} Dados do pedido
     */
    async getOrder(orderId) {
        const cacheKey = this.generateCacheKey('order', orderId);
        return this.getCachedData(
            cacheKey,
            async () => {
                const response = await this.client.get(`/orders/${orderId}`);
                return response.data;
            },
            NUVEMSHOP_CONFIG.cache.ordersTtl
        );
    }

    /**
     * Obtém lista de pedidos
     * @param {Object} options - Opções de paginação e filtros
     * @returns {Promise<Object>} Lista de pedidos
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

                const response = await this.client.get('/orders', { params });
                
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
     * Atualiza um produto
     * @param {number} productId - ID do produto
     * @param {Object} data - Dados do produto
     * @returns {Promise<Object>} Produto atualizado
     */
    async updateProduct(productId, data) {
        try {
            const response = await this.client.put(`/products/${productId}`, data);
            await this.invalidateCache('product');
            return response.data;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao atualizar produto:', error);
            throw error;
        }
    }

    /**
     * Atualiza um pedido
     * @param {number} orderId - ID do pedido
     * @param {Object} data - Dados do pedido
     * @returns {Promise<Object>} Pedido atualizado
     */
    async updateOrder(orderId, data) {
        try {
            const response = await this.client.put(`/orders/${orderId}`, data);
            await this.invalidateCache('order');
            return response.data;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao atualizar pedido:', error);
            throw error;
        }
    }

    async retryRequest(config, retryCount = 0) {
        const maxRetries = NUVEMSHOP_CONFIG.api.retryAttempts;
        const baseDelay = 1000; // 1 segundo

        if (retryCount >= maxRetries) {
            return Promise.reject(new Error('Número máximo de tentativas excedido'));
        }

        const delay = baseDelay * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));

        try {
            return await this.client(config);
        } catch (error) {
            return this.retryRequest(config, retryCount + 1);
        }
    }

    async getCustomer(customerId) {
        return this._makeRequest('get', `/customers/${customerId}`);
    }

    async searchProducts(query) {
        return this._makeRequest('get', `/products?q=${encodeURIComponent(query)}`);
    }

    async getProductBySku(sku) {
        const products = await this._makeRequest('get', `/products?sku=${encodeURIComponent(sku)}`);
        return products.length > 0 ? products[0] : null;
    }

    async getOrderTracking(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.shipping_address || !order.shipping_address.tracking_code) {
            return null;
        }
        return order.shipping_address.tracking_code;
    }

    async getOrderTotal(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total) {
            return null;
        }
        return order.total;
    }

    async getOrderPaymentStatus(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.payment_status) {
            return null;
        }
        return order.payment_status;
    }

    async getOrderFinancialStatus(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.financial_status) {
            return null;
        }
        return order.financial_status;
    }

    async getOrderShippingAddress(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.shipping_address) {
            return null;
        }
        return order.shipping_address;
    }

    async getOrderBillingAddress(orderId) {
        const order = await this.getOrder(orderId);
         if (!order || !order.billing_address) {
            return null;
        }
        return order.billing_address;
    }

    async getOrderItems(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.items) {
            return null;
        }
        return order.items;
    }

    async getOrderCustomer(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.customer) {
            return null;
        }
        return order.customer;
    }

    async getOrderShippingMethod(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.shipping_method) {
            return null;
        }
        return order.shipping_method;
    }

    async getOrderShippingCost(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.shipping_cost) {
            return null;
        }
        return order.shipping_cost;
    }

    async getOrderSubtotal(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.subtotal) {
            return null;
        }
        return order.subtotal;
    }

    /**
     * Processa respostas com múltiplos idiomas
     * @param {Object} data - Dados da resposta
     * @param {string} mainLanguage - Idioma principal
     * @returns {Object} Dados processados
     */
    processMultiLanguageResponse(data, mainLanguage = 'pt') {
        if (!data) return data;

        const processValue = (value) => {
            if (typeof value === 'object' && value !== null) {
                return value[mainLanguage] || Object.values(value)[0];
            }
            return value;
        };

        return Object.entries(data).reduce((acc, [key, value]) => {
            acc[key] = processValue(value);
            return acc;
        }, {});
    }

    /**
     * Processa dados multilíngues
     * @param {Object} data - Dados a serem processados
     * @param {string} mainLanguage - Idioma principal
     * @returns {Object} Dados processados
     */
    processMultiLanguageData(data, mainLanguage = 'pt') {
        if (!data) return data;

        const processValue = (value) => {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                // Se for um objeto de idiomas, retorna o valor do idioma principal ou o primeiro disponível
                if (value[mainLanguage]) return value[mainLanguage];
                return Object.values(value)[0];
            }
            return value;
        };

        const result = {};
        for (const [key, value] of Object.entries(data)) {
            if (Array.isArray(value)) {
                result[key] = value.map(item => this.processMultiLanguageData(item, mainLanguage));
            } else {
                result[key] = processValue(value);
            }
        }

        return result;
    }

    /**
     * Prepara dados para envio com suporte a múltiplos idiomas
     * @param {Object} data - Dados a serem enviados
     * @param {Array} multiLanguageFields - Campos que suportam múltiplos idiomas
     * @returns {Object} Dados preparados
     */
    prepareMultiLanguageData(data, multiLanguageFields = ['name', 'description']) {
        const languages = ['pt', 'es']; // Adicione mais idiomas conforme necessário
        const result = {};

        for (const [key, value] of Object.entries(data)) {
            if (multiLanguageFields.includes(key) && typeof value === 'string') {
                // Se for um campo multilíngue e o valor for uma string,
                // cria um objeto com o mesmo valor para todos os idiomas
                result[key] = languages.reduce((acc, lang) => {
                    acc[lang] = value;
                    return acc;
                }, {});
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * Processa o header Link para paginação
     * @param {string} linkHeader - Header Link da resposta
     * @returns {Object} Links processados
     */
    parseLinkHeader(linkHeader) {
        if (!linkHeader) return {};

        return linkHeader.split(',').reduce((acc, link) => {
            const match = link.match(/<(.+)>;\s*rel="(.+)"/);
            if (match) {
                acc[match[2]] = match[1];
            }
            return acc;
        }, {});
    }

    /**
     * Obtém pedido pelo número
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<Object|null>} Pedido ou null se não encontrado
     */
    async getOrderByNumber(orderNumber) {
        try {
            const response = await this.client.get(`/orders?q=${orderNumber}`);
            const orders = response.data;
            return orders.find(order => order.number === orderNumber) || null;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar pedido por número:', error);
            return null;
        }
    }

    /**
     * Traduz status do pedido
     * @param {string} status - Status original
     * @returns {string} Status traduzido
     */
    translateOrderStatus(status) {
        const translations = {
            'open': 'Em aberto',
            'closed': 'Finalizado',
            'cancelled': 'Cancelado',
            'pending': 'Pendente',
            'paid': 'Pago',
            'unpaid': 'Não pago',
            'authorized': 'Autorizado',
            'refunded': 'Reembolsado',
            'partially_refunded': 'Parcialmente reembolsado',
            'voided': 'Anulado',
            'shipped': 'Enviado',
            'unshipped': 'Não enviado',
            'partially_shipped': 'Parcialmente enviado',
            'ready_for_pickup': 'Pronto para retirada',
            'picked_up': 'Retirado',
            'ready_for_shipping': 'Pronto para envio'
        };

        return translations[status?.toLowerCase()] || status;
    }

    /**
     * Formata preço para exibição
     * @param {number} price - Preço a ser formatado
     * @returns {string} Preço formatado
     */
    formatPrice(price) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(price);
    }

    /**
     * Obtém idioma principal da loja
     * @returns {Promise<string>} Código do idioma principal
     */
    async getMainLanguage() {
        try {
            const response = await this.client.get('/store');
            return response.data.main_language || 'pt';
        } catch (error) {
            console.error('[Nuvemshop] Erro ao obter idioma principal:', error);
            return 'pt';
        }
    }
}

module.exports = { NuvemshopService }; 