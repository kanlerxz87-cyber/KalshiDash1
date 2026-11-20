#!/usr/bin/env python3
"""Internal link checker for the static site (no dependencies).

Scans every HTML file in the repo, resolves relative href/src/action targets,
and fails if any internal link is broken. External links are reported for
convenience but never block the build.

    python3 tools/linkcheck.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[1]
LINK_RE = re.compile(r"""\b(?:href|src|action)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
# JS template literals inside inline <script> blocks contain href=/src= fragments that are not links.
SCRIPT_RE = re.compile(r"<script\b.*?</script>|<style\b.*?</style>", re.IGNORECASE | re.DOTALL)
SKIP_PREFIXES = ("http://", "https://", "mailto:", "tel:", "javascript:", "data:", "#")


def local_target(url: str) -> str | None:
    """Return the path part of an internal link, or None when it is external/anchor."""
    if url.lower().startswith(SKIP_PREFIXES):
        return None
    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc:
        return None
    path = parsed.path
    if not path:
        return None
    # Normalise away ?query/#fragment for filesystem resolution.
    return urlunparse(("", "", path, "", "", ""))


def main() -> int:
    pages = sorted(p for p in ROOT.rglob("*.html") if ".git" not in p.parts)
    if not pages:
        print("no HTML files found", file=sys.stderr)
        return 1

    broken: list[str] = []
    external: set[str] = set()
    checked = 0
    for page in pages:
        text = SCRIPT_RE.sub(" ", page.read_text(encoding="utf-8", errors="replace"))
        for raw in LINK_RE.findall(text):
            url = raw.strip()
            if not url:
                continue
            low = url.lower()
            if low.startswith(("http://", "https://")):
                external.add(url.split("#")[0])
                continue
            target = local_target(url)
            if target is None:
                continue
            checked += 1
            # Directory links must contain an index.html.
            candidate = (page.parent / target).resolve()
            if target.endswith("/") or candidate.suffix == "":
                ok = (candidate / "index.html").exists() or candidate.with_suffix(".html").exists() or candidate.is_dir()
            else:
                ok = candidate.exists()
            if not ok:
                broken.append(f"{page.relative_to(ROOT)} -> {url}")

    print(f"pages scanned:        {len(pages)}")
    print(f"internal links checked: {checked}")
    print(f"external links found:   {len(external)} (not fetched by this checker)")
    if broken:
        print("\nBROKEN INTERNAL LINKS:")
        for b in sorted(set(broken)):
            print("  - " + b)
        return 1
    print("\nOK: no broken internal links.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
