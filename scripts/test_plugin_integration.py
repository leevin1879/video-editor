"""Manual integration test against a running, paired editor. Restores edits via undo."""
import asyncio
import json
import os
from pathlib import Path
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


def data(result):
    if result.isError:
        raise AssertionError(result.content)
    return json.loads(result.content[0].text)


async def main():
    key = Path(os.environ['VEDIT_TEST_KEY_FILE']).read_text().strip()
    async with streamable_http_client('http://127.0.0.1:8766/mcp') as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            assert len(tools.tools) == 6
            async def call(name, args=None):
                result = data(await session.call_tool(name, args or {}))
                for _ in range(120):
                    if result['status'] not in ('queued', 'running'):
                        break
                    await asyncio.sleep(.5)
                    result = data(await session.call_tool('get_command_result', {'command_id': result['command_id']}))
                return result
            paired = await call('connect_editor', {'key': key})
            assert paired['status'] == 'done'
            original = paired['result']
            operations = [{'type': 'set_ratio', 'ratio': '1:1'},
                          {'type': 'add_text', 'text': 'VEdit MCP test', 'start': 0, 'duration': 1},
                          {'type': 'add_sound_effect', 'effect_id': 'pop', 'start': 0, 'volume': .5}]
            for c in original['tracks']['main']:
                if c['out']-c['in'] > 1:
                    operations.append({'type': 'trim', 'track': 'main', 'clip_id': c['id'], 'in': c['in'], 'out': c['in']+1})
            # Temporarily shorten the fixture; the entire batch is restored in finally.
            for track in ('audio', 'overlay', 'text'):
                operations.extend({'type': 'remove', 'track': track, 'clip_id': c['id']} for c in original['tracks'][track])
            operations.extend({'type': 'remove', 'track': 'main', 'clip_id': c['id']} for c in original['tracks']['main'][1:])
            modified = False
            try:
                edited = await call('edit_timeline', {'operations': operations})
                assert edited['status'] == 'done', edited
                modified = True
                assert edited['result']['ratio'] == '1:1'
                assert len(edited['result']['tracks']['text']) == 1
                invalid = await call('edit_timeline', {'operations': [
                    {'type': 'set_ratio', 'ratio': '9:16'},
                    {'type': 'trim', 'track': 'main', 'clip_id': 'missing', 'in': 0, 'out': 1}]})
                assert invalid['status'] == 'error'
                current = await call('get_project')
                assert current['result']['ratio'] == '1:1', 'Rejected batch mutated project'
                if edited['result']['duration'] <= 3:
                    exported = await call('export_video')
                    assert exported['status'] == 'done', exported
                    assert exported['result']['status'] == 'ready'
                    print('MP4 device export passed')
            finally:
                if modified:
                    restored = await call('undo_edit')
                    assert restored['status'] == 'done'
                    assert restored['result'] == original, 'Undo did not restore project'
            print('MCP discovery, pairing, batch edits, sound import, invalid-batch atomicity and undo passed')


if __name__ == '__main__':
    asyncio.run(main())
