# adapted from: https://github.com/IRLToolkit/obs-websocket-http
# source      : https://github.com/IRLToolkit/obs-websocket-http/blob/master/main.py

# requires simpleobsws and aiohttp to be installed via pip

import asyncio
import json
import simpleobsws
import aiohttp
from aiohttp import web
from configparser import ConfigParser
import os

config = ConfigParser()
config.read('sws_http_config.ini')

httpAddress = config.get('http', 'bind_to_address')
httpPort = config.getint('http', 'bind_to_port')
httpAuthKey = config.get('http', 'authentication_key')
if httpAuthKey == '':
	print('Starting HTTP server without authentication.')
	httpAuthKey = None
else:
	print('Starting HTTP server with AuthKey set to "{}"'.format(httpAuthKey))
wsAddress = config.get('obsws', 'ws_address')
wsPort = config.getint('obsws', 'ws_port')
wsPassword = config.get('obsws', 'ws_password')

loop = asyncio.get_event_loop()

ws = simpleobsws.obsws(host=wsAddress, port=wsPort, password=wsPassword, loop=loop)

def statusmessage(message):
	print(str(message) + '...      ', end='', flush=True)

async def handle_emit_request (request):
	"""Handler function for all emit-based HTTP requests. Assumes that you know what you are doing because it will never return an error."""
	if ('AuthKey' not in request.headers) and httpAuthKey != None:
		return web.json_response({'status':'error', 'error':'AuthKey header is required.'})
	
	if httpAuthKey == None or (request.headers['AuthKey'] == httpAuthKey):
		requesttype = request.match_info['type']
		
		try:
			requestdata = await request.json()
		except json.decoder.JSONDecodeError:
			requestdata = None
		
		await ws.emit(requesttype, requestdata)
		
		return web.json_response({'status':'ok'})
	else:
		return web.json_response({'status':'error', 'error':'Bad AuthKey'})

async def handle_call_request (request):
	"""Handler function for all call-based HTTP requests."""
	if ('AuthKey' not in request.headers) and httpAuthKey != None:
		return web.json_response({'status':'error', 'error':'AuthKey header is required.'})
	
	if httpAuthKey == None or (request.headers['AuthKey'] == httpAuthKey):
		requesttype = request.match_info['type']
		requestdata = None
		
		try:
			requestdata = await request.json()
		except json.decoder.JSONDecodeError:
			if (await request.text()) == '':
				requestdata = None
		try:
			responsedata = await ws.call(requesttype, requestdata)
		except simpleobsws.MessageTimeout:
			responsedata = {'status':'error', 'error':'The obs-websocket request timed out.'}
		
		return web.json_response(responsedata)
	else:
		return web.json_response({'status':'error', 'error':'Bad AuthKey'})

app = web.Application()

app.add_routes([
	web.post('/emit/{type}', handle_emit_request),
	web.post('/call/{type}', handle_call_request),
	web.static('/', os.getcwd(), show_index=True, append_version=True)
])

statusmessage('Connecting to obs-websocket')

loop.run_until_complete(ws.connect())

print('[Connected.]')

try:
	web.run_app(app, host=httpAddress, port=httpPort)
except KeyboardInterrupt:
	print('Shutting down...')
