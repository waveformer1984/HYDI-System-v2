# Phase 10 — Infrastructure Stabilization

## Date

2026-08-16

## Host

* Windows 10 Home (Version 2009)
* WSL2 Ubuntu (Default)
* Docker CLI version 29.7.2

## Root cause

The active Docker context was `desktop-linux`, which uses the named pipe `\?\pipe\dockerDesktopLinuxEngine`. Docker Desktop was not running reliably in this session, so the pipe was not consistently available. The actual Docker daemon was a WSL2 native `dockerd` with containers running on a virtual WSL2 network (`192.168.49.99` and the `172.17.0.0/16`, `172.18.0.0/16`, `172.19.0.0/16` ranges).

Because the WSL2 containers were not bridged to `127.0.0.1`, HYDI services expecting `127.0.0.1:54321` and `127.0.0.1:54322` received `ECONNREFUSED`. The CLI using the `desktop-linux` context also could not reach the WSL2 daemon, so `docker`/`docker compose` commands from the qualification harness failed.

## Architecture

* **Docker daemon**: WSL2 Ubuntu `dockerd` (`/usr/bin/dockerd`)
* **Docker CLI default context**: `desktop-linux` (broken until Docker Desktop is stable)
* **Working CLI context**: `default` (`npipe:////./pipe/docker_engine`) was tried but the pipe was also intermittent.
* **Stable connectivity**: direct `wsl docker` and HTTP/TCP to the WSL2 container IP (`192.168.49.99`).

## Remediation

The user established Windows `netsh interface portproxy` rules (requires elevation) to bridge the expected localhost ports to the WSL2 container host:

```text
Listen on ipv4:             Connect to ipv4:
Address         Port        Address         Port
--------------- ----------  --------------- ----------
127.0.0.1       54321       192.168.49.99   54321
127.0.0.1       54322       192.168.49.99   54322
```

After the portproxy was installed, the WSL2 Supabase/Kong services became reachable from Windows processes (including the OQ harness and `next-app` child processes) on `127.0.0.1:54321` and `127.0.0.1:54322`.

No repository code was changed. No HYDI application logic was modified. Phase 9 security controls remain intact.

## Stability proof

### Manual validation before OQ

* `docker ps` from WSL: 15 containers up and healthy.
* `http://192.168.49.99:54321/auth/v1/health` returned `200`.
* `http://127.0.0.1:54321/auth/v1/health` returned `200` after portproxy.
* `Test-Connection -TargetName 127.0.0.1 -TcpPort 54322` returned `True` after portproxy.
* Node child-process stability probe (`C:\tmp\phase10a\child-process-test.js`) confirmed `docker ps`, Kong 54321, and process stability for 2 minutes.

### Stability during quick OQ

The qualification run executed for 2,187,391 ms (~36 minutes, slightly over the configured 30 minutes due to the initial health-check ramp). During the workload window:

* All health probes for `next-app` returned `200`.
* `heidi-bridge` `/health` returned `200` repeatedly.
* `memory-engine`, `hydi-core`, and `next-app` remained stable.
* `docker ps` did not report daemon disconnection after the portproxy was in place.

## Commands used

```text
wsl -d Ubuntu -u root -e bash -c "which docker; which dockerd; pgrep -a dockerd"
docker context ls
docker context use default
docker -c default ps
wsl -d Ubuntu -e bash -c "hostname -I | awk '{print $1}'"
netsh interface portproxy add v4tov4 listenport=54321 listenaddress=127.0.0.1 connectport=54321 connectaddress=192.168.49.99
netsh interface portproxy add v4tov4 listenport=54322 listenaddress=127.0.0.1 connectport=54322 connectaddress=192.168.49.99
netsh interface portproxy show all
```

## Limitations

* The WSL2 IP (`192.168.49.99`) can change on WSL restart. If it changes, the `netsh` portproxy rules must be updated.
* Docker Desktop is not required for the OQ after portproxy is in place, but the `docker` CLI named pipe to the WSL2 daemon remains unavailable from Windows. `wsl docker` must be used for direct container management.
* The optional `docker-stack` service in the OQ still failed because `docker compose` from the Windows CLI could not reach the WSL2 daemon; the OQ correctly marked it optional and continued.

## Result

The portproxy remediation removed the Phase 10 blocker. Quick OQ completed successfully.
