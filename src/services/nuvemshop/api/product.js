const { NuvemshopApiBase } = require('./base');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');

class ProductApi extends NuvemshopApiBase {
    constructor() {
        super();
        this.cachePrefix = NUVEMSHOP_CONFIG.cache.prefix + 'product:';
        this.defaultFields = [
            'id',
            'name',
            'description',
            'handle',
            'variants',
            'images',
            'categories',
            'brand',
            'seo_title',
            'seo_description',
            'created_at',
            'updated_at',
            'published',
            'free_shipping',
            'video_url',
            'attributes',
            'tags'
        ].join(',');
    }

    // Validações
    validateProductId(productId) {
        if (!productId || typeof productId !== 'number') {
            throw new Error('ID do produto inválido');
        }
    }

    validateVariantId(variantId) {
        if (!variantId || typeof variantId !== 'number') {
            throw new Error('ID da variante inválido');
        }
    }

    validateCategoryId(categoryId) {
        if (!categoryId || typeof categoryId !== 'number') {
            throw new Error('ID da categoria inválido');
        }
    }

    // Métodos principais
    async getProduct(productId) {
        this.validateProductId(productId);
        const cacheKey = `${this.cachePrefix}${productId}`;
        return this.handleRequest('get', `/products/${productId}`, {
            params: { fields: this.defaultFields }
        }, { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.product });
    }

    async searchProducts(params = {}) {
        const searchParams = {
            fields: this.defaultFields,
            ...params
        };

        const cacheKey = `${this.cachePrefix}search:${JSON.stringify(searchParams)}`;
        return this.handleRequest('get', '/products', { 
            params: searchParams 
        }, { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.productList });
    }

    async getProductByHandle(handle) {
        if (!handle || typeof handle !== 'string') {
            throw new Error('Handle do produto inválido');
        }

        const cacheKey = `${this.cachePrefix}handle:${handle}`;
        const products = await this.handleRequest('get', '/products', {
            params: {
                q: handle,
                fields: this.defaultFields
            }
        }, { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.product });

        return products.find(product => product.handle === handle);
    }

    async getProductVariant(productId, variantId) {
        this.validateProductId(productId);
        this.validateVariantId(variantId);

        const cacheKey = `${this.cachePrefix}${productId}:variant:${variantId}`;
        return this.handleRequest('get', `/products/${productId}/variants/${variantId}`, {}, 
            { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.variant });
    }

    async getProductVariants(productId) {
        this.validateProductId(productId);

        const cacheKey = `${this.cachePrefix}${productId}:variants`;
        return this.handleRequest('get', `/products/${productId}/variants`, {},
            { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.variantList });
    }

    async getCategories() {
        const cacheKey = `${this.cachePrefix}categories`;
        return this.handleRequest('get', '/categories', {},
            { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.category });
    }

    async getCategory(categoryId) {
        this.validateCategoryId(categoryId);

        const cacheKey = `${this.cachePrefix}category:${categoryId}`;
        return this.handleRequest('get', `/categories/${categoryId}`, {},
            { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.category });
    }

    async getProductsByCategory(categoryId) {
        this.validateCategoryId(categoryId);

        const cacheKey = `${this.cachePrefix}category:${categoryId}:products`;
        return this.handleRequest('get', '/products', {
            params: {
                category_id: categoryId,
                fields: this.defaultFields
            }
        }, { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.productList });
    }

    async getBrands() {
        const cacheKey = `${this.cachePrefix}brands`;
        return this.handleRequest('get', '/brands', {},
            { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.brand });
    }

    async getProductsByBrand(brandId) {
        if (!brandId) {
            throw new Error('ID da marca inválido');
        }

        const cacheKey = `${this.cachePrefix}brand:${brandId}:products`;
        return this.handleRequest('get', '/products', {
            params: {
                brand_id: brandId,
                fields: this.defaultFields
            }
        }, { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.productList });
    }

    // Métodos de busca avançada
    async searchByPrice(minPrice, maxPrice) {
        if (minPrice < 0 || maxPrice < 0 || minPrice > maxPrice) {
            throw new Error('Intervalo de preço inválido');
        }

        const cacheKey = `${this.cachePrefix}search:price:${minPrice}-${maxPrice}`;
        return this.handleRequest('get', '/products', {
            params: {
                price_min: minPrice,
                price_max: maxPrice,
                sort: 'price:asc',
                fields: this.defaultFields
            }
        }, { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.productList });
    }

    async searchInStock(inStock = true) {
        const cacheKey = `${this.cachePrefix}search:stock:${inStock}`;
        return this.handleRequest('get', '/products', {
            params: {
                available: inStock,
                sort: 'name:asc',
                fields: this.defaultFields
            }
        }, { key: cacheKey, ttl: NUVEMSHOP_CONFIG.cache.ttl.productList });
    }

    // Métodos de formatação
    formatPrice(value) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(value);
    }

    formatProductStatus(status) {
        const statusMap = {
            'active': '✅ Ativo',
            'paused': '⏸️ Pausado',
            'draft': '📝 Rascunho',
            'archived': '📦 Arquivado'
        };
        return statusMap[status] || status;
    }

    formatStock(quantity) {
        if (quantity === 0) return '❌ Sem estoque';
        if (quantity < 5) return `⚠️ Baixo estoque (${quantity})`;
        return `✅ Em estoque (${quantity})`;
    }

    formatDimensions(variant) {
        if (!variant.width || !variant.height || !variant.depth) {
            return null;
        }

        return {
            formatted: `${variant.width}cm x ${variant.height}cm x ${variant.depth}cm`,
            width: variant.width,
            height: variant.height,
            depth: variant.depth
        };
    }

    extractMainImage(product) {
        if (!product.images || !product.images.length) {
            return null;
        }

        const mainImage = product.images[0];
        return {
            id: mainImage.id,
            url: mainImage.src,
            alt: mainImage.alt || product.name,
            position: mainImage.position
        };
    }

    calculateDiscount(variant) {
        if (!variant.compare_at_price || variant.compare_at_price <= variant.price) {
            return null;
        }

        const discount = variant.compare_at_price - variant.price;
        const percentage = (discount / variant.compare_at_price) * 100;

        return {
            value: discount,
            percentage: Math.round(percentage),
            formattedValue: this.formatPrice(discount),
            formattedPercentage: `${Math.round(percentage)}%`
        };
    }

    async getRelatedProducts(productId, limit = 4) {
        this.validateProductId(productId);
        
        const cacheKey = `${this.cachePrefix}${productId}:related:${limit}`;
        const cachedData = await this.cacheService.get(cacheKey);
        if (cachedData) {
            return cachedData;
        }

        const product = await this.getProduct(productId);

        if (!product.categories || !product.categories.length) {
            return [];
        }

        const categoryId = product.categories[0].id;
        const related = await this.getProductsByCategory(categoryId);

        const formattedRelated = related
            .filter(p => p.id !== productId)
            .slice(0, limit)
            .map(p => ({
                id: p.id,
                name: p.name,
                price: p.variants[0]?.price,
                image: this.extractMainImage(p),
                url: p.permalink
            }));

        await this.cacheService.set(cacheKey, formattedRelated, NUVEMSHOP_CONFIG.cache.ttl.productList);
        return formattedRelated;
    }
}

module.exports = { ProductApi };
