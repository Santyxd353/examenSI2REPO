from __future__ import annotations

from lumina_analytics.restock import suggested_quantity


def test_suggested_quantity_uses_visible_inventory_terms() -> None:
    assert suggested_quantity(
        demand_during_lead=12,
        safety_stock=3,
        available=7,
        confirmed_inbound_not_in_available=2,
    ) == 6
    assert suggested_quantity(
        demand_during_lead=0,
        safety_stock=0,
        available=7,
        confirmed_inbound_not_in_available=0,
    ) == 0
