@echo off
rem Double-click this file to run the Banhall document uploader.
rem It only reads your files and uploads copies to the Banhall review queue.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0banhall-uploader.ps1"
