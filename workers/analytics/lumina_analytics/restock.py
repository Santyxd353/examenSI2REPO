"""Reglas explicables para sugerencias de reposición; nunca escriben inventario."""

from __future__ import annotations

import math
from typing import Any, Mapping


def _non_negative(value: float | int, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} debe ser un número")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{field} debe ser finito y no negativo")
    return number


def suggested_quantity(
    *,
    demand_during_lead: float,
    safety_stock: int,
    available: int,
    confirmed_inbound_not_in_available: int,
) -> int:
    """Devuelve ``max(0, ceil(demanda + seguridad - disponible - entrante))``.

    ``available`` ya debe descontar reservas/compromisos: la regla no vuelve a
    restarlos. El valor devuelto es una propuesta y no modifica existencias.
    """

    demand = _non_negative(demand_during_lead, "demand_during_lead")
    safety = _non_negative(safety_stock, "safety_stock")
    on_hand = _non_negative(available, "available")
    inbound = _non_negative(confirmed_inbound_not_in_available, "confirmed_inbound_not_in_available")
    return max(0, math.ceil(demand + safety - on_hand - inbound))


def restock_suggestion(item: Mapping[str, Any]) -> dict[str, Any]:
    """Construye una propuesta serializable desde un snapshot autorizado.

    Si falta ``demandDuringLead`` no se inventa un pronóstico: usa la regla
    declarada ``averageDailyDemand * leadTimeDays`` y expone su limitación.
    """

    lead_days = _non_negative(item.get("leadTimeDays", 0), "leadTimeDays")
    limitations: list[str] = []
    if item.get("demandDuringLead") is None:
        demand = _non_negative(item.get("averageDailyDemand", 0), "averageDailyDemand") * lead_days
        demand_source = "REGLA_BASICA"
        limitations.append("MODEL_DATA_INSUFFICIENT: se aplicó demanda diaria declarada, no predicción ML.")
    else:
        demand = _non_negative(item["demandDuringLead"], "demandDuringLead")
        demand_source = str(item.get("demandSource", "FORECAST"))

    safety = _non_negative(item.get("safetyStock", 0), "safetyStock")
    available = _non_negative(item.get("available", 0), "available")
    inbound = _non_negative(item.get("confirmedInboundNotInAvailable", 0), "confirmedInboundNotInAvailable")
    return {
        "variantId": item.get("variantId"),
        "locationId": item.get("locationId"),
        "suggestedQuantity": suggested_quantity(
            demand_during_lead=demand,
            safety_stock=int(safety),
            available=int(available),
            confirmed_inbound_not_in_available=int(inbound),
        ),
        "inputs": {
            "demandDuringLead": demand,
            "demandSource": demand_source,
            "leadTimeDays": lead_days,
            "safetyStock": safety,
            "available": available,
            "confirmedInboundNotInAvailable": inbound,
        },
        "limitations": limitations,
        "effect": "SUGGESTION_ONLY",
    }
