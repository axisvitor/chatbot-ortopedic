const axios = require('axios');

async function testApi() {
    const apiKey = 'B98966348453793271B4F98DF05638E0';
    const url = 'https://api.17track.net/track/v2.2/gettrackinfo';
    const data = {
        "tracking_number": "RM123456789CN",
        "lang": "pt",
        "auto_detection": true
    };
    
    console.log('Fazendo requisição para:', url);
    console.log('Dados:', data);
    
    try {
        const response = await axios.post(url, data, {
            headers: {
                'Content-Type': 'application/json',
                '17token': apiKey
            },
            validateStatus: false
        });
        
        console.log('Status:', response.status);
        console.log('Headers:', response.headers);
        console.log('Data:', response.data);
    } catch (error) {
        console.error('Erro:', {
            message: error.message,
            response: error.response ? {
                status: error.response.status,
                data: error.response.data
            } : 'No response'
        });
    }
}

testApi();
