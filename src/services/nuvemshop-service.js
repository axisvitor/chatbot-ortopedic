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
            baseURL: NUVEMSHOP_CONFIG.api.url,
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
            response => {
                console.log('[Nuvemshop] Sucesso:', {
                    url: response.config.url,
                    params: response.config.params,
                    storeId: NUVEMSHOP_CONFIG.userId,
                    timestamp: new Date().toISOString()
                });
                return response;
            },
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
                const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/products/${productId}`);
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

                const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/products`, { params });
                
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
     * @returns {Promise<Object|null>} Pedido ou null se não encontrado
     */
    async getOrder(orderId) {
        try {
            const cacheKey = this.generateCacheKey('order', orderId);
            return this.getCachedData(
                cacheKey,
                async () => {
                    const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/orders/${orderId}`);
                    return response.data;
                },
                NUVEMSHOP_CONFIG.cache.ordersTtl
            );
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar detalhes do pedido:', {
                erro: error.message,
                pedidoId: orderId,
                status: error.response?.status,
                data: error.response?.data,
                url: error.config?.url,
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });
            return null;
        }
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

                const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/orders`, { params });
                
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
     * Busca pedidos recentes por telefone
     * @param {string} phone - Número do telefone
     * @param {Object} options - Opções adicionais
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
            return orders.filter(order => {
                const customerPhone = order.customer?.phone?.replace(/\D/g, '');
                return customerPhone && customerPhone.includes(cleanPhone);
            });
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar pedidos por telefone:', error);
            return [];
        }
    }

    /**
     * Obtém pedido pelo número
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<Object|null>} Pedido ou null se não encontrado
     */
    async getOrderByNumber(orderNumber) {
        try {
            console.log('[Nuvemshop] Buscando pedido:', {
                numero: orderNumber,
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });

            // Remove o "#" se presente e qualquer espaço em branco
            const cleanOrderNumber = orderNumber.replace(/[#\s]/g, '');

            const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: {
                    q: cleanOrderNumber,
                    per_page: 1
                }
            });

            const orders = response.data;
            const order = orders.find(o => String(o.number) === cleanOrderNumber);

            if (!order) {
                console.log('[Nuvemshop] Pedido não encontrado:', {
                    numero: cleanOrderNumber,
                    storeId: NUVEMSHOP_CONFIG.userId,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            console.log('[Nuvemshop] Pedido encontrado:', {
                numero: cleanOrderNumber,
                pedidoId: order.id,
                status: order.status,
                timestamp: new Date().toISOString()
            });

            // Busca detalhes completos do pedido
            return await this.getOrder(order.id);
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar pedido por número:', {
                erro: error.message,
                status: error.response?.status,
                data: error.response?.data,
                url: error.config?.url,
                params: error.config?.params,
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Verifica se um pedido está pendente de pagamento
     * @param {number} orderId - ID do pedido
     * @returns {Promise<boolean>} true se estiver pendente
     */
    async isOrderPendingPayment(orderId) {
        try {
            const order = await this.getOrder(orderId);
            return order && order.payment_status === 'pending';
        } catch (error) {
            console.error('[Nuvemshop] Erro ao verificar status de pagamento:', error);
            return false;
        }
    }

    /**
     * Formata o status do pedido para exibição
     * @param {string} status - Status original
     * @returns {string} Status formatado
     */
    formatOrderStatus(status) {
        const statusMap = {
            'pending': '🕒 Pendente',
            'paid': '✅ Pago',
            'packed': '📦 Embalado',
            'shipped': '🚚 Enviado',
            'delivered': '📬 Entregue',
            'cancelled': '❌ Cancelado'
        };
        return statusMap[status] || status;
    }

    /**
     * Formata o resumo do pedido para exibição
     * @param {Object} order - Dados do pedido
     * @returns {string} Resumo formatado
     */
    formatOrderSummary(order) {
        if (!order) return null;
        
        return `🛍️ *Pedido #${order.number}*
📅 Data: ${new Date(order.created_at).toLocaleDateString('pt-BR')}
💰 Total: ${this.formatPrice(order.total)}
📦 Status: ${this.formatOrderStatus(order.status)}
💳 Pagamento: ${this.formatOrderStatus(order.payment_status)}`;
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
        const cacheKey = this.generateCacheKey('customer', customerId);
        return this.getCachedData(
            cacheKey,
            async () => {
                const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/customers/${customerId}`);
                return response.data;
            },
            NUVEMSHOP_CONFIG.cache.ttl.customers
        );
    }

    async searchProducts(query) {
        const cacheKey = this.generateCacheKey('products', 'search', { q: query });
        return this.getCachedData(
            cacheKey,
            async () => {
                const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/products`, { 
                    params: { q: query, per_page: 10 }
                });
                return response.data;
            },
            NUVEMSHOP_CONFIG.cache.ttl.products
        );
    }

    async getProductBySku(sku) {
        const cacheKey = this.generateCacheKey('products', 'sku', { sku });
        return this.getCachedData(
            cacheKey,
            async () => {
                const response = await this.client.get(`/v1/${NUVEMSHOP_CONFIG.userId}/products`, { 
                    params: { sku, per_page: 1 }
                });
                return response.data[0] || null;
            },
            NUVEMSHOP_CONFIG.cache.ttl.products
        );
    }

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
            const response = await this.client.get('/v1/' + NUVEMSHOP_CONFIG.userId + '/store');
            return response.data.main_language || 'pt';
        } catch (error) {
            console.error('[Nuvemshop] Erro ao obter idioma principal:', error);
            return 'pt';
        }
    }
}

module.exports = { NuvemshopService };