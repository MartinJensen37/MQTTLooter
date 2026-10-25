# Test-only TLS fixtures

Used by `tests/transport-matrix.test.ts` against loopback servers. Never use these keys anywhere else.

- `ca.crt`: test CA. Its private key was deleted after signing, so no further certificates can be issued from it.
- `server.crt` / `server.key`: `CN=localhost`, SAN `DNS:localhost` only. Connecting to `127.0.0.1` therefore needs the server name `localhost`.
- `client.crt` / `client.key`: client certificate for mutual TLS.
- `client-encrypted.key`: the same client key encrypted with the passphrase `test-only-passphrase`.

Valid until 2126.
