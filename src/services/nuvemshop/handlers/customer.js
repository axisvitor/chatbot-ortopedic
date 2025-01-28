const { NuvemshopBase } = require('../base');
const logger = require('../../../utils/logger');

class CustomerHandler extends NuvemshopBase {
    constructor(cacheService) {
        super(cacheService);
    }

    /**
     * Processa novo cliente
     */
    async handleNewCustomer(customer) {
        try {
            logger.info('ProcessingNewCustomer', {
                customerId: customer.id,
                timestamp: new Date().toISOString()
            });

            // Validação inicial
            if (!this._validateCustomerData(customer)) {
                return {
                    success: false,
                    message: 'Dados do cliente inválidos'
                };
            }

            // Processa endereços
            await this._processAddresses(customer);

            // Atualiza tags
            await this._updateTags(customer);

            return {
                success: true,
                message: 'Cliente processado com sucesso'
            };

        } catch (error) {
            logger.error('NewCustomerError', {
                customerId: customer.id,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                message: 'Erro ao processar cliente',
                error: error.message
            };
        }
    }

    /**
     * Processa atualização de cliente
     */
    async handleCustomerUpdate(customerId, updates) {
        try {
            logger.info('ProcessingCustomerUpdate', {
                customerId,
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

            // Atualiza cliente
            await this._makeRequest('PUT', `/customers/${customerId}`, {
                data: updates
            });

            // Invalida cache
            const cacheKey = this._generateCacheKey('customer', customerId);
            await this.cacheService.del(cacheKey);

            return {
                success: true,
                message: 'Cliente atualizado com sucesso'
            };

        } catch (error) {
            logger.error('CustomerUpdateError', {
                customerId,
                updates,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                message: 'Erro ao atualizar cliente',
                error: error.message
            };
        }
    }

    /**
     * Processa exclusão de cliente
     */
    async handleCustomerDeletion(customerId) {
        try {
            logger.info('ProcessingCustomerDeletion', {
                customerId,
                timestamp: new Date().toISOString()
            });

            // Remove cliente
            await this._makeRequest('DELETE', `/customers/${customerId}`);

            // Limpa cache
            const cacheKey = this._generateCacheKey('customer', customerId);
            await this.cacheService.del(cacheKey);

            return {
                success: true,
                message: 'Cliente removido com sucesso'
            };

        } catch (error) {
            logger.error('CustomerDeletionError', {
                customerId,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                message: 'Erro ao remover cliente',
                error: error.message
            };
        }
    }

    // Métodos privados de validação e processamento

    _validateCustomerData(customer) {
        return customer && 
               customer.id && 
               customer.email &&
               this._validateEmail(customer.email);
    }

    _validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    _validateUpdates(updates) {
        const allowedFields = ['name', 'email', 'phone', 'note', 'tags'];
        return updates && Object.keys(updates).every(key => allowedFields.includes(key));
    }

    async _processAddresses(customer) {
        if (!customer.addresses || !Array.isArray(customer.addresses)) {
            return;
        }

        for (const address of customer.addresses) {
            try {
                if (address.id) {
                    await this._makeRequest('PUT', `/customers/${customer.id}/addresses/${address.id}`, {
                        data: address
                    });
                } else {
                    await this._makeRequest('POST', `/customers/${customer.id}/addresses`, {
                        data: address
                    });
                }
            } catch (error) {
                logger.error('AddressProcessingError', {
                    customerId: customer.id,
                    addressId: address.id,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    async _updateTags(customer) {
        if (!customer.tags || !Array.isArray(customer.tags)) {
            return;
        }

        try {
            await this._makeRequest('PUT', `/customers/${customer.id}`, {
                data: {
                    tags: customer.tags
                }
            });
        } catch (error) {
            logger.error('TagsUpdateError', {
                customerId: customer.id,
                tags: customer.tags,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = { CustomerHandler };
