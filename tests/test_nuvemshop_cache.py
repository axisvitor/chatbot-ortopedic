import requests
import redis
import json
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

# Carrega variáveis de ambiente
load_dotenv()

# Configurações
NUVEMSHOP_API_URL = 'https://api.nuvemshop.com.br/v1/5072949'
NUVEMSHOP_ACCESS_TOKEN = '9e36b13652240fbdf92047e4c825484030fceb18'
NUVEMSHOP_USER_ID = '5072949'

REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
REDIS_DB = int(os.getenv('REDIS_DB', 0))
REDIS_PASSWORD = os.getenv('REDIS_PASSWORD')

def test_redis_connection():
    """
    Testa a conexão com o Redis
    """
    try:
        print("\n🔌 Testando conexão com Redis...")
        redis_client = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            password=REDIS_PASSWORD,
            decode_responses=True
        )
        
        # Testa operações básicas
        test_key = "test:connection"
        test_value = f"test_{datetime.now().isoformat()}"
        
        print(f"📝 Salvando no Redis: {test_key} = {test_value}")
        redis_client.set(test_key, test_value, ex=60)  # expira em 60 segundos
        
        retrieved_value = redis_client.get(test_key)
        print(f"📖 Valor recuperado: {retrieved_value}")
        
        if retrieved_value == test_value:
            print("✅ Conexão Redis OK!")
            return True
        else:
            print("❌ Erro: valor recuperado não corresponde ao salvo")
            return False
            
    except redis.ConnectionError as e:
        print(f"❌ Erro ao conectar ao Redis: {str(e)}")
        return False
    except Exception as e:
        print(f"❌ Erro inesperado no Redis: {str(e)}")
        return False

def test_nuvemshop_orders():
    """
    Testa a API de pedidos da Nuvemshop
    """
    try:
        print("\n🔍 Testando API de pedidos da Nuvemshop...")
        
        # Headers da requisição
        headers = {
            'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)',
            'Content-Type': 'application/json',
            'Authentication': NUVEMSHOP_ACCESS_TOKEN
        }
        
        # Parâmetros para buscar pedidos recentes
        params = {
            'page': 1,
            'per_page': 5,
            'fields': 'id,number,status,total,created_at,customer',
            'status': 'any',
            'created_at_min': (datetime.now() - timedelta(days=30)).isoformat()
        }
        
        # Faz a requisição
        url = f'{NUVEMSHOP_API_URL}/orders'
        print(f"📡 URL: {url}")
        
        response = requests.get(url, headers=headers, params=params)
        
        print(f"\n📊 Status Code: {response.status_code}")
        print(f"🔤 Content-Type: {response.headers.get('content-type')}")
        
        if response.status_code == 200:
            orders = response.json()
            print("\n📦 Primeiros 5 pedidos:")
            for order in orders:
                print(f"\nPedido #{order.get('number')}:")
                print(f"  ID: {order.get('id')}")
                print(f"  Status: {order.get('status')}")
                print(f"  Total: {order.get('total')}")
                print(f"  Cliente: {order.get('customer', {}).get('name')}")
                print(f"  Data: {order.get('created_at')}")
            
            print("\n✅ API Nuvemshop OK!")
            return True
        else:
            print(f"\n❌ Erro na API: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"\n❌ Erro ao chamar API: {str(e)}")
        return False
    except Exception as e:
        print(f"\n❌ Erro inesperado: {str(e)}")
        return False

if __name__ == '__main__':
    print("🚀 Iniciando testes de integração...")
    print(f"⏰ Data/Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Testa Redis
    redis_ok = test_redis_connection()
    
    # Testa Nuvemshop
    nuvemshop_ok = test_nuvemshop_orders()
    
    # Resultado final
    print("\n📋 Resultado dos testes:")
    print(f"Redis: {'✅' if redis_ok else '❌'}")
    print(f"Nuvemshop: {'✅' if nuvemshop_ok else '❌'}")
    
    if redis_ok and nuvemshop_ok:
        print("\n🎉 Todos os testes passaram!")
        exit(0)
    else:
        print("\n❌ Alguns testes falharam")
        exit(1)
