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
        // Garantir que a URL base está correta e inclui /v1
        const baseURL = 'https://api.nuvemshop.com.br/v1';

        // Validar o token de acesso
        if (!NUVEMSHOP_CONFIG.accessToken) {
            console.error('[Nuvemshop] Token de acesso não encontrado');
            throw new Error('Token de acesso da Nuvemshop não configurado');
        }

        // Log do token mascarado para debug
        const maskedToken = NUVEMSHOP_CONFIG.accessToken.substring(0, 6) + '...' + 
            NUVEMSHOP_CONFIG.accessToken.substring(NUVEMSHOP_CONFIG.accessToken.length - 4);

        // Configurar headers padrão
        const headers = {
            'Authentication': `bearer ${NUVEMSHOP_CONFIG.accessToken}`,
            'Content-Type': 'application/json',
            'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)',
            'Accept': 'application/json'
        };

        // Criar instância do axios com configuração completa
        this.client = axios.create({
            baseURL,
            headers,
            timeout: NUVEMSHOP_CONFIG.api.timeout
        });

        // Interceptor para logs de request
        this.client.interceptors.request.use(request => {
            console.log('[Nuvemshop] Request:', {
                url: request.url,
                method: request.method,
                params: request.params,
                headers: {
                    'Content-Type': request.headers['Content-Type'],
                    'User-Agent': request.headers['User-Agent'],
                    'Authentication': 'bearer ' + NUVEMSHOP_CONFIG.accessToken.substring(0, 6) + '...'
                }
            });
            return request;
        });

        // Interceptor para logs de response
        this.client.interceptors.response.use(
            response => {
                console.log('[Nuvemshop] Response Success:', {
                    status: response.status,
                    data: response.data
                });
                return response;
            },
            error => {
                console.error('[Nuvemshop] Response Error:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message
                });
                return Promise.reject(error);
            }
        );
    }

    async getOrderByNumber(orderNumber) {
        try {
            const cleanOrderNumber = String(orderNumber).replace(/[#\s]/g, '');
            
            console.log('[Nuvemshop] Buscando pedido:', {
                numero: cleanOrderNumber,
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });

            const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: {
                    q: cleanOrderNumber,
                    per_page: 50,
                    created_at_min: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
                }
            });

            if (response.data && Array.isArray(response.data)) {
                const order = response.data.find(o => String(o.number) === cleanOrderNumber);
                
                if (order) {
                    // Log detalhado do pedido encontrado
                    console.log('[Nuvemshop] Pedido encontrado:', {
                        numero: cleanOrderNumber,
                        pedidoId: order.id,
                        status: order.status,
                        cliente: order.customer?.name || order.client_details?.name || 'Não informado',
                        produtos: order.products?.length || 0,
                        timestamp: new Date().toISOString()
                    });

                    // Log do pedido completo para debug
                    console.log('[Nuvemshop] Dados completos do pedido:', JSON.stringify(order, null, 2));

                    return order;
                }
            }
            
            console.log('[Nuvemshop] Pedido não encontrado:', { 
                numero: cleanOrderNumber,
                timestamp: new Date().toISOString()
            });
            return null;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar pedido:', {
                numero: orderNumber,
                erro: error.message,
                stack: error.stack,
                resposta: error.response?.data,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    async getOrder(orderId) {
        try {
            const cacheKey = this.generateCacheKey('order', orderId);
            return this.getCachedData(
                cacheKey,
                async () => {
                    const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders/${orderId}`);
                    return response.data;
                },
                NUVEMSHOP_CONFIG.cache.ordersTtl
            );
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar detalhes do pedido:', {
                erro: error.message,
                stack: error.stack,
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
            console.error('[Nuvemshop] Erro ao buscar pedidos por telefone:', {
                erro: error.message,
                stack: error.stack,
                telefone: phone,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    async isOrderPendingPayment(orderId) {
        try {
            const order = await this.getOrder(orderId);
            return order && order.payment_status === 'pending';
        } catch (error) {
            console.error('[Nuvemshop] Erro ao verificar status de pagamento:', {
                erro: error.message,
                stack: error.stack,
                pedidoId: orderId,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Formata o status do pedido para exibição
     * @param {string} status - Status original do pedido
     * @returns {string} Status formatado
     */
    formatOrderStatus(status) {
        if (!status) return 'Não disponível';

        // Mapa completo de status
        const statusMap = {
            // Status do pedido
            'open': 'Em aberto',
            'closed': 'Concluído',
            'cancelled': 'Cancelado',
            
            // Status de pagamento
            'pending': 'Pendente',
            'paid': 'Pago',
            'unpaid': 'Não pago',
            'partially_paid': 'Parcialmente pago',
            'refunded': 'Reembolsado',
            'partially_refunded': 'Parcialmente reembolsado',
            
            // Status de envio
            'shipped': 'Enviado',
            'unshipped': 'Não enviado',
            'partially_shipped': 'Parcialmente enviado',
            'ready_to_ship': 'Pronto para envio',
            'in_transit': 'Em trânsito',
            'delivered': 'Entregue',
            'ready_for_pickup': 'Pronto para retirada',
            'packed': 'Embalado'
        };

        // Log para debug
        console.log('🔄 Formatando status:', {
            original: status,
            formatado: statusMap[status?.toLowerCase()] || status,
            timestamp: new Date().toISOString()
        });

        return statusMap[status?.toLowerCase()] || status;
    }

    /**
     * Formata preço para exibição
     * @param {number} price - Preço a ser formatado
     * @returns {string} Preço formatado
     */
    formatPrice(value) {
        if (!value) return 'R$ 0,00';
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
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
            console.error('[Nuvemshop] Erro ao obter dados:', {
                erro: error.message,
                stack: error.stack,
                cacheKey: cacheKey,
                timestamp: new Date().toISOString()
            });
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
            console.error('[Nuvemshop] Erro ao invalidar cache:', {
                erro: error.message,
                stack: error.stack,
                prefix: prefix,
                timestamp: new Date().toISOString()
            });
        }
    }

    async getProduct(productId) {
        const cacheKey = this.generateCacheKey('product', productId);
        return this.getCachedData(
            cacheKey,
            async () => {
                const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/products/${productId}`);
                return response.data;
            },
            NUVEMSHOP_CONFIG.cache.productsTtl
        );
    }

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

                const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/products`, { params });
                
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

    async searchProducts(query) {
        const cacheKey = this.generateCacheKey('products', 'search', { q: query });
        return this.getCachedData(
            cacheKey,
            async () => {
                const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/products`, { 
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
                const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/products`, { 
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
                const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/customers/${customerId}`);
                return response.data;
            },
            NUVEMSHOP_CONFIG.cache.ttl.customers
        );
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
     * Testa a conexão com a API da Nuvemshop
     * @returns {Promise<boolean>} true se a conexão está ok
     */
    async testConnection() {
        try {
            console.log('[Nuvemshop] Testando conexão:', {
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });

            // Tenta buscar apenas 1 pedido para testar
            const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: {
                    per_page: 1
                }
            });

            console.log('[Nuvemshop] Conexão OK:', {
                status: response.status,
                totalPedidos: response.data.length,
                url: response.config.url,
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });

            return true;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao testar conexão:', {
                erro: error.message,
                stack: error.stack,
                status: error.response?.status,
                data: error.response?.data,
                url: error.config?.url,
                storeId: NUVEMSHOP_CONFIG.userId,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }
}

module.exports = { NuvemshopService };