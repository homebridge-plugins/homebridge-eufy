# Collecting diagnostics safely

Use **Diagnostics** in the plugin dashboard: picking the area the problem is in starts a capture, and
finishing it downloads an encrypted `.eufysupport.gz` diagnostics file. The final `.gz` suffix allows
the file to be attached to a GitHub issue. Nothing is uploaded by the plugin.

- Reproduce one issue at a time and finish the capture promptly.
- Share only the encrypted archive through a channel agreed with a maintainer.
- Delete downloaded archives when the support case is complete and within 24 hours where possible.
- Never upload the Homebridge storage directory, account stores, raw logs, or raw SDK objects.
- Never grant remote camera, account, or Homebridge access for diagnostics.

The plaintext manifest contains the random support case identifier, selected profile, reproduction
times, archive expiry, evidence fields and privacy classes, missing evidence and reasons, archive format,
and support-key identifier. Evidence content
exists only inside the encrypted archive. Passwords, captcha and verification answers, tokens, cookies,
authorization data, session and push stores, private and symmetric keys, unconstrained SDK data, cached
camera images, talkback, and raw media are always excluded by source allowlists.

The JSONL file under `homebridge-eufy/logs/` remains an owner-readable local operational log, not a
support archive. Do not share it directly.

The plugin does not retain a generated archive after returning its encrypted bytes to the dashboard,
which is stricter than the 24-hour temporary-artifact limit. The manifest records a 24-hour expiry for
the downloaded copy; files saved by the browser are under the user's control and should be deleted by
that time.

## Support key custody

Archive key `support-2026-08-01` is a 4096-bit RSA support key. The embedded public key may only encrypt
archives. The matching private key is held outside source control, CI, release artifacts, and
Homebridge installations by the named project custodian, maintainer `@lenoxys`. Export verifies the
embedded key's pinned SHA-256 fingerprint before use and erases each temporary content key after
encryption.

Key rotation assigns a new dated key identifier and ships its public key before new exports use it.
The custodian retains a superseded private key for 90 days to finish active support cases, then destroys
it. A compromised key has no compatibility window: export to it is disabled in the next release, the
private key is revoked, and users are warned not to share archives carrying that key identifier.

## Archive format

The version 1 archive is a gzip container with media type `application/gzip`. Decompressing it yields a
UTF-8 JSON encryption envelope. `wrappedKey` is a random 256-bit content key wrapped with RSA-OAEP and
SHA-256. `ciphertext` is separately gzip-compressed JSON encrypted with AES-256-GCM; `iv` is the 96-bit
nonce and `authTag` is the GCM authentication tag. Binary fields use base64. The format, version, key
identifier, algorithms, and encoding fields are authenticated as GCM additional data. The decrypted
payload contains the reviewed manifest and generated allowlisted evidence records.

## Maintainer decryption

Keep the private key at
`~/.local/share/homebridge-eufy-support/keys/support-2026-08-01-private.pem` with mode `600`, then run:

```bash
node scripts/decrypt-diagnostics.mjs /path/to/archive.eufysupport.gz
```

The V5-only decryptor verifies key permissions and fingerprint, authenticates the envelope, checks the
manifest against each evidence item, and writes owner-only `manifest.json`, JSON, and JSONL files beside
the archive. Treat that output as sensitive and delete it after the support case is complete.

The filename must name the case inside it. A reporter who renamed the upload is refused with the name the
plugin gave it; `--accept-renamed` opens the file anyway, since the name is not authenticated, and warns.
