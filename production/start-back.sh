#!/bin/sh

# This script is intended to be run with pitit-bac's root as the active
# directory. The backend runs on any modern Node.js (18+); no version
# manager is required.

# ALLOWED_ORIGIN restricts websocket connections to your own domain.
# It is normally set by the systemd unit (see pitit-bac.service); the
# fallback below is only used when running this script by hand.
: "${ALLOWED_ORIGIN:=https://your-domain.example}"
export ALLOWED_ORIGIN

# Starts the backend server
make start-back-production
