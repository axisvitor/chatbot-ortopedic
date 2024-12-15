const magicNumbers = {
    'image/jpeg': ['FFD8FF'],
    'image/png': ['89504E47'],
    'image/gif': ['47494638'],
    'image/webp': ['52494646'],
    'image/heic': ['00000020'],
    'image/heif': ['00000020']
};

/**
 * Verifica se uma string base64 representa uma imagem válida
 * @param {string} base64String - String base64 completa incluindo o prefixo data:image
 * @returns {boolean} - true se a imagem for válida, false caso contrário
 */
function isValidBase64Image(base64String) {
    try {
        // Verifica se a string está vazia ou não é uma string
        if (!base64String || typeof base64String !== 'string') {
            console.log('[Validator] String base64 inválida ou vazia');
            return false;
        }

        // Verifica o formato básico da string base64
        if (!base64String.startsWith('data:image/')) {
            console.log('[Validator] String base64 não começa com data:image/');
            return false;
        }

        // Extrai o tipo MIME e os dados
        const [header, base64Data] = base64String.split(',');
        if (!header || !base64Data) {
            console.log('[Validator] Formato base64 inválido');
            return false;
        }

        // Extrai o tipo MIME
        const mime = header.split(':')[1].split(';')[0];
        if (!magicNumbers[mime]) {
            console.log('[Validator] Tipo MIME não suportado:', mime);
            return false;
        }

        // Decodifica os primeiros bytes para verificar o magic number
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length < 8) {
            console.log('[Validator] Buffer muito pequeno');
            return false;
        }

        // Verifica o magic number
        const magicNumber = buffer.slice(0, 4).toString('hex').toUpperCase();
        const isValidMagicNumber = magicNumbers[mime].some(validNumber => 
            magicNumber.startsWith(validNumber)
        );

        if (!isValidMagicNumber) {
            console.log('[Validator] Magic number inválido:', magicNumber);
            return false;
        }

        // Log de sucesso com detalhes
        console.log('[Validator] Imagem válida:', {
            mime,
            magicNumber,
            bufferSize: buffer.length,
            base64Length: base64Data.length
        });

        return true;

    } catch (error) {
        console.error('[Validator] Erro na validação:', error);
        return false;
    }
}

module.exports = { isValidBase64Image };
