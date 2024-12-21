const axios = require('axios');
const { RedisStore } = require('../store/redis-store');
const { NUVEMSHOP_CONFIG } = require('../config/settings');

class NuvemshopService {
    constructor() {
        this.redisStore = new RedisStore();
        this.axios = axios.create({
            baseURL: NUVEMSHOP_CONFIG.apiUrl,
            headers: {
                'Content-Type': 'application/json',
                'Authentication': `Bearer ${NUVEMSHOP_CONFIG.accessToken}`
            },
            timeout: 30000
        });
    }

    async _makeRequest(method, url, data = null, attempt = 1) {
        try {
            const response = await this.axios({
                method,
                url,
                data
            });

            if (response.status >= 200 && response.status < 300) {
                return response.data;
            } else {
                console.error(`❌ Erro na API Nuvemshop (Tentativa ${attempt}):`, response.status, response.data);
                throw new Error(`Erro na API Nuvemshop: ${response.status} - ${JSON.stringify(response.data)}`);
            }
        } catch (error) {
            console.error(`❌ Erro na requisição Nuvemshop (Tentativa ${attempt}):`, error.message);
            if (error.response && error.response.status === 429) {
                const retryAfter = parseInt(error.response.headers['retry-after'] || 1, 10);
                console.warn(`⚠️ Rate limit atingido. Tentando novamente em ${retryAfter} segundos.`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return this._makeRequest(method, url, data, attempt + 1);
            }
            if (attempt < 3) {
                 const delay = 1000 * attempt;
                console.warn(`⚠️ Tentando novamente em ${delay/1000} segundos.`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this._makeRequest(method, url, data, attempt + 1);
            }
            throw new Error(`Falha na requisição Nuvemshop após ${attempt} tentativas: ${error.message}`);
        }
    }

    async getProduct(productId) {
        return this._makeRequest('get', `/products/${productId}`);
    }

    async getOrder(orderId) {
        return this._makeRequest('get', `/orders/${orderId}`);
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
}

module.exports = { NuvemshopService }; 