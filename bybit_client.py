"""Schlanker REST-Client fuer die Bybit-V5-API (Demo-Trading).

Demo-Trading-Konten (https://api-demo.bybit.com) zeigen echte Marktpreise,
aber alle Trades laufen mit virtuellem Guthaben - perfekt zum Testen einer
Strategie ohne echtes Geld zu riskieren. Den API-Key dafuer erzeugt man im
Bybit-Dashboard ueber den Umschalter "Demo Trading" oben rechts.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.parse
import urllib.request
from typing import Any

RECV_WINDOW = "5000"


class BybitError(RuntimeError):
    pass


class BybitClient:
    def __init__(self, api_key: str, api_secret: str, base_url: str) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = base_url.rstrip("/")

    def _sign(self, payload: str, timestamp: str) -> str:
        raw = timestamp + self.api_key + RECV_WINDOW + payload
        return hmac.new(self.api_secret.encode(), raw.encode(), hashlib.sha256).hexdigest()

    def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
        auth: bool = True,
    ) -> dict[str, Any]:
        params = params or {}
        query = urllib.parse.urlencode(params)
        url = f"{self.base_url}{path}"
        if query:
            url += f"?{query}"

        data = json.dumps(body).encode() if body is not None else None
        headers = {"Content-Type": "application/json"}

        if auth:
            timestamp = str(int(time.time() * 1000))
            payload = query if method == "GET" else (data.decode() if data else "")
            headers.update(
                {
                    "X-BAPI-API-KEY": self.api_key,
                    "X-BAPI-SIGN": self._sign(payload, timestamp),
                    "X-BAPI-SIGN-TYPE": "2",
                    "X-BAPI-TIMESTAMP": timestamp,
                    "X-BAPI-RECV-WINDOW": RECV_WINDOW,
                }
            )

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())

        if result.get("retCode") != 0:
            raise BybitError(f"Bybit-API-Fehler {result.get('retCode')}: {result.get('retMsg')}")
        return result["result"]

    # --- Marktdaten (kein Login noetig) ----------------------------------
    def get_klines(self, category: str, symbol: str, interval: str, limit: int = 100) -> list[list[str]]:
        result = self._request(
            "GET",
            "/v5/market/kline",
            params={"category": category, "symbol": symbol, "interval": interval, "limit": limit},
            auth=False,
        )
        # Bybit liefert neueste Kerze zuerst -> fuer SMA-Berechnung umdrehen.
        return list(reversed(result["list"]))

    # --- Konto / Orders (Auth noetig) ------------------------------------
    def get_wallet_balance(self, account_type: str = "UNIFIED") -> dict[str, Any]:
        return self._request("GET", "/v5/account/wallet-balance", params={"accountType": account_type})

    def place_market_order(
        self,
        category: str,
        symbol: str,
        side: str,
        qty: str,
        market_unit: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "category": category,
            "symbol": symbol,
            "side": side,
            "orderType": "Market",
            "qty": qty,
        }
        if market_unit:
            body["marketUnit"] = market_unit
        return self._request("POST", "/v5/order/create", body=body)

    def get_order(self, category: str, order_id: str) -> dict[str, Any]:
        result = self._request("GET", "/v5/order/realtime", params={"category": category, "orderId": order_id})
        items = result.get("list", [])
        return items[0] if items else {}
