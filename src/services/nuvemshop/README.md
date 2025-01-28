# Serviço Nuvemshop

Este módulo fornece uma interface completa para integração com a API da Nuvemshop, incluindo gerenciamento de pedidos, produtos, clientes e webhooks.

## Estrutura

```
nuvemshop/
├── base.js                # Classe base com funcionalidades compartilhadas
├── index.js              # Exporta todos os módulos
├── config/
│   └── settings.js       # Configurações do serviço
├── services/
│   ├── order.js         # Serviço de pedidos
│   ├── product.js       # Serviço de produtos
│   └── customer.js      # Serviço de clientes
├── webhooks/
│   ├── handler.js       # Manipulador de webhooks
│   └── validator.js     # Validador de webhooks
└── utils/
    ├── formatter.js     # Formatação de dados
    ├── i18n.js         # Internacionalização
    ├── cache.js        # Gerenciamento de cache
    └── http-client.js  # Cliente HTTP
```

## Módulos

### Base
- `NuvemshopBase`: Classe base com funcionalidades compartilhadas entre os serviços

### Serviços
- `OrderService`: Gerenciamento de pedidos
- `ProductService`: Gerenciamento de produtos
- `CustomerService`: Gerenciamento de clientes

### Webhooks
- `WebhookHandler`: Processamento de webhooks
- `WebhookValidator`: Validação de webhooks

### Utilitários
- `NuvemshopFormatter`: Formatação de dados
- `NuvemshopI18n`: Internacionalização
- `NuvemshopCache`: Gerenciamento de cache
- `NuvemshopHttpClient`: Cliente HTTP

## Configuração

O arquivo `config/settings.js` contém todas as configurações necessárias:

```javascript
const NUVEMSHOP_CONFIG = {
    apiUrl: process.env.NUVEMSHOP_API_URL,
    accessToken: process.env.NUVEMSHOP_ACCESS_TOKEN,
    userId: process.env.NUVEMSHOP_USER_ID,
    webhook: {
        secret: process.env.NUVEMSHOP_WEBHOOK_SECRET
    },
    // ... outras configurações
};
```

## Uso

```javascript
const {
    OrderService,
    ProductService,
    CustomerService,
    WebhookHandler
} = require('./nuvemshop');

// Inicializa serviços
const orderService = new OrderService(cacheService);
const productService = new ProductService(cacheService);
const customerService = new CustomerService(cacheService);
const webhookHandler = new WebhookHandler(cacheService);

// Exemplo: Busca pedido
const order = await orderService.getOrderByNumber('123456');

// Exemplo: Busca produto
const product = await productService.getProduct('789');

// Exemplo: Busca cliente
const customer = await customerService.getCustomerByEmail('cliente@email.com');

// Exemplo: Processa webhook
const result = await webhookHandler.handleWebhook(payload, signature);
```

## Cache

O serviço utiliza cache para otimizar o desempenho:

- Pedidos: 5 minutos
- Produtos: 10 minutos
- Clientes: 15 minutos
- Categorias e Marcas: 30 minutos

## Webhooks

Eventos suportados:

- `orders/created`
- `orders/paid`
- `orders/fulfilled`
- `orders/cancelled`
- `products/created`
- `products/updated`
- `products/deleted`
- `customers/created`
- `customers/updated`

## Internacionalização

Suporte para múltiplos idiomas:

- Português (pt)
- Espanhol (es)
- Inglês (en)

## Logs

O serviço utiliza um sistema de logs estruturado:

```javascript
logger.info('PedidoCriado', {
    numero: order.number,
    cliente: order.customer?.name,
    total: order.total,
    timestamp: new Date().toISOString()
});
```

## Segurança

- Validação de assinatura de webhooks
- Rate limiting
- Filtragem de IPs
- Timeout em requisições
- Retry automático em falhas

## Dependências

- Node.js >= 14
- Redis (para cache)
- Axios (para requisições HTTP)

## Variáveis de Ambiente

```env
NUVEMSHOP_API_URL=https://api.nuvemshop.com.br/v1
NUVEMSHOP_ACCESS_TOKEN=seu_token_aqui
NUVEMSHOP_USER_ID=seu_user_id_aqui
NUVEMSHOP_WEBHOOK_SECRET=seu_webhook_secret_aqui
NUVEMSHOP_ALLOWED_IPS=ip1,ip2,ip3
```

## Contribuição

1. Faça o fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Crie um Pull Request
