const logger = require('../../utils/logger');

class ValidationBase {
    constructor(config = {}) {
        this.config = {
            maxRetries: 3,
            retryDelay: 1000,
            cacheEnabled: true,
            cacheTTL: 300,
            ...config
        };

        this.errors = [];
        this.warnings = [];
    }

    /**
     * Adiciona erro de validação
     * @protected
     */
    _addError(code, message, details = {}) {
        const error = {
            code,
            message,
            details,
            timestamp: new Date().toISOString()
        };

        this.errors.push(error);
        logger.error('ValidationError', error);
    }

    /**
     * Adiciona aviso de validação
     * @protected
     */
    _addWarning(code, message, details = {}) {
        const warning = {
            code,
            message,
            details,
            timestamp: new Date().toISOString()
        };

        this.warnings.push(warning);
        logger.warn('ValidationWarning', warning);
    }

    /**
     * Limpa erros e avisos
     * @protected
     */
    _clearValidation() {
        this.errors = [];
        this.warnings = [];
    }

    /**
     * Verifica se há erros
     * @protected
     */
    _hasErrors() {
        return this.errors.length > 0;
    }

    /**
     * Verifica se há avisos
     * @protected
     */
    _hasWarnings() {
        return this.warnings.length > 0;
    }

    /**
     * Obtém resultado da validação
     * @protected
     */
    _getValidationResult() {
        return {
            isValid: !this._hasErrors(),
            hasWarnings: this._hasWarnings(),
            errors: this.errors,
            warnings: this.warnings
        };
    }

    /**
     * Executa função com retry
     * @protected
     */
    async _withRetry(fn, context = null) {
        let lastError;

        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                return await fn.call(context);
            } catch (error) {
                lastError = error;
                logger.warn('ValidationRetry', {
                    attempt,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });

                if (attempt < this.config.maxRetries) {
                    await new Promise(resolve => 
                        setTimeout(resolve, this.config.retryDelay * attempt)
                    );
                }
            }
        }

        throw lastError;
    }

    /**
     * Formata mensagem de erro
     * @protected
     */
    _formatErrorMessage(template, params = {}) {
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            return params[key] !== undefined ? params[key] : match;
        });
    }

    /**
     * Gera chave de cache
     * @protected
     */
    _generateCacheKey(prefix, ...parts) {
        return `validation:${prefix}:${parts.join(':')}`;
    }
}

module.exports = { ValidationBase };
