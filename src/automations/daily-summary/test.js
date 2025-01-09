const customsSummary = require('./customs-summary');

// Executa o teste do resumo diário
async function runTest() {
    try {
        await customsSummary.test();
    } catch (error) {
        console.error('Erro no teste:', error);
        process.exit(1);
    }
}

runTest();
