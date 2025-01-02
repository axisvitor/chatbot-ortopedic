const fs = require('fs');
const path = require('path');

// Função para converter imagem para base64
function imageToBase64(filePath) {
    const image = fs.readFileSync(filePath);
    return Buffer.from(image).toString('base64');
}

// Caminho da imagem de teste
const imagePath = path.join(__dirname, 'test-image.jpg');

// Converte a imagem para base64
const base64Image = imageToBase64(imagePath);

// Monta o payload da requisição
const payload = {
    model: "gpt-4o-mini",
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
    ]
};

// Salva o payload para usar com curl
fs.writeFileSync(path.join(__dirname, 'payload.json'), JSON.stringify(payload));
