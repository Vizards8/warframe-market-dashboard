#!/usr/bin/env python3
"""Run the same offline checks locally and in GitHub Actions."""

import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def check_frontend():
    commands = [
        ['node', '--check', str(p.relative_to(ROOT))]
        for p in sorted((ROOT / 'static/js').rglob('*.js'))
    ]
    commands += [
        ['node', str(p.relative_to(ROOT))] for p in sorted((ROOT / 'tests').glob('test_*.js'))
    ]
    for command in commands:
        print('+ ' + ' '.join(command), flush=True)
        subprocess.run(command, cwd=ROOT, check=True)


def main():
    subprocess.run(
        [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-v'],
        cwd=ROOT,
        env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
        check=True,
    )


if __name__ == '__main__':
    main()
