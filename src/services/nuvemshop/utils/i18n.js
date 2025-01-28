const { NUVEMSHOP_CONFIG } = require('../config/settings');

class NuvemshopI18n {
    constructor() {
        this.config = NUVEMSHOP_CONFIG.i18n;
        this.defaultLanguage = this.config.defaultLanguage;
        this.supportedLanguages = this.config.supportedLanguages;
    }

    /**
     * Processa respostas com múltiplos idiomas
     * @param {Object} data - Dados da resposta
     * @param {string} mainLanguage - Idioma principal
     * @returns {Object} Dados processados
     */
    processMultiLanguageResponse(data, mainLanguage = null) {
        if (!data) return data;

        const language = mainLanguage || this.defaultLanguage;

        const processValue = (value) => {
            if (typeof value === 'object' && value !== null) {
                // Se for um objeto de idiomas, retorna o valor do idioma principal ou o primeiro disponível
                return value[language] || Object.values(value)[0];
            }
            return value;
        };

        return Object.entries(data).reduce((acc, [key, value]) => {
            acc[key] = processValue(value);
            return acc;
        }, {});
    }

    /**
     * Processa dados multilíngues
     * @param {Object} data - Dados a serem processados
     * @param {string} mainLanguage - Idioma principal
     * @returns {Object} Dados processados
     */
    processMultiLanguageData(data, mainLanguage = null) {
        if (!data) return data;

        const language = mainLanguage || this.defaultLanguage;

        const processValue = (value) => {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                // Se for um objeto de idiomas, retorna o valor do idioma principal ou o primeiro disponível
                if (value[language]) return value[language];
                return Object.values(value)[0];
            }
            return value;
        };

        const result = {};
        for (const [key, value] of Object.entries(data)) {
            if (Array.isArray(value)) {
                result[key] = value.map(item => this.processMultiLanguageData(item, language));
            } else {
                result[key] = processValue(value);
            }
        }

        return result;
    }

    /**
     * Prepara dados para envio com suporte a múltiplos idiomas
     * @param {Object} data - Dados a serem enviados
     * @param {Array} multiLanguageFields - Campos que suportam múltiplos idiomas
     * @returns {Object} Dados preparados
     */
    prepareMultiLanguageData(data, multiLanguageFields = ['name', 'description']) {
        const result = {};

        for (const [key, value] of Object.entries(data)) {
            if (multiLanguageFields.includes(key) && typeof value === 'string') {
                // Se for um campo multilíngue e o valor for uma string,
                // cria um objeto com o mesmo valor para todos os idiomas
                result[key] = this.supportedLanguages.reduce((acc, lang) => {
                    acc[lang] = value;
                    return acc;
                }, {});
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * Obtém o texto no idioma especificado
     * @param {Object} data - Objeto com textos em diferentes idiomas
     * @param {string} language - Idioma desejado
     * @returns {string} Texto no idioma especificado
     */
    getText(data, language = null) {
        if (!data) return null;

        const targetLanguage = language || this.defaultLanguage;

        // Se for uma string, retorna ela mesma
        if (typeof data === 'string') return data;

        // Se for um objeto de idiomas
        if (typeof data === 'object') {
            // Tenta o idioma alvo
            if (data[targetLanguage]) return data[targetLanguage];

            // Tenta o idioma padrão
            if (data[this.defaultLanguage]) return data[this.defaultLanguage];

            // Retorna o primeiro valor disponível
            return Object.values(data)[0];
        }

        return null;
    }

    /**
     * Verifica se um idioma é suportado
     * @param {string} language - Idioma a ser verificado
     * @returns {boolean} true se o idioma é suportado
     */
    isLanguageSupported(language) {
        return this.supportedLanguages.includes(language);
    }
}

module.exports = { NuvemshopI18n };
