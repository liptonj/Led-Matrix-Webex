#!/usr/bin/env python3
"""
Verify embedded PEM certificates in firmware CA bundle.

This script parses `firmware/src/common/ca_certs.h`, extracts all PEM blocks, and
runs `openssl x509` sanity checks:
- Expiration relative to 2025-06-23
- Signature algorithm (flags SHA-1)
- Public key strength (flags RSA < 2048)
- Self-signed roots (informational)
"""

from __future__ import annotations

import datetime as dt
import re
import subprocess
import sys


def _parse_openssl_date(value: str) -> dt.date | None:
    try:
        return dt.datetime.strptime(value, "%b %d %H:%M:%S %Y %Z").date()
    except ValueError:
        return None


def main() -> int:
    ca_path = "firmware/src/common/ca_certs.h"
    try:
        content = open(ca_path, "r", encoding="utf-8").read()
    except OSError as exc:
        print(f"ERROR: failed to read {ca_path}: {exc}", file=sys.stderr)
        return 2

    certs = re.findall(
        r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
        content,
        flags=re.S,
    )
    print(f"Found {len(certs)} PEM certificate blocks in {ca_path}")

    cutoff = dt.date(2025, 6, 23)
    parsed = 0
    failed = 0

    for idx, pem in enumerate(certs, start=1):
        proc = subprocess.run(
            ["openssl", "x509", "-noout", "-text"],
            input=pem.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if proc.returncode != 0:
            failed += 1
            print(f"[{idx}] PARSE_FAIL: {proc.stderr.decode('utf-8', errors='replace').strip()}")
            continue

        parsed += 1
        text = proc.stdout.decode("utf-8", errors="replace")

        def grab(prefix: str) -> str:
            match = re.search(prefix + r"\s*([^\n]+)", text)
            return match.group(1).strip() if match else ""

        subject = grab("Subject:")
        issuer = grab("Issuer:")
        not_before = grab("Not Before:")
        not_after = grab("Not After :")
        sig_alg = grab("Signature Algorithm:")

        key_bits_match = (
            re.search(r"(?:RSA )?Public-Key: \((\d+) bit\)", text)
            or re.search(r"RSA Public-Key: \((\d+) bit\)", text)
        )
        key_bits = int(key_bits_match.group(1)) if key_bits_match else None

        not_after_date = _parse_openssl_date(not_after)
        not_before_date = _parse_openssl_date(not_before)

        issues: list[str] = []
        if not_after_date and not_after_date < cutoff:
            issues.append(f"CRITICAL expired {not_after_date.isoformat()}")
        if not_before_date and not_before_date > cutoff:
            issues.append(f"WARN notYetValid {not_before_date.isoformat()}")
        if "sha1" in sig_alg.lower():
            issues.append(f"WARN insecureSig {sig_alg}")

        if key_bits is not None and key_bits < 2048 and "rsa" in text.lower():
            issues.append(f"WARN weakKey RSA {key_bits}")

        if subject and issuer and subject == issuer:
            issues.append("INFO selfSigned")

        cn_match = re.search(r"CN\s*=\s*([^,\n/]+)", subject)
        cn = cn_match.group(1).strip() if cn_match else "(no CN)"

        if issues:
            print(
                f"[{idx}] CN={cn} notAfter={not_after} keyBits={key_bits} sig={sig_alg} | "
                + " | ".join(issues)
            )
        else:
            print(f"[{idx}] CN={cn} notAfter={not_after} keyBits={key_bits} sig={sig_alg} PASS")

    print(f"Parsed: {parsed}, failed: {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

