"""Contrato local del dataset sintético de demanda de Lúmina."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Final

DATASET_ID: Final = "demo-femenino-seed42-v1"
SOURCE: Final = "DEMOSTRACION_SINTETICA"
SCHEMA_VERSION: Final = "1.0"
GENERATOR_VERSION: Final = "1.0.0"
DEFAULT_SEED: Final = 42
DATE_FROM: Final = date(2025, 10, 1)
DATE_TO: Final = date(2026, 9, 30)

CHANNELS: Final = ("WEB", "APP", "TIENDA")


@dataclass(frozen=True)
class Product:
    product_id: str
    name: str
    category: str
    base_price_cents: int
    colors: tuple[str, str, str]


@dataclass(frozen=True)
class Variant:
    variant_id: str
    product_id: str
    sku: str
    size: str
    color: str
    unit_price_cents: int
    variant_index: int


@dataclass(frozen=True)
class Location:
    location_id: str
    name: str
    kind: str


PRODUCTS: Final = (
    Product("demo-producto-01", "Vestido Aurora", "VESTIDO", 21_900, ("AZUL", "MARFIL", "NEGRO")),
    Product("demo-producto-02", "Vestido Celeste", "VESTIDO", 24_900, ("CELESTE", "BLANCO", "AZUL")),
    Product("demo-producto-03", "Vestido Dalia", "VESTIDO", 27_900, ("ROJO", "VINO", "ROSA")),
    Product("demo-producto-04", "Vestido Esmeralda", "VESTIDO", 29_900, ("VERDE", "NEGRO", "MARFIL")),
    Product("demo-producto-05", "Vestido Luna", "VESTIDO", 31_900, ("NEGRO", "PLATA", "AZUL")),
    Product("demo-producto-06", "Vestido Sol", "VESTIDO", 26_900, ("AMARILLO", "NARANJA", "MARFIL")),
    Product("demo-producto-07", "Falda Alba", "FALDA", 16_900, ("MARFIL", "BEIGE", "NEGRO")),
    Product("demo-producto-08", "Falda Brisa", "FALDA", 18_900, ("CELESTE", "AZUL", "BLANCO")),
    Product("demo-producto-09", "Falda Coral", "FALDA", 19_900, ("CORAL", "ROSA", "VINO")),
    Product("demo-producto-10", "Falda Noche", "FALDA", 22_900, ("NEGRO", "GRIS", "AZUL")),
    Product("demo-producto-11", "Falda Oliva", "FALDA", 20_900, ("OLIVA", "VERDE", "BEIGE")),
    Product("demo-producto-12", "Falda Primavera", "FALDA", 17_900, ("LILA", "ROSA", "BLANCO")),
)

LOCATIONS: Final = (
    Location("demo-ubicacion-01", "Sucursal Centro Demo", "SUCURSAL"),
    Location("demo-ubicacion-02", "Sucursal Norte Demo", "SUCURSAL"),
    Location("demo-ubicacion-03", "Sucursal Sur Demo", "SUCURSAL"),
    Location("demo-ubicacion-04", "Sucursal Este Demo", "SUCURSAL"),
    Location("demo-ubicacion-05", "Almacén Principal Demo", "ALMACEN"),
)

SIZES: Final = ("S", "M", "L")


def build_variants() -> tuple[Variant, ...]:
    variants: list[Variant] = []
    variant_index = 0
    for product in PRODUCTS:
        for offset, (size, color) in enumerate(zip(SIZES, product.colors, strict=True)):
            variant_index += 1
            variants.append(
                Variant(
                    variant_id=f"demo-variante-{variant_index:03d}",
                    product_id=product.product_id,
                    sku=f"DEMO-{product.product_id[-2:]}-{size}",
                    size=size,
                    color=color,
                    unit_price_cents=product.base_price_cents + offset * 500,
                    variant_index=variant_index - 1,
                )
            )
    return tuple(variants)


VARIANTS: Final = build_variants()

PANEL_COLUMNS: Final = (
    "dataset_id",
    "source",
    "seed",
    "date",
    "product_id",
    "variant_id",
    "sku",
    "product_name",
    "category",
    "size",
    "color",
    "location_id",
    "channel",
    "units",
    "unit_price_cents",
    "revenue_cents",
)

ANOMALY_LABEL_COLUMNS: Final = (
    "row_key",
    "date",
    "variant_id",
    "location_id",
    "channel",
    "injection_type",
    "original_units",
    "anomalous_units",
    "magnitude_units",
)


@dataclass(frozen=True)
class DatasetConfig:
    seed: int = DEFAULT_SEED
    date_from: date = DATE_FROM
    date_to: date = DATE_TO
    products: tuple[Product, ...] = PRODUCTS
    variants: tuple[Variant, ...] = VARIANTS
    locations: tuple[Location, ...] = LOCATIONS
    channels: tuple[str, ...] = CHANNELS

    @property
    def days(self) -> int:
        return (self.date_to - self.date_from).days + 1

    @property
    def expected_rows(self) -> int:
        return self.days * len(self.variants) * len(self.locations) * len(self.channels)

    def validate(self) -> None:
        if self.date_from > self.date_to:
            raise ValueError("date_from debe ser anterior o igual a date_to")
        if not self.products or not self.variants or not self.locations or not self.channels:
            raise ValueError("El dataset requiere productos, variantes, ubicaciones y canales")
        product_ids = {product.product_id for product in self.products}
        if len(product_ids) != len(self.products):
            raise ValueError("Los product_id deben ser únicos")
        if any(variant.product_id not in product_ids for variant in self.variants):
            raise ValueError("Cada variante debe pertenecer a un producto")
        if len({variant.variant_id for variant in self.variants}) != len(self.variants):
            raise ValueError("Los variant_id deben ser únicos")
        if len({location.location_id for location in self.locations}) != len(self.locations):
            raise ValueError("Los location_id deben ser únicos")
        if len(set(self.channels)) != len(self.channels):
            raise ValueError("Los canales deben ser únicos")


def temporal_split(day: date) -> str:
    if DATE_FROM <= day <= date(2026, 6, 12):
        return "TRAIN"
    if date(2026, 6, 13) <= day <= date(2026, 8, 6):
        return "VALIDATION"
    if date(2026, 8, 7) <= day <= DATE_TO:
        return "TEST"
    raise ValueError(f"Fecha fuera de la cobertura del dataset: {day.isoformat()}")
