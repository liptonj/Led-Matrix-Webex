#!/usr/bin/env python3
import argparse
import asyncio
import logging
import os
from typing import Optional

from supabase import acreate_client
from realtime import RealtimeSubscribeStates


async def _set_realtime_auth(supabase, token: str) -> None:
    """Best-effort set auth on the realtime client across supabase-py versions."""
    if not token:
        return
    rt = getattr(supabase, "realtime", None)
    if rt is None:
        return
    for attr in ("set_auth", "set_auth_token", "setAuth", "setAuthToken"):
        fn = getattr(rt, attr, None)
        if callable(fn):
            try:
                result = fn(token)
                if asyncio.iscoroutine(result):
                    await result
                return
            except Exception:
                continue


def _on_subscribe(status: RealtimeSubscribeStates, err: Optional[Exception]) -> None:
    if status == RealtimeSubscribeStates.SUBSCRIBED:
        print("[realtime] subscribed")
    elif status == RealtimeSubscribeStates.CHANNEL_ERROR:
        print(f"[realtime] channel error: {err}")
    elif status == RealtimeSubscribeStates.TIMED_OUT:
        print("[realtime] subscribe timed out")
    elif status == RealtimeSubscribeStates.CLOSED:
        print("[realtime] channel closed")


async def main() -> None:
    parser = argparse.ArgumentParser(description="Supabase Realtime probe (Python)")
    parser.add_argument("--mode", choices=["broadcast", "postgres"], default="broadcast")
    parser.add_argument("--pairing", default=os.environ.get("PAIRING_CODE", ""))
    parser.add_argument("--schema", default="display")
    parser.add_argument("--table", default="commands")
    parser.add_argument("--filter", default="")
    parser.add_argument("--send", action="store_true", help="Send a test broadcast after subscribe")
    parser.add_argument("--timeout", type=int, default=10, help="Exit after N seconds")
    args = parser.parse_args()

    if os.environ.get("REALTIME_DEBUG", ""):
        logging.basicConfig(level=logging.DEBUG)
        logging.getLogger("realtime").setLevel(logging.DEBUG)
        logging.getLogger("websockets").setLevel(logging.DEBUG)

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()

    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_ANON_KEY must be set in env")

    supabase = await acreate_client(url, key)
    await _set_realtime_auth(supabase, token)
    try:
        rt_url = getattr(supabase.realtime, "url", None)
        if rt_url:
            print(f"[realtime] url={rt_url}")
    except Exception:
        pass

    done = asyncio.Event()

    def on_subscribe(status: RealtimeSubscribeStates, err: Optional[Exception]) -> None:
        _on_subscribe(status, err)
        if status in (
            RealtimeSubscribeStates.SUBSCRIBED,
            RealtimeSubscribeStates.CHANNEL_ERROR,
            RealtimeSubscribeStates.TIMED_OUT,
            RealtimeSubscribeStates.CLOSED,
        ):
            done.set()

    if args.mode == "broadcast":
        if not args.pairing:
            raise SystemExit("PAIRING_CODE env or --pairing is required for broadcast")
        channel_name = f"pairing:{args.pairing}:events"
        channel = supabase.channel(channel_name, {"config": {"private": True}})

        def on_broadcast(payload):
            print("[broadcast]", payload)

        await channel.on_broadcast(event="command_changed", callback=on_broadcast).subscribe(on_subscribe)
        if args.send:
            payload = {
                "event": "command_changed",
                "payload": {
                    "operation": "INSERT",
                    "table": "commands",
                    "schema": "display",
                    "record": {
                        "id": "probe-command",
                        "command": "ping",
                        "status": "pending",
                    },
                },
            }
            try:
                await channel.send_broadcast(event="command_changed", data=payload)
                print("[broadcast] sent test payload")
            except Exception as exc:
                print(f"[broadcast] send failed: {exc}")
    else:
        channel = supabase.channel("db-changes")

        def on_change(payload):
            print("[postgres_changes]", payload)

        await channel.on_postgres_changes(
            "*",
            schema=args.schema,
            table=args.table,
            filter=args.filter or None,
            callback=on_change,
        ).subscribe(_on_subscribe)

    # Wait briefly so we can capture status/events
    try:
        await asyncio.wait_for(done.wait(), timeout=args.timeout)
    except asyncio.TimeoutError:
        print("[realtime] timeout waiting for subscribe result")


if __name__ == "__main__":
    asyncio.run(main())
