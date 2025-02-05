const logger = require('../../utils/logger');
const { NuvemshopBase } = require('./base');
const { OrderService } = require('./services/order');
const { ProductService } = require('./services/product');
const { CustomerService } = require('./services/customer');
const { WebhookHandler } = require('./webhooks/handler');
const { WebhookValidator } = require('./webhooks/validator');
const { NuvemshopFormatter } = require('./utils/formatter');
const { NuvemshopI18n } = require('./utils/i18n');
const { NuvemshopCache } = require('./utils/cache');
const { NuvemshopHttpClient } = require('./utils/http-client');
const { NUVEMSHOP_CONFIG } = require('../../config/settings');

class NuvemshopService {
    constructor(cacheService) {
        this.httpClient = new NuvemshopHttpClient();
        this.formatter = new NuvemshopFormatter();
        this.i18n = new NuvemshopI18n();
        this.cacheService = cacheService;
        this.cache = cacheService ? new NuvemshopCache(cacheService) : null;
        
        // Inicializa serviços com dependências
        this.orderService = new OrderService(cacheService);
        this.productService = new ProductService(cacheService);
        this.customerService = new CustomerService(cacheService);
        this.webhookHandler = new WebhookHandler(this.cache);

        logger.info('NuvemshopServiceInitialized', {
            hasCacheService: !!cacheService,
            timestamp: new Date().toISOString()
        });
    }

    // Métodos de Pedido
    async getOrderByNumber(orderNumber) {
        return this.orderService.getOrderByNumber(orderNumber);
    }

    async getOrders(options = {}) {
        return this.orderService.getOrders(options);
    }

    async getRecentOrdersByPhone(phone, options = {}) {
        return this.orderService.getRecentOrdersByPhone(phone, options);
    }

    async getOrderByTrackingNumber(trackingNumber) {
        return this.orderService.getOrderByTrackingNumber(trackingNumber);
    }

    async isOrderPendingPayment(orderId) {
        return this.orderService.isOrderPendingPayment(orderId);
    }

    // Métodos de Produto
    async getProduct(productId) {
        return this.productService.getProduct(productId);
    }

    async getProducts(options = {}) {
        return this.productService.getProducts(options);
    }

    async searchProducts(query, params = {}) {
        return this.productService.searchProducts(query, params);
    }

    async getProductBySku(sku) {
        return this.productService.getProductBySku(sku);
    }

    async getProductsByCategory(categoryId, params = {}) {
        return this.productService.getProductsByCategory(categoryId, params);
    }

    // Métodos de Cliente
    async getCustomer(customerId) {
        return this.customerService.getCustomer(customerId);
    }

    // Métodos de Webhook
    async handleWebhook(payload, signature) {
        return this.webhookHandler.handleWebhook(payload, signature);
    }

    // Método de teste de conexão
    async testConnection() {
        return this.httpClient.testConnection();
    }
}

module.exports = {
    NuvemshopBase,
    OrderService,
    ProductService,
    CustomerService,
    WebhookHandler,
    WebhookValidator,
    NuvemshopFormatter,
    NuvemshopI18n,
    NuvemshopCache,
    NuvemshopHttpClient,
    NUVEMSHOP_CONFIG,
    NuvemshopService
};
