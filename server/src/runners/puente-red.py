"""Puente TCP->Unix dentro del namespace de red privado. No contiene credenciales."""
import os
import selectors
import socket
import socketserver
import subprocess
import sys
import threading


class Relay(socketserver.BaseRequestHandler):
    def handle(self):
        upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            upstream.connect('/tmp/telo-network/broker.sock')
            with selectors.DefaultSelector() as selector:
                selector.register(self.request, selectors.EVENT_READ, upstream)
                selector.register(upstream, selectors.EVENT_READ, self.request)
                while True:
                    for key, _ in selector.select():
                        data = key.fileobj.recv(65536)
                        if not data:
                            return
                        key.data.sendall(data)
        finally:
            upstream.close()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 64


with Server(('127.0.0.1', 18081), Relay) as server:
    threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.05}, daemon=True).start()
    child = subprocess.Popen(sys.argv[1:], env=os.environ)
    code = child.wait()
    server.shutdown()
    sys.exit(code if code >= 0 else 128 - code)
