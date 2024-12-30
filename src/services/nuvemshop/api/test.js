const { OrderApi } = require('./order');

async function testOrderSearch() {
    try {
        const orderApi = new OrderApi();
        console.log('Buscando pedido...');
        const order = await orderApi.getOrderByNumber('2913');
        console.log('Resultado:', JSON.stringify(order, null, 2));
    } catch (error) {
        console.error('Erro:', error.message);
    }
}

testOrderSearch();
