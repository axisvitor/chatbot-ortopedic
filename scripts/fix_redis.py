import redis
import json
from datetime import datetime, timedelta

def fix_redis():
    # Configuração do Redis
    r = redis.Redis(
        host='redis-10167.c336.samerica-east1-1.gce.redns.redis-cloud.com',
        port=10167,
        password='Wu0xfdLVCsenrmimbnwyW4q6KYWlE9kq',
        decode_responses=True
    )

    try:
        # Testa a conexão
        r.ping()
        print('✅ Conectado ao Redis')

        # 1. Padronizar TTLs
        ttls = {
            'tracking': 30 * 24 * 60 * 60,  # 30 dias
            'ortopedic': 7 * 24 * 60 * 60,  # 7 dias
            'openai': 30 * 24 * 60 * 60,    # 30 dias
            'chat': 30 * 24 * 60 * 60,      # 30 dias
            'context': 7 * 24 * 60 * 60,    # 7 dias
            'thread': 30 * 24 * 60 * 60,    # 30 dias
            'processing': 24 * 60 * 60,      # 1 dia
            'ecommerce': 30 * 24 * 60 * 60  # 30 dias
        }

        # 2. Corrigir encoding dos dados ortopédicos
        ortopedic_keys = r.keys('ortopedic:*')
        print(f'\n🔧 Corrigindo {len(ortopedic_keys)} chaves ortopédicas...')
        for key in ortopedic_keys:
            try:
                # Tenta ler o valor atual
                data = r.hgetall(key)
                if data:
                    # Recodifica e salva novamente
                    r.delete(key)
                    r.hset(key, mapping={k: v.encode('latin1').decode('utf8') for k, v in data.items()})
                    r.expire(key, ttls['ortopedic'])
                    print(f'  ✓ Corrigido: {key}')
            except Exception as e:
                print(f'  ❌ Erro ao corrigir {key}: {str(e)}')

        # 3. Limpar chaves antigas de tracking
        tracking_keys = r.keys('tracking:*')
        print(f'\n🧹 Verificando {len(tracking_keys)} chaves de tracking...')
        for key in tracking_keys:
            try:
                # Se a chave não tem TTL, adiciona
                if r.ttl(key) == -1:
                    r.expire(key, ttls['tracking'])
                    print(f'  ✓ TTL adicionado: {key}')
            except Exception as e:
                print(f'  ❌ Erro ao processar {key}: {str(e)}')

        # 4. Padronizar prefixos duplicados
        print('\n🔄 Padronizando prefixos duplicados...')
        # Mover ai_processed:* para ecommerce:ai_processed:*
        ai_processed_keys = r.keys('ai_processed:*')
        for key in ai_processed_keys:
            try:
                value = r.get(key)
                ttl = r.ttl(key)
                if value:
                    new_key = f"ecommerce:{key}"
                    r.set(new_key, value)
                    if ttl > 0:
                        r.expire(new_key, ttl)
                    r.delete(key)
                    print(f'  ✓ Movido: {key} -> {new_key}')
            except Exception as e:
                print(f'  ❌ Erro ao mover {key}: {str(e)}')

        # 5. Remover chave chat:undefined
        print('\n🗑️ Removendo chaves inválidas...')
        if r.exists('chat:undefined'):
            r.delete('chat:undefined')
            print('  ✓ Removido: chat:undefined')

        # 6. Aplicar TTLs padrão em todas as chaves
        print('\n⏰ Aplicando TTLs padrão...')
        for prefix, ttl in ttls.items():
            keys = r.keys(f'{prefix}:*')
            for key in keys:
                try:
                    if r.ttl(key) == -1:
                        r.expire(key, ttl)
                        print(f'  ✓ TTL definido para {key}')
                except Exception as e:
                    print(f'  ❌ Erro ao definir TTL para {key}: {str(e)}')

        print('\n✅ Correções concluídas!')

    except Exception as e:
        print(f'❌ Erro: {str(e)}')
    finally:
        r.close()
        print('\n👋 Conexão encerrada')

if __name__ == '__main__':
    fix_redis()
