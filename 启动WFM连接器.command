#!/bin/zsh
cd -- "${0:A:h}"
if [[ -x /opt/homebrew/bin/python3 ]]; then
  /opt/homebrew/bin/python3 server.py --wfm
else
  python3 server.py --wfm
fi
