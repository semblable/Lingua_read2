"""Check local authentication's Compose boundary without starting containers."""

import json
import os
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def config(*overlays, local_mode=None, port=None):
    env = dict(os.environ)
    for key in ("LINGUAREAD_LOCAL_MODE", "HTTP_PORT"):
        env.pop(key, None)
    if local_mode is not None:
        env["LINGUAREAD_LOCAL_MODE"] = local_mode
    if port is not None:
        env["HTTP_PORT"] = port
    command = ["docker", "compose", "--env-file", str(ROOT / ".env.example"),
               "-f", str(ROOT / "docker-compose.yml")]
    for overlay in overlays:
        command.extend(("-f", str(ROOT / overlay)))
    command.extend(("config", "--format", "json"))
    result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
    # Do not print the expanded environment/credentials, including on failure.
    if result.returncode:
        raise RuntimeError("Compose configuration failed; check the Compose version and files")
    return json.loads(result.stdout)["services"]


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def main():
    normal = config()
    check(normal["api"]["environment"]["Auth__LocalMode"] == "false",
          "Password authentication must remain the default")
    local = config("docker-compose.override.yml", local_mode="true", port="8087")
    auth = local["api"]["environment"]
    check(auth["Auth__LocalMode"] == auth["Auth__LocalProxy"] == "true",
          "One local-mode switch must configure both Docker authentication flags")
    web_ports = local["nginx"]["ports"]
    check(len(web_ports) == 1 and web_ports[0].get("host_ip") == "127.0.0.1"
          and web_ports[0]["published"] == "8087", "Local web port must stay loopback-only")
    check(all(port.get("host_ip") == "127.0.0.1" for port in local["api"]["ports"]),
          "Development API ports must stay loopback-only")
    production = config("docker-compose.prod.yml", local_mode="true", port="8087")
    auth = production["api"]["environment"]
    check(auth["Auth__LocalMode"] == auth["Auth__LocalProxy"] == "false",
          "Production must disable local authentication even when .env enables it")
    web_ports = production["nginx"]["ports"]
    check(len(web_ports) == 2 and {port["published"] for port in web_ports} == {"80", "443"}
          and all(port.get("host_ip") in (None, "", "0.0.0.0", "::") for port in web_ports),
          "Production must replace the local binding with its intended server ports")
    check(not production["api"].get("ports"), "Production must not publish the API directly")
    print("Local-mode Compose boundary checks passed (no containers started).")


if __name__ == "__main__":
    main()
