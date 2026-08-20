#!/bin/bash
# Double-click this file on a Mac to run the Banhall document uploader.
# It only reads your files and uploads copies to the Banhall review queue.
cd "$(dirname "$0")" && exec bash ./banhall-uploader.sh "$@"
