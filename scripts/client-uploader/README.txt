BANHALL DOCUMENT UPLOADER
=========================

What it does
  Scans your OneDrive "Applications" folder and uploads copies of past
  PDs and interview transcripts into the Banhall app's review queue.
  It never changes, moves, or deletes anything on your computer.
  Nothing enters the AI until it is reviewed and approved inside the app.

How to run it
  On Windows:  double-click  Run-Uploader.bat
  On Mac:      double-click  Run-Uploader.command
               (if macOS blocks it: right-click the file, choose Open, then Open)

  1. It shows how many documents it found. Type  y  and press Enter.
  2. When it finishes, it prints a summary. That's it.
  Running it again later is safe - files already uploaded are skipped.

If it can't find your folder
  Open uploader-config.json in Notepad/TextEdit and put the full folder
  path in "root", then save and run again. Examples:
    Windows: "root": "C:\\Users\\michael\\OneDrive - Banhall\\Applications"
             (use double backslashes)
    Mac:     "root": "/Users/michael/Library/CloudStorage/OneDrive-Banhall/Applications"

Questions / anything unexpected
  Contact the dev team. The upload-log.txt file next to the script lists
  exactly what was sent.
