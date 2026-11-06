from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path


def _request(work_dir: str, **changes: object) -> dict[str, object]:
    value: dict[str, object] = {
        "schemaVersion": "1.0",
        "jobId": "job-cli-001",
        "tenantId": "tenant-demo-001",
        "actorId": "actor-demo-001",
        "source": "DEMOSTRACION_SINTETICA",
        "action": "GENERATE_DATASET",
        "datasetId": "demo-femenino-seed42-v1",
        "workDir": work_dir,
        "parameters": {},
        "inventorySnapshot": [],
    }
    value.update(changes)
    return value


def test_cli_returns_one_json_on_success_and_safe_json_on_failure(tmp_path: Path) -> None:
    repo = Path.cwd().parents[1]
    work_dir = ".local/analytics/pytest-cli"
    request_path = tmp_path / "generate.json"
    request_path.write_text(json.dumps(_request(work_dir)), encoding="utf-8")
    try:
        success = subprocess.run([sys.executable, "-m", "lumina_analytics.cli", "--job", str(request_path)], text=True, capture_output=True, check=False)
        assert success.returncode == 0
        assert len(success.stdout.strip().splitlines()) == 1
        result = json.loads(success.stdout)
        assert result["ok"] is True
        assert result["resultPath"] == "results/job-cli-001.json"
        assert (repo / work_dir / result["resultPath"]).is_file()

        request_path.write_text(json.dumps(_request(work_dir, horizonDays=9)), encoding="utf-8")
        failure = subprocess.run([sys.executable, "-m", "lumina_analytics.cli", "--job", str(request_path)], text=True, capture_output=True, check=False)
        assert failure.returncode != 0
        assert len(failure.stdout.strip().splitlines()) == 1
        assert json.loads(failure.stdout)["error"]["code"] == "INVALID_HORIZON"
    finally:
        shutil.rmtree(repo / work_dir, ignore_errors=True)
