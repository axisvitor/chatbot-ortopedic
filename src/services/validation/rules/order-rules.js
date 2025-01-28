const { ValidationBase } = require('../base');
const logger = require('../../../utils/logger');

class OrderValidationRules extends ValidationBase {
    constructor(config = {}) {
        super(config);

        // Regras padrão
        this.rules = {
            status: {
                allowed: ['pending', 'processing', 'paid', 'shipped', 'delivered', 'cancelled'],
                transitions: {
                    'pending': ['processing', 'cancelled'],
                    'processing': ['paid', 'cancelled'],
                    'paid': ['shipped', 'cancelled'],
                    'shipped': ['delivered', 'cancelled'],
                    'delivered': ['cancelled'],
                    'cancelled': []
                }
            },
            payment: {
                methods: ['credit_card', 'debit_card', 'bank_slip', 'pix'],
                minAmount: 0.01,
                maxAmount: 99999.99
            },
            shipping: {
                methods: ['sedex', 'pac', 'custom'],
                requiredFields: ['address', 'city', 'state', 'zipcode']
            },
            customer: {
                requiredFields: ['name', 'email', 'phone'],
                emailPattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                phonePattern: /^\+?[\d\s-()]{8,}$/
            }
        };
    }

    /**
     * Valida status do pedido
     */
    validateStatus(currentStatus, newStatus) {
        // Verifica se status é válido
        if (!this.rules.status.allowed.includes(newStatus)) {
            this._addError('INVALID_STATUS', 
                'Status inválido',
                { currentStatus, newStatus, allowed: this.rules.status.allowed }
            );
            return false;
        }

        // Verifica transição de status
        const allowedTransitions = this.rules.status.transitions[currentStatus] || [];
        if (!allowedTransitions.includes(newStatus)) {
            this._addError('INVALID_STATUS_TRANSITION',
                'Transição de status não permitida',
                { currentStatus, newStatus, allowed: allowedTransitions }
            );
            return false;
        }

        return true;
    }

    /**
     * Valida dados de pagamento
     */
    validatePayment(payment) {
        if (!payment) {
            this._addError('MISSING_PAYMENT', 'Dados de pagamento não fornecidos');
            return false;
        }

        // Valida método de pagamento
        if (!this.rules.payment.methods.includes(payment.method)) {
            this._addError('INVALID_PAYMENT_METHOD',
                'Método de pagamento inválido',
                { method: payment.method, allowed: this.rules.payment.methods }
            );
            return false;
        }

        // Valida valor
        const amount = Number(payment.amount);
        if (isNaN(amount) || amount < this.rules.payment.minAmount || amount > this.rules.payment.maxAmount) {
            this._addError('INVALID_PAYMENT_AMOUNT',
                'Valor de pagamento inválido',
                { 
                    amount,
                    min: this.rules.payment.minAmount,
                    max: this.rules.payment.maxAmount
                }
            );
            return false;
        }

        return true;
    }

    /**
     * Valida dados de envio
     */
    validateShipping(shipping) {
        if (!shipping) {
            this._addError('MISSING_SHIPPING', 'Dados de envio não fornecidos');
            return false;
        }

        // Valida método de envio
        if (!this.rules.shipping.methods.includes(shipping.method)) {
            this._addError('INVALID_SHIPPING_METHOD',
                'Método de envio inválido',
                { method: shipping.method, allowed: this.rules.shipping.methods }
            );
            return false;
        }

        // Valida campos obrigatórios
        for (const field of this.rules.shipping.requiredFields) {
            if (!shipping[field]) {
                this._addError('MISSING_SHIPPING_FIELD',
                    `Campo obrigatório de envio não fornecido: ${field}`,
                    { field }
                );
                return false;
            }
        }

        return true;
    }

    /**
     * Valida dados do cliente
     */
    validateCustomer(customer) {
        if (!customer) {
            this._addError('MISSING_CUSTOMER', 'Dados do cliente não fornecidos');
            return false;
        }

        // Valida campos obrigatórios
        for (const field of this.rules.customer.requiredFields) {
            if (!customer[field]) {
                this._addError('MISSING_CUSTOMER_FIELD',
                    `Campo obrigatório do cliente não fornecido: ${field}`,
                    { field }
                );
                return false;
            }
        }

        // Valida email
        if (!this.rules.customer.emailPattern.test(customer.email)) {
            this._addError('INVALID_CUSTOMER_EMAIL',
                'Email do cliente inválido',
                { email: customer.email }
            );
            return false;
        }

        // Valida telefone
        if (!this.rules.customer.phonePattern.test(customer.phone)) {
            this._addError('INVALID_CUSTOMER_PHONE',
                'Telefone do cliente inválido',
                { phone: customer.phone }
            );
            return false;
        }

        return true;
    }

    /**
     * Valida produtos do pedido
     */
    validateProducts(products) {
        if (!Array.isArray(products) || products.length === 0) {
            this._addError('INVALID_PRODUCTS',
                'Lista de produtos inválida ou vazia'
            );
            return false;
        }

        let isValid = true;

        products.forEach((product, index) => {
            if (!product.id) {
                this._addError('MISSING_PRODUCT_ID',
                    'ID do produto não fornecido',
                    { index }
                );
                isValid = false;
            }

            if (!product.quantity || product.quantity <= 0) {
                this._addError('INVALID_PRODUCT_QUANTITY',
                    'Quantidade do produto inválida',
                    { index, product: product.id, quantity: product.quantity }
                );
                isValid = false;
            }

            if (!product.price || product.price <= 0) {
                this._addError('INVALID_PRODUCT_PRICE',
                    'Preço do produto inválido',
                    { index, product: product.id, price: product.price }
                );
                isValid = false;
            }
        });

        return isValid;
    }
}

module.exports = { OrderValidationRules };
