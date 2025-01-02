const fs = require('fs');
const path = require('path');
const https = require('https');

// Função para baixar a imagem da URL
function downloadImage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download image: ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

async function main() {
    try {
        // URL da imagem de teste
        const imageUrl = 'https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/images/happy_dog.jpg';
        
        // Baixa a imagem
        const imageBuffer = await downloadImage(imageUrl);
        
        // Converte para base64
        const base64Image = imageBuffer.toString('base64');

        // Monta o payload
        const payload = {
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "O que está escrito nesta imagem?"
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/jpeg;base64,${base64Image}`
                            }
                        }
                    ]
                }
            ],
            temperature: 0.7,
            max_tokens: 1024
        };

        // Salva o payload em um arquivo para usar com curl
        fs.writeFileSync(
            path.join(__dirname, 'payload-local.json'),
            JSON.stringify(payload, null, 2)
        );

        console.log('✅ Payload gerado com sucesso!');
    } catch (error) {
        console.error('❌ Erro:', error);
    }
}

main();
