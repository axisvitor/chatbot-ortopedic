import requests
import json
import time
from datetime import datetime, timedelta

def test_nuvemshop_api():
    # Configurações
    base_url = "https://api.nuvemshop.com.br/v1"
    store_id = "5072949"
    token = "9e36b13652240fbdf92047e4c825484030fceb18"
    
    # Headers conforme documentação
    headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authentication': f'bearer {token}',
        'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)'
    }
    
    def make_request(url, params=None, attempt=1, max_attempts=4):
        try:
            print(f"\nTentativa {attempt} de {max_attempts}")
            print(f"URL: {url}")
            print("Headers:", json.dumps(headers, indent=2))
            if params:
                print("Params:", json.dumps(params, indent=2))
            
            response = requests.get(
                url,
                headers=headers,
                params=params,
                timeout=30
            )
            
            print(f"\nStatus Code: {response.status_code}")
            print("Response Headers:", json.dumps(dict(response.headers), indent=2))
            
            try:
                print("Response Body:", json.dumps(response.json(), indent=2))
            except:
                print("Response Body (raw):", response.text)
            
            return response
            
        except requests.exceptions.RequestException as e:
            print(f"\nErro na requisição: {str(e)}")
            if attempt < max_attempts:
                wait_time = [1, 3, 5][attempt - 1]
                print(f"Aguardando {wait_time} segundos antes de tentar novamente...")
                time.sleep(wait_time)
                return make_request(url, params, attempt + 1, max_attempts)
            else:
                raise
    
    def test_endpoint(description, endpoint, params=None):
        print(f"\n=== {description} ===")
        return make_request(f"{base_url}/{store_id}/{endpoint}", params)

    # Test 1: Orders endpoint without parameters
    test_endpoint("Teste do endpoint de orders (sem parâmetros)", "orders")

    # Test 2: Orders endpoint with date and status filters
    created_at_min = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    params = {
        'created_at_min': created_at_min,
        'status': ['open', 'paid', 'authorized']
    }
    test_endpoint("Teste do endpoint de orders (com filtros)", "orders", params)

    # Test 3: Products endpoint
    test_endpoint("Teste do endpoint de produtos", "products")

    # Test 4: Categories endpoint
    test_endpoint("Teste do endpoint de categorias", "categories")

    # Test 5: Store information
    test_endpoint("Teste do endpoint de informações da loja", "")

if __name__ == "__main__":
    try:
        test_nuvemshop_api()
    except Exception as e:
        print(f"\nErro fatal: {str(e)}")
