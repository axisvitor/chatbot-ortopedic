import redis
import json
from datetime import datetime, timedelta

def fix_ortopedic_encoding():
    # Configuração do Redis
    r = redis.Redis(
        host='redis-10167.c336.samerica-east1-1.gce.redns.redis-cloud.com',
        port=10167,
        password='Wu0xfdLVCsenrmimbnwyW4q6KYWlE9kq',
        decode_responses=False  # Importante: não decodificar automaticamente
    )

    try:
        # Testa a conexão
        r.ping()
        print('✅ Conectado ao Redis')

        # Lista todas as chaves de produtos ortopédicos
        ortopedic_keys = r.keys(b'ortopedic:produto:*')
        print(f'\n🔧 Corrigindo {len(ortopedic_keys)} chaves ortopédicas...')

        # TTL padrão para produtos (7 dias)
        ttl = 7 * 24 * 60 * 60

        for key in ortopedic_keys:
            try:
                # Pega os dados em bytes
                data = r.hgetall(key)
                if data:
                    # Tenta diferentes encodings
                    encodings = ['latin1', 'cp1252', 'iso-8859-1']
                    fixed_data = {}
                    
                    for field, value in data.items():
                        # Tenta cada encoding para o campo e valor
                        for encoding in encodings:
                            try:
                                # Decodifica o campo
                                field_str = field.decode(encoding)
                                # Decodifica o valor
                                value_str = value.decode(encoding)
                                
                                # Se chegou aqui, o encoding funcionou
                                fixed_data[field_str] = value_str
                                break
                            except UnicodeDecodeError:
                                continue

                    # Se conseguiu corrigir todos os campos
                    if len(fixed_data) == len(data):
                        # Deleta a chave antiga
                        r.delete(key)
                        
                        # Salva com os dados corrigidos
                        key_str = key.decode('utf-8')
                        r.hset(key_str, mapping=fixed_data)
                        r.expire(key_str, ttl)
                        
                        print(f'  ✓ Corrigido: {key_str}')
                    else:
                        print(f'  ❌ Não foi possível corrigir todos os campos de {key}')

            except Exception as e:
                print(f'  ❌ Erro ao corrigir {key}: {str(e)}')

        print('\n✅ Correções de encoding concluídas!')

    except Exception as e:
        print(f'❌ Erro: {str(e)}')
    finally:
        r.close()
        print('\n👋 Conexão encerrada')

if __name__ == '__main__':
    fix_ortopedic_encoding()
