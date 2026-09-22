#!/usr/bin/env python3
"""Keep a Claude Code Remote Control server alive across sleep, network loss and reboots.

`claude remote-control` reconnects by itself after short network drops, but it exits if the
machine stays offline for roughly 10 minutes, and it obviously dies on reboot. Re-running it in
the same directory within ~4 hours brings back the sessions it was serving.

This script is the missing loop:

    wait for network  ->  run `claude remote-control`  ->  it exits  ->  back off  ->  repeat

Usage:
    rc_supervisor.py run     --project ~/code/myproj [--name "My laptop"] [-- extra claude flags]
    rc_supervisor.py install --project ~/code/myproj [--name "My laptop"] [-- extra claude flags]
    rc_supervisor.py uninstall

`install` registers a login service (systemd --user on Linux, launchd on macOS) that starts
`run` inside a detached tmux session named `claude-rc`, so the server has a real terminal.
Attach with `tmux attach -t claude-rc` to see the session URL / QR code (press spacebar).

Standard library only.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import platform
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

PROBE_HOST = "api.anthropic.com"
PROBE_PORT = 443
TMUX_SESSION = "claude-rc"
SERVICE_NAME = "claude-rc"
LAUNCHD_LABEL = "com.user.claude-rc"

# A run shorter than this counts as a failed start (not logged in, bad flag, ...) and backs off.
HEALTHY_RUN_SECONDS = 60
MAX_BACKOFF_SECONDS = 300


def log(msg: str) -> None:
    print(f"[claude-rc {dt.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


# --------------------------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------------------------


def network_up(timeout: float = 5.0) -> bool:
    """True when we can resolve and open a TCP connection to the Anthropic API."""
    try:
        with socket.create_connection((PROBE_HOST, PROBE_PORT), timeout=timeout):
            return True
    except OSError:
        return False


def wait_for_network() -> None:
    delay = 2
    announced = False
    while not network_up():
        if not announced:
            log(f"offline: waiting for {PROBE_HOST}:{PROBE_PORT} ...")
            announced = True
        time.sleep(delay)
        delay = min(delay * 2, 30)
    if announced:
        log("network is back")


def run(args: argparse.Namespace) -> int:
    claude = shutil.which("claude")
    if not claude:
        log("`claude` not found on PATH. Install Claude Code or fix PATH in the service.")
        return 1

    project = Path(args.project).expanduser().resolve()
    cmd = [claude, "remote-control"]
    if args.name:
        cmd += ["--name", args.name]
    cmd += args.extra

    backoff = 5
    while True:
        wait_for_network()
        log(f"starting in {project}: {shlex.join(cmd)}")
        started = time.monotonic()
        proc = subprocess.Popen(cmd, cwd=project)
        try:
            code = proc.wait()
        except KeyboardInterrupt:
            # Ctrl+C in the tmux pane: the signal hit claude too. Let it finish, then stop.
            log("interrupted, stopping supervisor")
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
            return 0

        ran_for = time.monotonic() - started
        if ran_for >= HEALTHY_RUN_SECONDS:
            backoff = 5
        log(f"claude exited with code {code} after {ran_for:.0f}s; restarting in {backoff}s")
        time.sleep(backoff)
        backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)


# --------------------------------------------------------------------------------------------
# install / uninstall
# --------------------------------------------------------------------------------------------


def run_command_line(args: argparse.Namespace) -> list[str]:
    """The `rc_supervisor.py run ...` command the service should execute."""
    line = [sys.executable, str(Path(__file__).resolve()), "run", "--project",
            str(Path(args.project).expanduser().resolve())]
    if args.name:
        line += ["--name", args.name]
    if args.extra:
        line += ["--", *args.extra]
    return line


def tmux_start_command(inner: list[str]) -> str:
    """Shell snippet that launches `inner` in a detached tmux session unless it already runs.

    `remain-on-exit` keeps the pane (and its log) around if the supervisor itself dies.
    """
    tmux = shutil.which("tmux") or "tmux"
    return (
        f"{tmux} has-session -t {TMUX_SESSION} 2>/dev/null || "
        f"{{ {tmux} new-session -d -s {TMUX_SESSION} -x 200 -y 50 {shlex.quote(shlex.join(inner))} && "
        f"{tmux} set-option -t {TMUX_SESSION} remain-on-exit on; }}"
    )


def service_path() -> str:
    # Services start with a minimal PATH; carry over the dirs where claude and tmux live.
    dirs = []
    for tool in ("claude", "tmux", "node"):
        found = shutil.which(tool)
        if found:
            dirs.append(str(Path(found).parent))
    dirs += ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    return ":".join(dict.fromkeys(dirs))


def install(args: argparse.Namespace) -> int:
    if not Path(args.project).expanduser().is_dir():
        log(f"project directory not found: {args.project}")
        return 1
    missing = [t for t in ("claude", "tmux") if not shutil.which(t)]
    if missing:
        log(f"missing on PATH: {', '.join(missing)}")
        return 1

    start = tmux_start_command(run_command_line(args))
    system = platform.system()
    if system == "Linux":
        install_systemd(start)
    elif system == "Darwin":
        install_launchd(start)
    else:
        log(f"unsupported OS: {system}")
        return 1

    print(
        "\nBefore relying on it, run `claude remote-control` once by hand in the project directory"
        "\nto accept the one-time 'Enable Remote Control?' prompt and workspace trust."
        f"\nSee the live server with:  tmux attach -t {TMUX_SESSION}   (detach: Ctrl+b then d)"
    )
    return 0


def install_systemd(start: str) -> None:
    unit_dir = Path.home() / ".config/systemd/user"
    unit_dir.mkdir(parents=True, exist_ok=True)
    unit = unit_dir / f"{SERVICE_NAME}.service"
    tmux = shutil.which("tmux") or "tmux"
    unit.write_text(
        f"""[Unit]
Description=Claude Code Remote Control (auto-reconnect)
Wants=network-online.target
After=network-online.target

[Service]
Type=forking
Environment=PATH={service_path()}
ExecStart=/bin/sh -c {shlex.quote(start)}
ExecStop={tmux} kill-session -t {TMUX_SESSION}
RemainAfterExit=yes

[Install]
WantedBy=default.target
"""
    )
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", f"{SERVICE_NAME}.service"], check=True)
    log(f"installed {unit}")
    print(
        "\nTo also start at boot before you log in, run once:"
        f"\n    sudo loginctl enable-linger {os.environ.get('USER', '$USER')}"
    )


def launchd_plist(start: str) -> str:
    def esc(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    log_file = Path.home() / "Library/Logs/claude-rc.log"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/sh</string><string>-c</string><string>{esc(start)}</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>{esc(service_path())}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>{log_file}</string>
  <key>StandardErrorPath</key><string>{log_file}</string>
</dict>
</plist>
"""


def install_launchd(start: str) -> None:
    plist = Path.home() / f"Library/LaunchAgents/{LAUNCHD_LABEL}.plist"
    plist.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["launchctl", "unload", str(plist)], stderr=subprocess.DEVNULL)
    plist.write_text(launchd_plist(start))
    subprocess.run(["launchctl", "load", "-w", str(plist)], check=True)
    log(f"installed {plist}")


def uninstall(_: argparse.Namespace) -> int:
    system = platform.system()
    if system == "Linux":
        subprocess.run(["systemctl", "--user", "disable", "--now", f"{SERVICE_NAME}.service"])
        (Path.home() / f".config/systemd/user/{SERVICE_NAME}.service").unlink(missing_ok=True)
        subprocess.run(["systemctl", "--user", "daemon-reload"])
    elif system == "Darwin":
        plist = Path.home() / f"Library/LaunchAgents/{LAUNCHD_LABEL}.plist"
        subprocess.run(["launchctl", "unload", "-w", str(plist)], stderr=subprocess.DEVNULL)
        plist.unlink(missing_ok=True)
    tmux = shutil.which("tmux")
    if tmux:
        subprocess.run([tmux, "kill-session", "-t", TMUX_SESSION], stderr=subprocess.DEVNULL)
    log("uninstalled")
    return 0


# --------------------------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    extra: list[str] = []
    if "--" in argv:
        i = argv.index("--")
        argv, extra = argv[:i], argv[i + 1:]

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, fn in (("run", run), ("install", install)):
        p = sub.add_parser(name)
        p.add_argument("--project", required=True, help="directory to run Claude Code in")
        p.add_argument("--name", help="session title shown at claude.ai/code")
        p.set_defaults(fn=fn)
    sub.add_parser("uninstall").set_defaults(fn=uninstall)

    args = parser.parse_args(argv)
    args.extra = extra
    if args.command == "run":
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
