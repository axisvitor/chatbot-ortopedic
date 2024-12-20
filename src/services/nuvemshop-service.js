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

    async getOrderTotalTax(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax) {
            return null;
        }
        return order.total_tax;
    }

    async getOrderTotalTaxDetails(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details) {
            return null;
        }
        return order.total_tax_details;
    }

    async getOrderTotalTaxDetailsDetails(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details) {
            return null;
        }
        return order.total_tax_details_details;
    }

    async getOrderTotalTaxDetailsDetailsAmount(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_amount) {
            return null;
        }
        return order.total_tax_details_details_amount;
    }

    async getOrderTotalTaxDetailsDetailsRate(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_rate) {
            return null;
        }
        return order.total_tax_details_details_rate;
    }

    async getOrderTotalTaxDetailsDetailsName(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_name) {
            return null;
        }
        return order.total_tax_details_details_name;
    }

    async getOrderTotalTaxDetailsDetailsType(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_type) {
            return null;
        }
        return order.total_tax_details_details_type;
    }

    async getOrderTotalTaxDetailsDetailsValue(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_value) {
            return null;
        }
        return order.total_tax_details_details_value;
    }

    async getOrderTotalTaxDetailsDetailsLabel(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_label) {
            return null;
        }
        return order.total_tax_details_details_label;
    }

    async getOrderTotalTaxDetailsDetailsCode(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_code) {
            return null;
        }
        return order.total_tax_details_details_code;
    }

    async getOrderTotalTaxDetailsDetailsDescription(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_description) {
            return null;
        }
        return order.total_tax_details_details_description;
    }

    async getOrderTotalTaxDetailsDetailsDetails(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details) {
            return null;
        }
        return order.total_tax_details_details_details;
    }

    async getOrderTotalTaxDetailsDetailsDetailsAmount(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_amount) {
            return null;
        }
        return order.total_tax_details_details_details_amount;
    }

    async getOrderTotalTaxDetailsDetailsDetailsRate(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_rate) {
            return null;
        }
        return order.total_tax_details_details_details_rate;
    }

    async getOrderTotalTaxDetailsDetailsDetailsName(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_name) {
            return null;
        }
        return order.total_tax_details_details_details_name;
    }

    async getOrderTotalTaxDetailsDetailsDetailsType(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_type) {
            return null;
        }
        return order.total_tax_details_details_details_type;
    }

    async getOrderTotalTaxDetailsDetailsDetailsValue(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_value) {
            return null;
        }
        return order.total_tax_details_details_details_value;
    }

    async getOrderTotalTaxDetailsDetailsDetailsLabel(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_label) {
            return null;
        }
        return order.total_tax_details_details_details_label;
    }

    async getOrderTotalTaxDetailsDetailsDetailsCode(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_code) {
            return null;
        }
        return order.total_tax_details_details_details_code;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDescription(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_description) {
            return null;
        }
        return order.total_tax_details_details_details_description;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDetails(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_details) {
            return null;
        }
        return order.total_tax_details_details_details_details;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDetailsAmount(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_details_amount) {
            return null;
        }
        return order.total_tax_details_details_details_details_amount;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDetailsRate(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_details_rate) {
            return null;
        }
        return order.total_tax_details_details_details_details_rate;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDetailsName(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_details_name) {
            return null;
        }
        return order.total_tax_details_details_details_details_name;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDetailsType(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_details_type) {
            return null;
        }
        return order.total_tax_details_details_details_details_type;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDetailsValue(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_details_value) {
            return null;
        }
        return order.total_tax_details_details_details_details_value;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDetailsLabel(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_details_label) {
            return null;
        }
        return order.total_tax_details_details_details_details_label;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDetailsCode(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_details_code) {
            return null;
        }
        return order.total_tax_details_details_details_details_code;
    }

    async getOrderTotalTaxDetailsDetailsDetailsDetailsDescription(orderId) {
        const order = await this.getOrder(orderId);
        if (!order || !order.total_tax_details_details_details_details_description) {
            return null;
        }
        return order.total_tax_details_details_details_details_description;
    }
}

module.exports = { NuvemshopService }; 