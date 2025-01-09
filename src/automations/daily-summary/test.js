require('dotenv').config();
const customsSummary = require('./customs-summary');

async function runTest() {
    try {
        await customsSummary.test();
    } catch (error) {
        console.error('Erro no teste:', error);
    }
}

runTest();
