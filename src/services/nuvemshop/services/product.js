const { NuvemshopBase } = require('../base');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const logger = require('../../../utils/logger');

class ProductService extends NuvemshopBase {
    constructor(cacheService) {
        super(cacheService);
    }

    /**
     * Busca produto por ID
     * @param {string} productId - ID do produto
     * @returns {Promise<Object>} Produto encontrado
     */
    async getProduct(productId) {
        try {
            const cacheKey = this.generateCacheKey('product', productId);
            return this.getCachedData(
                cacheKey,
                async () => {
                    const response = await this.client.get(
                        `/${NUVEMSHOP_CONFIG.userId}/products/${productId}`
                    );
                    return response.data;
                },
                NUVEMSHOP_CONFIG.cache.productsTtl
            );
        } catch (error) {
            logger.error('ErroBuscarProduto', {
                erro: error.message,
                stack: error.stack,
                produtoId: productId,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Busca produtos com paginação
     * @param {Object} options - Opções de busca
     * @returns {Promise<Object>} Produtos e informações de paginação
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

    /**
     * Busca produtos por categoria
     * @param {string} categoryId - ID da categoria
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de produtos
     */
    async getProductsByCategory(categoryId, options = {}) {
        try {
            const { data: products } = await this.getProducts({
                category_id: categoryId,
                ...options
            });
            return products;
        } catch (error) {
            logger.error('ErroBuscarProdutosPorCategoria', {
                erro: error.message,
                stack: error.stack,
                categoriaId: categoryId,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    /**
     * Busca produtos por marca
     * @param {string} brand - Nome da marca
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de produtos
     */
    async getProductsByBrand(brand, options = {}) {
        try {
            const { data: products } = await this.getProducts({
                q: brand,
                ...options
            });

            // Filtra produtos que correspondem exatamente à marca
            return products.filter(product => 
                product.brand?.toLowerCase() === brand.toLowerCase()
            );
        } catch (error) {
            logger.error('ErroBuscarProdutosPorMarca', {
                erro: error.message,
                stack: error.stack,
                marca: brand,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    /**
     * Busca produtos por termo de busca
     * @param {string} query - Termo de busca
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de produtos
     */
    async searchProducts(query, options = {}) {
        try {
            const { data: products } = await this.getProducts({
                q: query,
                ...options
            });
            return products;
        } catch (error) {
            logger.error('ErroBuscaProdutos', {
                erro: error.message,
                stack: error.stack,
                termo: query,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    /**
     * Busca produtos em promoção
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de produtos
     */
    async getPromotionalProducts(options = {}) {
        try {
            const { data: products } = await this.getProducts({
                promotional_price: true,
                ...options
            });
            return products;
        } catch (error) {
            logger.error('ErroBuscarProdutosPromocao', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    /**
     * Busca produtos em destaque
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de produtos
     */
    async getFeaturedProducts(options = {}) {
        try {
            const { data: products } = await this.getProducts({
                featured: true,
                ...options
            });
            return products;
        } catch (error) {
            logger.error('ErroBuscarProdutosDestaque', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    /**
     * Busca produtos por variação
     * @param {string} variantId - ID da variação
     * @returns {Promise<Object>} Produto e variação encontrados
     */
    async getProductByVariant(variantId) {
        try {
            const { data: products } = await this.getProducts({
                variant_id: variantId
            });

            if (!products || products.length === 0) {
                return null;
            }

            const product = products[0];
            const variant = product.variants?.find(v => v.id === variantId);

            return {
                product,
                variant
            };
        } catch (error) {
            logger.error('ErroBuscarProdutoPorVariacao', {
                erro: error.message,
                stack: error.stack,
                variacaoId: variantId,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Busca produtos por SKU
     * @param {string} sku - SKU do produto
     * @returns {Promise<Object>} Produto encontrado
     */
    async getProductBySku(sku) {
        try {
            const { data: products } = await this.getProducts({
                sku: sku
            });

            if (!products || products.length === 0) {
                return null;
            }

            return products[0];
        } catch (error) {
            logger.error('ErroBuscarProdutoPorSku', {
                erro: error.message,
                stack: error.stack,
                sku: sku,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Verifica se produto está disponível
     * @param {string} productId - ID do produto
     * @returns {Promise<boolean>} true se disponível
     */
    async isProductAvailable(productId) {
        try {
            const product = await this.getProduct(productId);
            
            // Verifica se o produto existe e está publicado
            if (!product || !product.published) {
                return false;
            }

            // Verifica se há variantes com estoque
            if (product.variants && product.variants.length > 0) {
                return product.variants.some(variant => variant.stock > 0);
            }

            return false;
        } catch (error) {
            logger.error('ErroVerificarDisponibilidade', {
                erro: error.message,
                stack: error.stack,
                produtoId: productId,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Busca estoque do produto
     * @param {string} productId - ID do produto
     * @returns {Promise<Object>} Informações de estoque
     */
    async getProductStock(productId) {
        try {
            const product = await this.getProduct(productId);
            
            if (!product) {
                return null;
            }

            return {
                totalStock: product.variants?.reduce((total, variant) => total + variant.stock, 0) || 0,
                variants: product.variants?.map(variant => ({
                    id: variant.id,
                    name: variant.name,
                    stock: variant.stock
                })) || []
            };
        } catch (error) {
            logger.error('ErroBuscarEstoque', {
                erro: error.message,
                stack: error.stack,
                produtoId: productId,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Busca preço do produto
     * @param {string} productId - ID do produto
     * @returns {Promise<Object>} Informações de preço
     */
    async getProductPrice(productId) {
        try {
            const product = await this.getProduct(productId);
            
            if (!product) {
                return null;
            }

            return {
                basePrice: product.price,
                promotionalPrice: product.promotional_price,
                variants: product.variants?.map(variant => ({
                    id: variant.id,
                    name: variant.name,
                    price: variant.price,
                    promotionalPrice: variant.promotional_price
                })) || []
            };
        } catch (error) {
            logger.error('ErroBuscarPreco', {
                erro: error.message,
                stack: error.stack,
                produtoId: productId,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }
}

module.exports = { ProductService };
