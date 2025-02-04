import requests
import os
from dotenv import load_dotenv
import json
from datetime import datetime

# Carrega variáveis de ambiente
load_dotenv()

# Configurações
NUVEMSHOP_API_URL = 'https://api.nuvemshop.com.br/v1/5072949'
NUVEMSHOP_ACCESS_TOKEN = '9e36b13652240fbdf92047e4c825484030fceb18'
NUVEMSHOP_USER_ID = '5072949'

def buscar_pedido(numero_pedido):
    """
    Busca um pedido específico pelo número
    """
    try:
        print(f"\n🔍 Buscando pedido #{numero_pedido}...")
        
        # Headers da requisição
        headers = {
            'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)',
            'Content-Type': 'application/json',
            'Authentication': NUVEMSHOP_ACCESS_TOKEN
        }
        
        # Parâmetros da busca
        params = {
            'q': str(numero_pedido),
            'fields': 'id,number,status,total,created_at,customer,shipping_tracking_number,shipping_status,payment_status',
            'per_page': 1
        }
        
        # Faz a requisição
        url = f'{NUVEMSHOP_API_URL}/orders'
        print(f"📡 URL: {url}")
        
        response = requests.get(url, headers=headers, params=params)
        
        print(f"\n📊 Status Code: {response.status_code}")
        print(f"🔤 Content-Type: {response.headers.get('content-type')}")
        
        if response.status_code == 200:
            orders = response.json()
            
            # Procura o pedido específico
            for order in orders:
                if str(order.get('number')) == str(numero_pedido):
                    print("\n📦 Detalhes do Pedido:")
                    print(f"  Número: #{order.get('number')}")
                    print(f"  ID: {order.get('id')}")
                    print(f"  Status: {order.get('status')}")
                    print(f"  Status Pagamento: {order.get('payment_status')}")
                    print(f"  Status Envio: {order.get('shipping_status')}")
                    print(f"  Rastreamento: {order.get('shipping_tracking_number')}")
                    print(f"  Total: {order.get('total')}")
                    if order.get('customer'):
                        print(f"  Cliente: {order.get('customer', {}).get('name')}")
                        print(f"  Email: {order.get('customer', {}).get('email')}")
                        print(f"  Telefone: {order.get('customer', {}).get('phone')}")
                    print(f"  Data Criação: {order.get('created_at')}")
                    
                    print("\n✅ Pedido encontrado!")
                    return True
            
            print("\n❌ Pedido não encontrado")
            return False
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
    print("🚀 Iniciando busca de pedido...")
    print(f"⏰ Data/Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Busca o pedido #3427
    buscar_pedido(3427)
