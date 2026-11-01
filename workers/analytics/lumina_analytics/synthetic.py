"""Generador reproducible del panel sintético femenino de Lúmina."""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.metadata
import math
import platform
import sys
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping

from .dataset_schema import (
    ANOMALY_LABEL_COLUMNS,
    DATASET_ID,
    GENERATOR_VERSION,
    PANEL_COLUMNS,
    SCHEMA_VERSION,
    SOURCE,
    DatasetConfig,
    Product,
    Variant,
    temporal_split,
)
from .manifests import manifest_sha256, sha256_file, write_json

LOCATION_FACTORS = (1.00, 0.86, 0.73, 0.64, 0.35)
CHANNEL_FACTORS = {"WEB": 0.82, "APP": 1.05, "TIENDA": 1.28}
WEEKDAY_FACTORS = (0.72, 0.78, 0.86, 0.96, 1.18, 1.42, 1.25)


def _dependency_versions() -> dict[str, str]:
    versions = {"python": platform.python_version()}
    for distribution in ("numpy", "pandas", "scikit-learn", "joblib"):
        try:
            versions[distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            versions[distribution] = "NOT_INSTALLED"
    return versions


def _stable_uniform(*parts: object) -> float:
    payload = "|".join(str(part) for part in parts).encode("utf-8")
    integer = int.from_bytes(hashlib.sha256(payload).digest()[:8], "big")
    return integer / ((1 << 64) - 1)


def _date_range(start: date, end: date) -> Iterator[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _product_lookup(config: DatasetConfig) -> dict[str, Product]:
    return {product.product_id: product for product in config.products}


def _expected_units(
    *, day: date, day_index: int, variant: Variant, location_index: int, channel: str, seed: int
) -> int:
    product_index = int(variant.product_id[-2:]) - 1
    base = 0.62 + product_index * 0.075 + (variant.variant_index % 3) * 0.08
    weekly = WEEKDAY_FACTORS[day.weekday()]
    location = LOCATION_FACTORS[location_index % len(LOCATION_FACTORS)]
    channel_factor = CHANNEL_FACTORS.get(channel, 0.75)
    annual = 1.0 + 0.16 * math.sin(2 * math.pi * (day_index - 40) / 365)
    trend = 1.0 + 0.0007 * day_index
    event = 1.0
    if day.month == 12 and day.day >= 10:
        event *= 1.34
    if day.month == 5 and 20 <= day.day <= 31:
        event *= 1.18
    uniform = _stable_uniform(seed, day.isoformat(), variant.variant_id, location_index, channel)
    count_noise = 0.52 + uniform * 1.05
    expected = base * weekly * location * channel_factor * annual * trend * event * count_noise
    units = int(math.floor(expected))
    if uniform < 0.19:
        units = 0
    elif uniform > 0.94:
        units += 2
    return max(0, units)


def iter_panel(config: DatasetConfig | None = None) -> Iterator[dict[str, Any]]:
    config = config or DatasetConfig()
    config.validate()
    products = _product_lookup(config)
    for day_index, day in enumerate(_date_range(config.date_from, config.date_to)):
        for variant in config.variants:
            product = products[variant.product_id]
            for location_index, location in enumerate(config.locations):
                for channel in config.channels:
                    units = _expected_units(
                        day=day,
                        day_index=day_index,
                        variant=variant,
                        location_index=location_index,
                        channel=channel,
                        seed=config.seed,
                    )
                    yield {
                        "dataset_id": DATASET_ID,
                        "source": SOURCE,
                        "seed": config.seed,
                        "date": day.isoformat(),
                        "product_id": product.product_id,
                        "variant_id": variant.variant_id,
                        "sku": variant.sku,
                        "product_name": product.name,
                        "category": product.category,
                        "size": variant.size,
                        "color": variant.color,
                        "location_id": location.location_id,
                        "channel": channel,
                        "units": units,
                        "unit_price_cents": variant.unit_price_cents,
                        "revenue_cents": units * variant.unit_price_cents,
                    }


def row_key(row: Mapping[str, Any]) -> str:
    return "|".join(
        str(row[field]) for field in ("date", "variant_id", "location_id", "channel")
    )


def inject_anomaly(row: Mapping[str, Any], seed: int = 42) -> tuple[dict[str, Any], dict[str, Any] | None]:
    copied = deepcopy(dict(row))
    selector = _stable_uniform(seed, "anomaly", row_key(row))
    if selector >= 0.012:
        return copied, None
    original_units = int(row["units"])
    if selector < 0.006:
        anomaly_type = "SPIKE"
        anomalous_units = original_units + 5 + int(_stable_uniform(seed, "spike", row_key(row)) * 8)
    else:
        anomaly_type = "DROP"
        anomalous_units = 0
    copied["units"] = anomalous_units
    copied["revenue_cents"] = anomalous_units * int(row["unit_price_cents"])
    label = {
        "row_key": row_key(row),
        "date": row["date"],
        "variant_id": row["variant_id"],
        "location_id": row["location_id"],
        "channel": row["channel"],
        "injection_type": anomaly_type,
        "original_units": original_units,
        "anomalous_units": anomalous_units,
        "magnitude_units": anomalous_units - original_units,
    }
    return copied, label


def _write_csv(path: Path, columns: tuple[str, ...], rows: Iterable[Mapping[str, Any]]) -> int:
    count = 0
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n", extrasaction="raise")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
            count += 1
    return count


def _catalog(config: DatasetConfig) -> dict[str, Any]:
    return {
        "datasetId": DATASET_ID,
        "source": SOURCE,
        "products": [
            {
                "productId": product.product_id,
                "name": product.name,
                "category": product.category,
                "basePriceCents": product.base_price_cents,
            }
            for product in config.products
        ],
        "variants": [
            {
                "variantId": variant.variant_id,
                "productId": variant.product_id,
                "sku": variant.sku,
                "size": variant.size,
                "color": variant.color,
                "unitPriceCents": variant.unit_price_cents,
            }
            for variant in config.variants
        ],
        "locations": [
            {"locationId": location.location_id, "name": location.name, "kind": location.kind}
            for location in config.locations
        ],
        "channels": list(config.channels),
    }


def generate_bundle(output_dir: Path, config: DatasetConfig | None = None) -> dict[str, Any]:
    config = config or DatasetConfig()
    config.validate()
    output_dir.mkdir(parents=True, exist_ok=True)
    panel_path = output_dir / "panel.csv"
    anomaly_path = output_dir / "anomaly-panel.csv"
    labels_path = output_dir / "anomaly-labels.csv"
    catalog_path = output_dir / "catalog.json"

    rows = list(iter_panel(config))
    panel_count = _write_csv(panel_path, PANEL_COLUMNS, rows)
    anomaly_rows: list[dict[str, Any]] = []
    labels: list[dict[str, Any]] = []
    for row in rows:
        anomaly_row, label = inject_anomaly(row, config.seed)
        anomaly_rows.append(anomaly_row)
        if label is not None:
            labels.append(label)
    anomaly_count = _write_csv(anomaly_path, PANEL_COLUMNS, anomaly_rows)
    label_count = _write_csv(labels_path, ANOMALY_LABEL_COLUMNS, labels)
    write_json(catalog_path, _catalog(config))

    files = {
        panel_path.name: sha256_file(panel_path),
        anomaly_path.name: sha256_file(anomaly_path),
        labels_path.name: sha256_file(labels_path),
        catalog_path.name: sha256_file(catalog_path),
    }
    manifest: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "datasetId": DATASET_ID,
        "source": SOURCE,
        "seed": config.seed,
        "generatorVersion": GENERATOR_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dependencyVersions": _dependency_versions(),
        "dateRange": {"from": config.date_from.isoformat(), "to": config.date_to.isoformat()},
        "dimensions": {
            "days": config.days,
            "products": len(config.products),
            "variants": len(config.variants),
            "locations": len(config.locations),
            "channels": list(config.channels),
        },
        "schema": list(PANEL_COLUMNS),
        "rowCount": panel_count,
        "anomalyCopyRowCount": anomaly_count,
        "anomalyLabelCount": label_count,
        "filesSha256": files,
        "splits": {
            "train": {"from": "2025-10-01", "to": "2026-06-12", "days": 255},
            "validation": {"from": "2026-06-13", "to": "2026-08-06", "days": 55},
            "test": {"from": "2026-08-07", "to": "2026-09-30", "days": 55},
            "warmupDays": 28,
        },
        "generationRules": [
            "Panel cartesiano completo; una fila por fecha, variante, ubicación y canal.",
            "Demanda entera no negativa con ceros, patrón semanal, estacionalidad, tendencia y eventos sintéticos.",
            "La copia de anomalías se crea después del panel base; etiquetas y magnitudes quedan en archivo separado.",
            "Los datos son demostración sintética y no se insertan en pedidos, pagos, stock o movimientos reales.",
        ],
        "limitations": [
            "Los patrones fueron diseñados; no representan comportamiento comercial observado.",
            "Este panel de demanda no acredita vendedores, pedidos distintos, pagos ni devoluciones.",
        ],
    }
    manifest["manifestSha256"] = manifest_sha256(manifest)
    write_json(output_dir / "manifest.json", manifest)
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Genera el dataset sintético reproducible de Lúmina")
    parser.add_argument("--output", type=Path, required=True, help="Directorio privado de salida")
    args = parser.parse_args(argv)
    manifest = generate_bundle(args.output)
    print(
        f"{manifest['datasetId']} rows={manifest['rowCount']} "
        f"sha256={manifest['filesSha256']['panel.csv']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
