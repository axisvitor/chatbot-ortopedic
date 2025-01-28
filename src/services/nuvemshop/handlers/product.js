const { NuvemshopBase } = require('../base');
const logger = require('../../../utils/logger');

class ProductHandler extends NuvemshopBase {
    constructor(cacheService) {
        super(cacheService);
    }

    /**
     * Processa novo produto
     */
    async handleNewProduct(product) {
        try {
            logger.info('ProcessingNewProduct', {
                productId: product.id,
                timestamp: new Date().toISOString()
            });

            // Validação inicial
            if (!this._validateProductData(product)) {
                return {
                    success: false,
                    message: 'Dados do produto inválidos'
                };
            }

            // Processa imagens
            await this._processImages(product);

            // Atualiza categorias
            await this._updateCategories(product);

            // Atualiza variantes
            await this._updateVariants(product);

            return {
                success: true,
                message: 'Produto processado com sucesso'
            };

        } catch (error) {
            logger.error('NewProductError', {
                productId: product.id,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                message: 'Erro ao processar produto',
                error: error.message
            };
        }
    }

    /**
     * Processa atualização de produto
     */
    async handleProductUpdate(productId, updates) {
        try {
            logger.info('ProcessingProductUpdate', {
                productId,
                updates,
                timestamp: new Date().toISOString()
            });

            // Valida atualizações
            if (!this._validateUpdates(updates)) {
                return {
                    success: false,
                    message: 'Dados de atualização inválidos'
                };
            }

            // Atualiza produto
            await this._makeRequest('PUT', `/products/${productId}`, {
                data: updates
            });

            // Invalida cache
            const cacheKey = this._generateCacheKey('product', productId);
            await this.cacheService.del(cacheKey);

            return {
                success: true,
                message: 'Produto atualizado com sucesso'
            };

        } catch (error) {
            logger.error('ProductUpdateError', {
                productId,
                updates,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                message: 'Erro ao atualizar produto',
                error: error.message
            };
        }
    }

    /**
     * Processa exclusão de produto
     */
    async handleProductDeletion(productId) {
        try {
            logger.info('ProcessingProductDeletion', {
                productId,
                timestamp: new Date().toISOString()
            });

            // Remove produto
            await this._makeRequest('DELETE', `/products/${productId}`);

            // Limpa cache
            const cacheKey = this._generateCacheKey('product', productId);
            await this.cacheService.del(cacheKey);

            // Remove imagens
            await this._cleanupImages(productId);

            return {
                success: true,
                message: 'Produto removido com sucesso'
            };

        } catch (error) {
            logger.error('ProductDeletionError', {
                productId,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                message: 'Erro ao remover produto',
                error: error.message
            };
        }
    }

    // Métodos privados de validação e processamento

    _validateProductData(product) {
        return product && 
               product.id && 
               product.name && 
               product.price && 
               Array.isArray(product.variants);
    }

    _validateUpdates(updates) {
        const allowedFields = ['name', 'description', 'price', 'stock', 'status'];
        return updates && Object.keys(updates).every(key => allowedFields.includes(key));
    }

    async _processImages(product) {
        if (!product.images || !Array.isArray(product.images)) {
            return;
        }

        for (const image of product.images) {
            try {
                await this._makeRequest('POST', `/products/${product.id}/images`, {
                    data: {
                        src: image.url,
                        position: image.position
                    }
                });
            } catch (error) {
                logger.error('ImageProcessingError', {
                    productId: product.id,
                    imageUrl: image.url,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    async _updateCategories(product) {
        if (!product.categories || !Array.isArray(product.categories)) {
            return;
        }

        try {
            await this._makeRequest('PUT', `/products/${product.id}`, {
                data: {
                    categories: product.categories
                }
            });
        } catch (error) {
            logger.error('CategoryUpdateError', {
                productId: product.id,
                categories: product.categories,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    async _updateVariants(product) {
        if (!product.variants || !Array.isArray(product.variants)) {
            return;
        }

        for (const variant of product.variants) {
            try {
                if (variant.id) {
                    await this._makeRequest('PUT', `/products/${product.id}/variants/${variant.id}`, {
                        data: variant
                    });
                } else {
                    await this._makeRequest('POST', `/products/${product.id}/variants`, {
                        data: variant
                    });
                }
            } catch (error) {
                logger.error('VariantUpdateError', {
                    productId: product.id,
                    variantId: variant.id,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    async _cleanupImages(productId) {
        try {
            const images = await this._makeRequest('GET', `/products/${productId}/images`);
            for (const image of images) {
                await this._makeRequest('DELETE', `/products/${productId}/images/${image.id}`);
            }
        } catch (error) {
            logger.error('ImageCleanupError', {
                productId,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = { ProductHandler };
