"""VEdit MCP server. stdio for private tunnels; HTTP bound to loopback only."""
import asyncio
import os
from typing import Literal

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import BaseModel, ConfigDict, Field

EDITOR_URL = os.environ.get('VEDIT_EDITOR_URL', 'http://127.0.0.1:8765').rstrip('/')
if not EDITOR_URL.startswith(('http://127.0.0.1:', 'http://localhost:')):
    raise RuntimeError('This personal plugin only supports a local editor')
mcp = FastMCP('VEdit', instructions='Edit the paired VEdit timeline. Read project first, use returned IDs, '
              'perform only requested edits, then check command results. Device export stays in the browser. '
              'An open paired VEdit tab is required. No video understanding or transcription is provided.',
              host='127.0.0.1', port=8766)
pairing_key = os.environ.get('VEDIT_PAIRING_KEY', '')
READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)


class Operation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    type: Literal['set_ratio', 'trim', 'set_volume', 'set_speed', 'move', 'reorder',
                  'remove', 'add_media', 'add_text', 'add_sound_effect']
    track: Literal['main', 'overlay', 'audio', 'text'] | None = None
    clip_id: str | None = None
    media_id: str | None = None
    ratio: Literal['16:9', '9:16', '1:1', '4:5', '4:3'] | None = None
    in_: float | None = Field(default=None, alias='in', ge=0)
    out: float | None = Field(default=None, ge=0)
    start: float | None = Field(default=None, ge=0, le=86400)
    duration: float | None = Field(default=None, ge=.1, le=3600)
    volume: float | None = Field(default=None, ge=0, le=2)
    speed: float | None = Field(default=None, ge=.1, le=10)
    index: int | None = Field(default=None, ge=0)
    text: str | None = Field(default=None, max_length=2000)
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    font_size: float | None = Field(default=None, ge=12, le=300)
    color: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    effect_id: Literal['whoosh', 'pop', 'notification', 'success', 'impact', 'click', 'sparkle', 'error'] | None = None


async def request(action, body):
    if not pairing_key:
        raise ValueError('Use connect_editor with the pairing key shown by the VEdit ChatGPT button')
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        r = await client.post(EDITOR_URL+'/api/plugin/'+action, json=body,
                              headers={'Authorization': 'Bearer '+pairing_key})
        data = r.json()
        if r.is_error:
            raise ValueError(data.get('error', 'Editor request failed'))
        return data


async def command(action, arguments=None):
    queued = await request('command', {'action': action, 'arguments': arguments or {}})
    for _ in range(12):
        await asyncio.sleep(.5)
        result = await request('result', {'id': queued['command_id']})
        if result['status'] in ('done', 'error'):
            return result
    return queued


@mcp.tool(annotations=WRITE)
async def connect_editor(key: str) -> dict:
    """Pair with the open VEdit tab using its private pairing key. Never repeat the key in replies."""
    global pairing_key
    old = pairing_key
    pairing_key = key
    try:
        result = await command('get_project')
    except Exception:
        pairing_key = old
        raise
    return result


@mcp.tool(annotations=READ)
async def get_project() -> dict:
    """Read current project, media IDs, timeline clip IDs and available sound effects. No raw video is returned."""
    return await command('get_project')


@mcp.tool(annotations=WRITE)
async def edit_timeline(operations: list[Operation]) -> dict:
    """Apply 1–50 reversible edits atomically. Read get_project first for IDs.

    trim: track/clip_id/in/out (source seconds). set_ratio: ratio.
    set_volume: track/clip_id/volume (0–2). set_speed: track/clip_id/speed.
    move: non-main track/clip_id/start. reorder: main track/clip_id/index (zero-based).
    remove: track/clip_id. add_media: media_id/track/start (main appends).
    add_text: text/start/duration, optional x/y normalized, font_size/color.
    add_sound_effect: effect_id/start/volume. Unknown IDs or invalid ranges reject the batch.
    """
    if not 1 <= len(operations) <= 50:
        raise ValueError('Provide 1–50 operations')
    return await command('edit_timeline', {'operations': [o.model_dump(by_alias=True, exclude_none=True) for o in operations]})


@mcp.tool(annotations=WRITE)
async def undo_edit() -> dict:
    """Undo the most recent editor transaction when requested by the user."""
    return await command('undo')


@mcp.tool(annotations=WRITE)
async def export_video() -> dict:
    """Export MP4 on the device. Keep VEdit open; user downloads from its export dialog.

    Does not upload video to a server. Unsupported codecs/effects return an error.
    A queued response is not completion: poll get_command_result until done/error.
    """
    return await command('export_video')


@mcp.tool(annotations=READ)
async def get_command_result(command_id: str) -> dict:
    """Check pending edit/export status. Only status=done confirms completion."""
    return await request('result', {'id': command_id})


if __name__ == '__main__':
    mcp.run(transport='streamable-http' if '--http' in __import__('sys').argv else 'stdio')
