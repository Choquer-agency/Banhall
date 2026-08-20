@echo off
rem Double-click this file to run the Banhall document uploader, or DRAG one
rem or more folders onto it to upload exactly those folders.
rem It only reads your files and uploads copies to the Banhall review queue.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0banhall-uploader.ps1" %*
rem Keep the window open when PowerShell itself failed to start (blocked by
rem policy, missing, or a script error) so the message is actually readable.
if errorlevel 1 pause
