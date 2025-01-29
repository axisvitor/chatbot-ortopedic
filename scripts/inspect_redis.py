import redis
from collections import defaultdict

def inspect_redis():
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

        # Lista todas as chaves
        keys = r.keys('*')
        print(f'\n📝 Chaves encontradas: {len(keys)}')

        # Agrupa as chaves por prefixo
        prefixes = defaultdict(list)
        for key in keys:
            prefix = key.split(':')[0]
            prefixes[prefix].append(key)

        # Mostra detalhes de cada grupo
        for prefix, prefix_keys in prefixes.items():
            print(f'\n🔑 Prefixo "{prefix}": {len(prefix_keys)} chaves')
            
            # Mostra algumas chaves de exemplo
            examples = prefix_keys[:5]
            for key in examples:
                key_type = r.type(key)
                ttl = r.ttl(key)
                
                print(f'\n  Chave: {key}')
                print(f'  Tipo: {key_type}')
                print(f'  TTL: {ttl if ttl != -1 else "sem expiração"} segundos')

                # Mostra o conteúdo baseado no tipo
                try:
                    if key_type == 'string':
                        value = r.get(key)
                        print(f'  Valor: {value[:100]}{"..." if len(value) > 100 else ""}')
                    elif key_type == 'hash':
                        hash_data = r.hgetall(key)
                        print(f'  Campos: {", ".join(hash_data.keys())}')
                    elif key_type == 'set':
                        members = r.smembers(key)
                        print(f'  Membros: {len(members)}')
                    elif key_type == 'list':
                        length = r.llen(key)
                        print(f'  Tamanho: {length}')
                except Exception as e:
                    print(f'  Erro ao ler valor: {str(e)}')
            
            if len(prefix_keys) > 5:
                print(f'  ... e mais {len(prefix_keys) - 5} chaves')

    except Exception as e:
        print(f'❌ Erro: {str(e)}')
    finally:
        r.close()
        print('\n👋 Conexão encerrada')

if __name__ == '__main__':
    inspect_redis()
