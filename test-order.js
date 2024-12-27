require('dotenv').config();
const { OrderApi } = require('./src/services/nuvemshop/api/order');

async function testOrderSearch() {
    try {
        const orderApi = new OrderApi();
        
        // Teste com um número de pedido real
        const orderNumber = '2913';
        
        console.log('🔍 Buscando pedido:', orderNumber);
        
        const order = await orderApi.getOrderByNumber(orderNumber);
        
        if (order) {
            console.log('✅ Pedido encontrado:', {
                numero: order.number,
                id: order.id,
                status: order.status,
                cliente: order.customer?.name,
                rastreio: order.shipping_tracking_number
            });
        } else {
            console.log('❌ Pedido não encontrado:', orderNumber);
        }
    } catch (error) {
        console.error('❌ Erro no teste:', {
            mensagem: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
    }
}

// Executa o teste
testOrderSearch();
