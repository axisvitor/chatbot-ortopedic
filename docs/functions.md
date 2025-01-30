# Funções do Assistant 🤖

## Visão Geral

O assistant possui um conjunto de funções especializadas que podem ser chamadas para executar tarefas específicas. Cada função é cuidadosamente projetada para lidar com um aspecto particular do atendimento.

## 🔍 Funções Disponíveis

### 1. check_order

Verifica informações de pedidos na Nuvemshop.

```javascript
{
    name: "check_order",
    parameters: {
        type: "object",
        required: ["order_number"],
        properties: {
            order_number: {
                type: "string",
                description: "Número do pedido (ex: #123456)"
            }
        }
    }
}
```

### 2. check_tracking

Consulta status de entrega nas transportadoras.

```javascript
{
    name: "check_tracking",
    parameters: {
        type: "object",
        required: ["tracking_code"],
        properties: {
            tracking_code: {
                type: "string",
                description: "Código de rastreio (ex: NM123456789BR)"
            }
        }
    }
}
```

### 3. extract_order_number

Identifica números de pedido em textos.

```javascript
{
    name: "extract_order_number",
    parameters: {
        type: "object",
        required: ["text"],
        properties: {
            text: {
                type: "string",
                description: "Texto para extrair número do pedido"
            }
        }
    }
}
```

### 4. forward_to_financial

Encaminha casos para o setor financeiro.

```javascript
{
    name: "forward_to_financial",
    parameters: {
        type: "object",
        required: ["message", "priority", "userContact"],
        properties: {
            message: {
                type: "string",
                description: "Mensagem original do cliente"
            },
            userContact: {
                type: "string",
                description: "Contato do cliente (WhatsApp)"
            },
            priority: {
                type: "string",
                enum: ["low", "normal", "high", "urgent"],
                description: "Nível de urgência"
            },
            reason: {
                type: "string",
                enum: [
                    "payment_proof",
                    "refund",
                    "payment_issue",
                    "invoice",
                    "general"
                ],
                description: "Motivo do encaminhamento"
            },
            orderNumber: {
                type: "string",
                description: "Número do pedido (se disponível)"
            },
            trackingCode: {
                type: "string",
                description: "Código de rastreio (se disponível)"
            }
        }
    }
}
```

### 5. forward_to_department

Encaminha casos para outros departamentos.

```javascript
{
    name: "forward_to_department",
    parameters: {
        type: "object",
        required: ["message", "department", "userContact"],
        properties: {
            message: {
                type: "string",
                description: "Mensagem original do cliente"
            },
            department: {
                type: "string",
                enum: ["support", "sales", "technical", "shipping", "quality"],
                description: "Departamento para encaminhamento"
            },
            userContact: {
                type: "string",
                description: "Contato do cliente (WhatsApp)"
            },
            priority: {
                type: "string",
                enum: ["low", "normal", "high", "urgent"],
                default: "normal",
                description: "Nível de urgência do caso"
            },
            reason: {
                type: "string",
                description: "Motivo do encaminhamento"
            },
            orderNumber: {
                type: "string",
                description: "Número do pedido (se disponível)"
            },
            trackingCode: {
                type: "string",
                description: "Código de rastreio (se disponível)"
            }
        }
    }
}
```

### 6. request_payment_proof

Gerencia fluxo de comprovantes de pagamento.

```javascript
{
    name: "request_payment_proof",
    parameters: {
        type: "object",
        required: ["action", "order_number"],
        properties: {
            action: {
                type: "string",
                enum: ["request", "validate", "process", "cancel"],
                description: "Ação a ser executada"
            },
            order_number: {
                type: "string",
                description: "Número do pedido"
            },
            status: {
                type: "string",
                enum: ["pending", "processing", "approved", "rejected"],
                description: "Status do comprovante"
            },
            image_url: {
                type: "string",
                description: "URL da imagem do comprovante"
            }
        }
    }
}
```

## 🔄 Fluxo de Execução

1. Assistant recebe mensagem do usuário
2. Identifica a intenção
3. Chama a função apropriada
4. Processa o resultado
5. Gera resposta contextualizada

## 📊 Métricas de Uso

- Taxa de sucesso por função
- Tempo médio de execução
- Distribuição de uso
- Erros mais comuns

## 🔐 Segurança

- Validação de entrada
- Sanitização de dados
- Rate limiting
- Logs de auditoria

## 🎯 Boas Práticas

1. **Validação**
   - Sempre validar entrada
   - Tratar casos de erro
   - Fornecer feedback claro

2. **Contexto**
   - Manter histórico relevante
   - Usar informações anteriores
   - Personalizar respostas

3. **Performance**
   - Otimizar chamadas
   - Usar cache quando possível
   - Monitorar tempos de resposta
