BANHALL DOCUMENT UPLOADER
=========================

What it does
  Scans your OneDrive "Applications" folder and uploads copies of past
  PDs and interview transcripts into the Banhall app's review queue.
  It never changes, moves, or deletes anything on your computer.
  Nothing enters the AI until it is reviewed and approved inside the app.

How to run it
  On Windows:  double-click  Run-Uploader.bat
               OR drag one or more folders onto Run-Uploader.bat to upload
               exactly those folders (e.g. a client's whole folder, or its
               PDs / Drafts / Supporting Documents folders together).
               Folders inside your Applications folder keep their client
               and fiscal-year labels automatically.
  On Mac:      double-click  Run-Uploader.command
               (if macOS blocks it: right-click the file, choose Open, then Open)

  1. It shows how many documents it found. Type  y  and press Enter.
     If it found more than 100, it offers a TEST batch: type  t  to upload
     just the first 100 and check them in the app first. Run it again later
     and type  a  to send the rest.
     If some of your files are stored online only, it also says how many
     OneDrive will download while uploading - those take longer.
  2. When it finishes, it prints a summary. That's it.
  Running it again later is safe - files already uploaded are skipped.
  It remembers your last folder and asks each run whether to scan it again
  or choose a different one (type  c  to pick a new folder).

If it says it found 0 documents
  It prints a short breakdown right underneath the count: how many files it
  walked, how many it skipped and why, how many it could not read, which file
  types it did see, and whether the folder sits inside your OneDrive sync
  folder. The same lines are saved to upload-log.txt, each one starting with
  SCAN. Send that file to the dev team - it describes what the scan saw
  without naming any of your documents. If the script says it could not write
  upload-log.txt, send a screenshot of the window instead - the same lines are
  on screen.

If it can't find your folder
  Open uploader-config.json in Notepad/TextEdit and put the full folder
  path in "root", then save and run again. Examples:
    Windows: "root": "C:\\Users\\michael\\OneDrive - Banhall\\Applications"
             (use double backslashes)
    Mac:     "root": "/Users/michael/Library/CloudStorage/OneDrive-Banhall/Applications"
  Point it at a folder, not at a single document. If you point it at a file
  it says "That path is a file, not a folder" and stops.

Questions / anything unexpected
  Contact the dev team and send them upload-log.txt from next to the script.
  It records each run: one line per file that was sent, skipped, or refused,
  and the SCAN lines from a run that found nothing.
