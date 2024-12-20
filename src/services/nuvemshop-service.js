const axios = require('axios');
const { RedisStore } = require('../store/redis-store');
const { NUVEMSHOP_CONFIG } = require('../config/settings');

class NuvemshopService {
    constructor() {
        this.redisStore = new RedisStore();
        this.config = NUVEMSHOP_CONFIG;
        this.rateLimitRemaining = null;
        this.rateLimitReset = null;
        
        this.client = axios.create({
            baseURL: this.config.api.url,
            timeout: this.config.api.timeout,
            headers: {
                'Authorization': `Bearer ${this.config.accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Chatbot-Calcados/1.0'
            }
        });

        // Interceptor para tratar rate limits e erros
        this.client.interceptors.response.use(
            (response) => {
                // Atualiza informações de rate limit
                this.rateLimitRemaining = response.headers['x-rate-limit-remaining'];
                this.rateLimitReset = response.headers['x-rate-limit-reset'];
                return response;
            },
            async (error) => {
                return this.handleApiError(error);
            }
        );
    }

    /**
     * Trata erros da API
     * @private
     * @param {Error} error - Erro da requisição
     * @returns {Promise<*>} Resultado da operação
     */
    async handleApiError(error) {
        if (error.response) {
            const { status, data } = error.response;

            // Log detalhado do erro
            console.error('[Nuvemshop] Erro na API:', {
                status,
                data,
                endpoint: error.config.url,
                method: error.config.method
            });

            switch (status) {
                case 429: // Rate limit
                    const resetTime = this.rateLimitReset ? parseInt(this.rateLimitReset) * 1000 : 5000;
                    await new Promise(resolve => setTimeout(resolve, resetTime));
                    return this.client.request(error.config);

                case 401: // Token expirado/inválido
                    throw new Error('Token de acesso inválido ou expirado');

                case 404:
                    return null;

                default:
                    if (status >= 500) {
                        return this.retryOperation(() => this.client.request(error.config));
                    }
                    throw error;
            }
        }
        throw error;
    }

    /**
     * Tenta executar uma operação várias vezes
     * @private
     * @param {Function} operation - Operação a ser executada
     * @param {number} maxAttempts - Número máximo de tentativas
     * @returns {Promise<*>} Resultado da operação
     */
    async retryOperation(operation, maxAttempts = 3) {
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw lastError;
    }

    /**
     * Valida parâmetros de entrada
     * @private
     * @param {Object} params - Parâmetros a serem validados
     * @param {Array} required - Lista de campos obrigatórios
     * @throws {Error} Se algum parâmetro for inválido
     */
    validateParams(params, required = []) {
        if (!params || typeof params !== 'object') {
            throw new Error('Parâmetros inválidos');
        }

        for (const field of required) {
            if (!(field in params)) {
                throw new Error(`Campo obrigatório ausente: ${field}`);
            }
        }
    }

    /**
     * Verifica rate limits antes de fazer requisição
     * @private
     * @throws {Error} Se o rate limit foi atingido
     */
    checkRateLimit() {
        if (this.rateLimitRemaining !== null && this.rateLimitRemaining <= 0) {
            const resetTime = new Date(this.rateLimitReset * 1000);
            throw new Error(`Rate limit atingido. Tente novamente após ${resetTime.toLocaleTimeString()}`);
        }
    }

    /**
     * Invalida cache de um recurso
     * @private
     * @param {string} key - Chave do cache
     */
    async invalidateCache(key) {
        await this.redisStore.del(key);
    }

    /**
     * Obtém resultados paginados
     * @private
     * @param {string} endpoint - Endpoint da API
     * @param {Object} params - Parâmetros da requisição
     * @returns {Promise<Object>} Resultados paginados
     */
    async getPaginatedResults(endpoint, params = {}) {
        const defaultParams = {
            page: 1,
            per_page: 50,
            ...params
        };

        const response = await this.client.get(endpoint, { params: defaultParams });
        
        return {
            data: response.data,
            pagination: {
                currentPage: parseInt(response.headers['x-page'] || defaultParams.page),
                perPage: parseInt(response.headers['x-per-page'] || defaultParams.per_page),
                totalPages: parseInt(response.headers['x-total-pages'] || 1),
                totalItems: parseInt(response.headers['x-total'] || response.data.length)
            }
        };
    }

    /**
     * Lista todas as categorias disponíveis
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de categorias
     */
    async getCategories(options = {}) {
        try {
            this.checkRateLimit();
            
            const cacheKey = `${this.config.cache.prefix}categories`;
            const cached = await this.redisStore.get(cacheKey);
            
            if (cached && !options.forceRefresh) {
                return cached;
            }

            const { data: categories } = await this.getPaginatedResults('/categories', options);

            await this.redisStore.set(cacheKey, categories, this.config.cache.categoriesTtl);
            return categories;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao listar categorias:', error);
            throw error;
        }
    }

    /**
     * Obtém detalhes de uma categoria
     * @param {number} categoryId - ID da categoria
     * @returns {Promise<Object>} Detalhes da categoria
     */
    async getCategoryDetails(categoryId) {
        try {
            this.checkRateLimit();
            
            const cacheKey = `${this.config.cache.prefix}category:${categoryId}`;
            const cached = await this.redisStore.get(cacheKey);
            
            if (cached) {
                return cached;
            }

            const response = await this.client.get(`/categories/${categoryId}`);
            const category = response.data;

            await this.redisStore.set(cacheKey, category, this.config.cache.categoriesTtl);
            return category;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao obter categoria:', error);
            throw error;
        }
    }

    /**
     * Busca produtos com filtros
     * @param {Object} filters - Filtros (categoria, marca, preço, etc)
     * @param {Object} options - Opções de busca (página, ordenação, etc)
     * @returns {Promise<Object>} Lista de produtos e informações de paginação
     */
    async searchProducts(filters = {}, options = {}) {
        try {
            this.checkRateLimit();
            this.validateParams(filters);

            const searchParams = {
                ...filters,
                ...options,
                fields: options.fields || 'id,name,description,price,promotional_price,stock,images,variants,brand,categories'
            };

            const cacheKey = `${this.config.cache.prefix}products:${JSON.stringify(searchParams)}`;
            const cached = await this.redisStore.get(cacheKey);
            
            if (cached && !options.forceRefresh) {
                return cached;
            }

            const result = await this.getPaginatedResults('/products', searchParams);

            // Processa os produtos para garantir formato consistente
            result.data = result.data.map(product => ({
                ...product,
                variants: this.processVariants(product.variants),
                images: product.images.map(img => img.src),
                formattedPrice: this.formatPrice(product.price),
                formattedPromotionalPrice: product.promotional_price ? this.formatPrice(product.promotional_price) : null
            }));

            await this.redisStore.set(cacheKey, result, this.config.cache.productsTtl);
            return result;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar produtos:', error);
            throw error;
        }
    }

    /**
     * Processa variantes de um produto
     * @private
     * @param {Array} variants - Lista de variantes
     * @returns {Array} Variantes processadas
     */
    processVariants(variants) {
        return variants.map(variant => ({
            id: variant.id,
            sku: variant.sku,
            barcode: variant.barcode,
            price: variant.price,
            formattedPrice: this.formatPrice(variant.price),
            stock: variant.stock,
            values: variant.values,
            weight: variant.weight,
            width: variant.width,
            height: variant.height,
            length: variant.length
        }));
    }

    /**
     * Obtém detalhes de um produto
     * @param {number} productId - ID do produto
     * @param {Object} options - Opções adicionais
     * @returns {Promise<Object>} Detalhes do produto
     */
    async getProduct(productId, options = {}) {
        try {
            this.checkRateLimit();
            
            const cacheKey = `${this.config.cache.prefix}product:${productId}`;
            const cached = await this.redisStore.get(cacheKey);
            
            if (cached && !options.forceRefresh) {
                return cached;
            }

            const response = await this.client.get(`/products/${productId}`, {
                params: {
                    fields: options.fields || 'id,name,description,price,promotional_price,stock,images,variants,brand,categories,seo,created_at,updated_at'
                }
            });

            const product = {
                ...response.data,
                variants: this.processVariants(response.data.variants),
                images: response.data.images.map(img => img.src),
                formattedPrice: this.formatPrice(response.data.price),
                formattedPromotionalPrice: response.data.promotional_price ? this.formatPrice(response.data.promotional_price) : null
            };

            await this.redisStore.set(cacheKey, product, this.config.cache.productsTtl);
            return product;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao obter produto:', error);
            throw error;
        }
    }

    /**
     * Lista todas as marcas disponíveis
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de marcas
     */
    async getBrands(options = {}) {
        try {
            this.checkRateLimit();
            
            const cacheKey = `${this.config.cache.prefix}brands`;
            const cached = await this.redisStore.get(cacheKey);
            
            if (cached && !options.forceRefresh) {
                return cached;
            }

            const { data: brands } = await this.getPaginatedResults('/brands', options);

            await this.redisStore.set(cacheKey, brands, this.config.cache.brandsTtl);
            return brands;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao listar marcas:', error);
            throw error;
        }
    }

    /**
     * Busca pedidos com filtros
     * @param {Object} filters - Filtros (status, cliente, data, etc)
     * @param {Object} options - Opções de busca
     * @returns {Promise<Object>} Lista de pedidos e informações de paginação
     */
    async getOrders(filters = {}, options = {}) {
        try {
            this.checkRateLimit();
            this.validateParams(filters);

            const searchParams = {
                ...filters,
                ...options,
                fields: options.fields || 'id,number,status,total,created_at,customer,products,shipping_status,shipping_tracking'
            };

            const result = await this.getPaginatedResults('/orders', searchParams);

            // Processa os pedidos para incluir informações formatadas
            result.data = result.data.map(order => ({
                ...order,
                formattedTotal: this.formatPrice(order.total),
                formattedDate: new Date(order.created_at).toLocaleString('pt-BR'),
                statusTranslated: this.translateOrderStatus(order.status),
                products: order.products.map(product => ({
                    ...product,
                    formattedPrice: this.formatPrice(product.price)
                }))
            }));

            return result;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar pedidos:', error);
            throw error;
        }
    }

    /**
     * Obtém detalhes de um pedido
     * @param {number} orderId - ID do pedido
     * @param {Object} options - Opções adicionais
     * @returns {Promise<Object>} Detalhes do pedido
     */
    async getOrder(orderId, options = {}) {
        try {
            this.checkRateLimit();

            const response = await this.client.get(`/orders/${orderId}`, {
                params: {
                    fields: options.fields || 'id,number,status,total,created_at,customer,products,shipping_status,shipping_tracking,payments'
                }
            });

            const order = {
                ...response.data,
                formattedTotal: this.formatPrice(response.data.total),
                formattedDate: new Date(response.data.created_at).toLocaleString('pt-BR'),
                statusTranslated: this.translateOrderStatus(response.data.status),
                products: response.data.products.map(product => ({
                    ...product,
                    formattedPrice: this.formatPrice(product.price)
                }))
            };

            return order;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao obter pedido:', error);
            throw error;
        }
    }

    /**
     * Lista cupons de desconto ativos
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de cupons
     */
    async getActiveCoupons(options = {}) {
        try {
            this.checkRateLimit();

            const { data: coupons } = await this.getPaginatedResults('/coupons', {
                ...options,
                status: 'active'
            });

            return coupons.map(coupon => ({
                ...coupon,
                formattedDiscount: coupon.type === 'percentage' 
                    ? `${coupon.amount}%`
                    : this.formatPrice(coupon.amount)
            }));
        } catch (error) {
            console.error('[Nuvemshop] Erro ao listar cupons:', error);
            throw error;
        }
    }

    /**
     * Busca informações de um cliente
     * @param {string} email - Email do cliente
     * @returns {Promise<Object>} Dados do cliente
     */
    async getCustomer(email) {
        try {
            this.checkRateLimit();
            this.validateParams({ email }, ['email']);

            const response = await this.client.get('/customers', {
                params: { 
                    q: email,
                    fields: 'id,name,email,phone,identification,default_address,addresses,total_orders'
                }
            });

            return response.data[0] || null;
        } catch (error) {
            console.error('[Nuvemshop] Erro ao buscar cliente:', error);
            throw error;
        }
    }

    /**
     * Obtém informações de envio de um pedido
     * @param {number} orderId - ID do pedido
     * @returns {Promise<Object>} Informações de envio
     */
    async getShippingInfo(orderId) {
        try {
            this.checkRateLimit();

            const response = await this.client.get(`/orders/${orderId}/shipping`);
            const shipping = response.data;

            return {
                ...shipping,
                statusTranslated: this.translateShippingStatus(shipping.status)
            };
        } catch (error) {
            console.error('[Nuvemshop] Erro ao obter informações de envio:', error);
            throw error;
        }
    }

    /**
     * Traduz status do pedido
     * @private
     * @param {string} status - Status em inglês
     * @returns {string} Status traduzido
     */
    translateOrderStatus(status) {
        const statusMap = {
            'open': 'Aberto',
            'closed': 'Concluído',
            'cancelled': 'Cancelado',
            'pending': 'Pendente',
            'paid': 'Pago',
            'unpaid': 'Não Pago',
            'partially_paid': 'Parcialmente Pago',
            'refunded': 'Reembolsado',
            'partially_refunded': 'Parcialmente Reembolsado'
        };
        return statusMap[status] || status;
    }

    /**
     * Traduz status de envio
     * @private
     * @param {string} status - Status em inglês
     * @returns {string} Status traduzido
     */
    translateShippingStatus(status) {
        const statusMap = {
            'pending': 'Pendente',
            'ready_for_shipping': 'Pronto para Envio',
            'shipped': 'Enviado',
            'delivered': 'Entregue',
            'error': 'Erro no Envio',
            'cancelled': 'Cancelado'
        };
        return statusMap[status] || status;
    }

    /**
     * Formata preço em Reais
     * @param {number} price - Preço em centavos
     * @returns {string} Preço formatado
     */
    formatPrice(price) {
        if (!price && price !== 0) return null;
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(price / 100);
    }

    /**
     * Formata resposta para o WhatsApp
     * @param {Object} result - Resultado da busca de produtos
     * @returns {string} Mensagem formatada
     */
    formatProductsResponse(result) {
        const { data: products, pagination } = result;

        if (!products || products.length === 0) {
            return "Desculpe, não encontrei nenhum produto com essas características.";
        }

        let message = `🛍️ *Encontrei ${pagination.totalItems} produtos para você*\n`;
        message += `Mostrando ${products.length} produtos da página ${pagination.currentPage} de ${pagination.totalPages}\n\n`;
        
        products.forEach((product, index) => {
            message += `*${index + 1}. ${product.name}*\n`;
            message += `💰 Preço: ${product.formattedPrice}\n`;
            
            if (product.formattedPromotionalPrice) {
                message += `🏷️ Promoção: ${product.formattedPromotionalPrice}\n`;
            }

            if (product.brand) {
                message += `👜 Marca: ${product.brand.name}\n`;
            }

            if (product.variants && product.variants.length > 0) {
                const sizes = [...new Set(product.variants.filter(v => v.stock > 0).map(v => v.values.find(val => val.name.match(/^\d+$/))?.name).filter(Boolean))];
                if (sizes.length > 0) {
                    message += `📏 Tamanhos disponíveis: ${sizes.join(', ')}\n`;
                }
            }

            message += `📦 Estoque: ${product.stock} unidades\n\n`;
        });

        if (pagination.totalPages > 1) {
            message += `\n_Para ver mais produtos, me peça a próxima página._\n`;
        }

        message += "_Para mais detalhes sobre um produto específico, me envie o número dele da lista acima._";
        return message;
    }

    /**
     * Formata resposta de pedido para o WhatsApp
     * @param {Object} order - Dados do pedido
     * @returns {string} Mensagem formatada
     */
    formatOrderResponse(order) {
        let message = `🛍️ *Pedido #${order.number}*\n\n`;
        message += `📅 Data: ${order.formattedDate}\n`;
        message += `📦 Status: ${order.statusTranslated}\n`;
        message += `💰 Total: ${order.formattedTotal}\n\n`;
        
        message += `*Produtos:*\n`;
        order.products.forEach(product => {
            message += `▫️ ${product.quantity}x ${product.name}\n`;
            message += `   💰 ${product.formattedPrice} cada\n`;
        });

        if (order.shipping_status) {
            message += `\n📦 *Envio:* ${this.translateShippingStatus(order.shipping_status)}`;
            if (order.shipping_tracking) {
                message += `\n🔍 *Rastreamento:* ${order.shipping_tracking}`;
            }
        }

        return message;
    }
}

module.exports = { NuvemshopService }; 