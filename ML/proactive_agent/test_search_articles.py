# test_search_articles.py
import requests

r = requests.post(
    "http://127.0.0.1:8082/api/v1/search-articles",
    headers={"Authorization": "Bearer dummy"},
    json={"days_back": 7, "max_results": 5}
)
print(r.json())
