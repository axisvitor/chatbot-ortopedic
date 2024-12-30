const { createWorker } = require('tesseract.js');
const axios = require('axios');

class ImageProcessingService {
    constructor() {
        this.worker = null;
    }

    async initialize() {
        if (!this.worker) {
            this.worker = await createWorker('por');
            await this.worker.loadLanguage('por');
            await this.worker.initialize('por');
        }
    }

    /**
     * Extrai texto de uma imagem
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<string>} Texto extraído
     */
    async extractTextFromImage(imageUrl) {
        try {
            await this.initialize();
            
            // Baixa a imagem
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);

            // Processa a imagem com Tesseract
            const { data: { text } } = await this.worker.recognize(buffer);
            
            return text;
        } catch (error) {
            console.error('[ImageProcessing] Erro ao extrair texto da imagem:', error);
            throw error;
        }
    }

    /**
     * Extrai número do pedido de uma imagem
     * @param {string} imageUrl URL da imagem
     * @returns {Promise<string|null>} Número do pedido ou null se não encontrado
     */
    async extractOrderNumber(imageUrl) {
        try {
            const text = await this.extractTextFromImage(imageUrl);
            
            // Procura por padrões comuns de número de pedido
            const patterns = [
                /pedido\s+(\d{4,})/i,           // "pedido 1234"
                /pedido\s+número\s+(\d{4,})/i,  // "pedido número 1234"
                /pedido\s+#?(\d{4,})/i,         // "pedido #1234"
                /número\s+(\d{4,})/i,           // "número 1234"
                /[#]?(\d{4,})/                  // apenas dígitos ou #1234
            ];

            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match && match[1]) {
                    return match[1];
                }
            }

            console.log('[ImageProcessing] Texto extraído mas número não encontrado:', text);
            return null;
        } catch (error) {
            console.error('[ImageProcessing] Erro ao extrair número do pedido:', error);
            return null;
        }
    }

    async terminate() {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}

module.exports = { ImageProcessingService };
