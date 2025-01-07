# Sistema de Rastreamento de Pedidos

Sistema automatizado para sincronização de códigos de rastreio entre Nuvemshop e 17track.

## Funcionalidades

- Integração com Nuvemshop para obter pedidos e códigos de rastreio
- Sincronização automática com 17track
- Armazenamento em Redis para cache e persistência
- Webhooks da Nuvemshop para atualizações em tempo real
- Sistema de agendamento para sincronização periódica

## Estrutura do Projeto

```
tracking-system/
├── services/           # Serviços de integração
│   ├── nuvemshop.js   # Cliente Nuvemshop
│   ├── track17.js     # Cliente 17track
│   └── track17-push.js # Serviço push do 17track
├── webhooks/          # Handlers de webhook
│   └── nuvemshop-webhook.js
├── utils/            # Utilitários
│   ├── logger.js    # Sistema de logs
│   └── redis-store.js # Cliente Redis
├── app.js           # Aplicação principal
├── scheduler.js     # Agendador de tarefas
├── sync_17track.js  # Sincronização com 17track
└── sync_tracking_codes.js # Sincronização geral
```

## Configuração

1. Crie um arquivo `.env` na raiz do projeto:

```env
# Nuvemshop
NUVEMSHOP_ACCESS_TOKEN=seu_token
NUVEMSHOP_STORE_ID=seu_store_id

# 17track
TRACK17_API_KEY=sua_chave_api

# Redis
REDIS_URL=sua_url_redis

# App
PORT=3000
NODE_ENV=production
LOG_LEVEL=info
```

2. Instale as dependências:
```bash
npm install
```

3. Inicie o servidor:
```bash
npm start
```

## Endpoints

- `/webhooks/nuvemshop`: Recebe webhooks da Nuvemshop
- `/health`: Status do sistema e última sincronização

## Sincronização

O sistema sincroniza automaticamente:
- Novos pedidos da Nuvemshop a cada 30 minutos
- Status dos rastreios no 17track a cada 60 minutos

## Logs

Os logs são salvos em:
- `logs/tracking.log`: Logs gerais
- `logs/tracking-error.log`: Logs de erro
