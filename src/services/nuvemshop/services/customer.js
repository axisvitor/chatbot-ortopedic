const { NuvemshopBase } = require('../base');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const logger = require('../../../utils/logger');

class CustomerService extends NuvemshopBase {
    constructor(cacheService) {
        super(cacheService);
    }

    /**
     * Busca cliente por ID
     * @param {string} customerId - ID do cliente
     * @returns {Promise<Object>} Cliente encontrado
     */
    async getCustomer(customerId) {
        try {
            const cacheKey = this.generateCacheKey('customer', customerId);
            return this.getCachedData(
                cacheKey,
                async () => {
                    const response = await this.client.get(
                        `/${NUVEMSHOP_CONFIG.userId}/customers/${customerId}`
                    );
                    return response.data;
                },
                NUVEMSHOP_CONFIG.cache.customersTtl
            );
        } catch (error) {
            logger.error('ErroBuscarCliente', {
                erro: error.message,
                stack: error.stack,
                clienteId: customerId,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Busca clientes com paginação
     * @param {Object} options - Opções de busca
     * @returns {Promise<Object>} Clientes e informações de paginação
     */
    async getCustomers(options = {}) {
        const cacheKey = this.generateCacheKey('customers', 'list', options);
        return this.getCachedData(
            cacheKey,
            async () => {
                const params = {
                    page: options.page || 1,
                    per_page: Math.min(options.per_page || 50, 200),
                    ...options
                };

                const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/customers`, { params });
                
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
            NUVEMSHOP_CONFIG.cache.customersTtl
        );
    }

    /**
     * Busca cliente por email
     * @param {string} email - Email do cliente
     * @returns {Promise<Object>} Cliente encontrado
     */
    async getCustomerByEmail(email) {
        try {
            const { data: customers } = await this.getCustomers({
                q: email
            });

            // Encontra cliente com email exato
            return customers.find(customer => 
                customer.email?.toLowerCase() === email.toLowerCase()
            );
        } catch (error) {
            logger.error('ErroBuscarClientePorEmail', {
                erro: error.message,
                stack: error.stack,
                email,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Busca cliente por telefone
     * @param {string} phone - Telefone do cliente
     * @returns {Promise<Object>} Cliente encontrado
     */
    async getCustomerByPhone(phone) {
        try {
            // Remove caracteres não numéricos
            const cleanPhone = phone.replace(/\D/g, '');
            
            const { data: customers } = await this.getCustomers({
                q: cleanPhone
            });

            // Encontra cliente com telefone correspondente
            return customers.find(customer => {
                const customerPhone = customer.phone?.replace(/\D/g, '');
                return customerPhone && customerPhone.includes(cleanPhone);
            });
        } catch (error) {
            logger.error('ErroBuscarClientePorTelefone', {
                erro: error.message,
                stack: error.stack,
                telefone: phone,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Busca cliente por documento (CPF/CNPJ)
     * @param {string} document - Documento do cliente
     * @returns {Promise<Object>} Cliente encontrado
     */
    async getCustomerByDocument(document) {
        try {
            // Remove caracteres não numéricos
            const cleanDocument = document.replace(/\D/g, '');
            
            const { data: customers } = await this.getCustomers({
                q: cleanDocument
            });

            // Encontra cliente com documento exato
            return customers.find(customer => {
                const customerDoc = customer.identification?.replace(/\D/g, '');
                return customerDoc === cleanDocument;
            });
        } catch (error) {
            logger.error('ErroBuscarClientePorDocumento', {
                erro: error.message,
                stack: error.stack,
                documento: document,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Busca endereços do cliente
     * @param {string} customerId - ID do cliente
     * @returns {Promise<Array>} Lista de endereços
     */
    async getCustomerAddresses(customerId) {
        try {
            const customer = await this.getCustomer(customerId);
            return customer?.addresses || [];
        } catch (error) {
            logger.error('ErroBuscarEnderecos', {
                erro: error.message,
                stack: error.stack,
                clienteId: customerId,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    /**
     * Busca pedidos do cliente
     * @param {string} customerId - ID do cliente
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de pedidos
     */
    async getCustomerOrders(customerId, options = {}) {
        try {
            const { data: orders } = await this.getOrders({
                customer_id: customerId,
                ...options
            });
            return orders;
        } catch (error) {
            logger.error('ErroBuscarPedidosCliente', {
                erro: error.message,
                stack: error.stack,
                clienteId: customerId,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    /**
     * Busca total gasto pelo cliente
     * @param {string} customerId - ID do cliente
     * @returns {Promise<number>} Total gasto
     */
    async getCustomerTotalSpent(customerId) {
        try {
            const orders = await this.getCustomerOrders(customerId);
            return orders.reduce((total, order) => total + (order.total || 0), 0);
        } catch (error) {
            logger.error('ErroBuscarTotalGasto', {
                erro: error.message,
                stack: error.stack,
                clienteId: customerId,
                timestamp: new Date().toISOString()
            });
            return 0;
        }
    }

    /**
     * Busca última compra do cliente
     * @param {string} customerId - ID do cliente
     * @returns {Promise<Object>} Último pedido
     */
    async getCustomerLastOrder(customerId) {
        try {
            const orders = await this.getCustomerOrders(customerId, {
                sort: '-created_at',
                per_page: 1
            });
            return orders[0] || null;
        } catch (error) {
            logger.error('ErroBuscarUltimoPedido', {
                erro: error.message,
                stack: error.stack,
                clienteId: customerId,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Busca média de compras do cliente
     * @param {string} customerId - ID do cliente
     * @returns {Promise<Object>} Estatísticas de compras
     */
    async getCustomerOrderStats(customerId) {
        try {
            const orders = await this.getCustomerOrders(customerId);
            
            if (!orders || orders.length === 0) {
                return {
                    totalOrders: 0,
                    averageOrderValue: 0,
                    totalSpent: 0
                };
            }

            const totalSpent = orders.reduce((total, order) => total + (order.total || 0), 0);
            
            return {
                totalOrders: orders.length,
                averageOrderValue: totalSpent / orders.length,
                totalSpent
            };
        } catch (error) {
            logger.error('ErroBuscarEstatisticas', {
                erro: error.message,
                stack: error.stack,
                clienteId: customerId,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Verifica se é um cliente VIP
     * @param {string} customerId - ID do cliente
     * @returns {Promise<boolean>} true se for VIP
     */
    async isVipCustomer(customerId) {
        try {
            const stats = await this.getCustomerOrderStats(customerId);
            
            if (!stats) return false;

            // Critérios para VIP:
            // - Mais de 5 pedidos OU
            // - Total gasto maior que R$ 1000
            return stats.totalOrders > 5 || stats.totalSpent > 1000;
        } catch (error) {
            logger.error('ErroVerificarVIP', {
                erro: error.message,
                stack: error.stack,
                clienteId: customerId,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }
}

module.exports = { CustomerService };
