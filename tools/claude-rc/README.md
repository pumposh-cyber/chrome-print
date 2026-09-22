# claude-rc: keep Claude Code Remote Control reachable

`rc_supervisor.py` keeps a [Remote Control](https://code.claude.com/docs/en/remote-control) server
running on your machine. Your phone or claude.ai/code can reach it again soon after the machine
wakes up, gets its network back, or reboots.

## Why

- A short sleep or network drop is fine. `claude remote-control` reconnects by itself.
- If the machine stays offline for about **10 minutes**, the server **exits**. A reboot stops it too.
- Running `claude remote-control` again in the same directory within about **4 hours** brings back
  the sessions it was serving.

The supervisor covers the gap. It waits until `api.anthropic.com` is reachable, starts
`claude remote-control`, and starts it again whenever it exits. If it keeps failing to start, it
waits longer between tries, up to 5 minutes.

## Setup (macOS or Linux, needs `python3`, `tmux`, `claude`)

```bash
# 1. One time, by hand: accept the "Enable Remote Control?" prompt and workspace trust
cd ~/code/myproject && claude remote-control     # answer y, then Ctrl+C

# 2. Install the login service
python3 tools/claude-rc/rc_supervisor.py install --project ~/code/myproject --name "My laptop"

# optional extra flags for claude go after `--`
python3 tools/claude-rc/rc_supervisor.py install --project ~/code/myproject -- --spawn worktree
```

- **Linux:** installs a `systemd --user` unit named `claude-rc`. To also start at boot before
  you log in, run `sudo loginctl enable-linger $USER`.
- **macOS:** installs the LaunchAgent `~/Library/LaunchAgents/com.user.claude-rc.plist`, which
  starts at login.

The server runs inside a detached tmux session so it has a real terminal:

```bash
tmux attach -t claude-rc     # see the session URL; press space for the QR code
                             # detach with Ctrl+b then d (Ctrl+C stops it)
```

Run it in the foreground without installing anything: `python3 rc_supervisor.py run --project .`

Remove it: `python3 tools/claude-rc/rc_supervisor.py uninstall`

## Interactive sessions instead

If you'd rather use normal `claude` terminal sessions, turn on **Enable Remote Control for all
sessions** in `/config`, or set `"remoteControlAtStartup": true` in `~/.claude/settings.json`.
Interactive sessions keep retrying through an outage and reconnect by themselves. They still have
to be running, though, so they don't survive a reboot. The supervisor does.
