import json, sys, re
d = sys.argv[1]
def load(p):
    try: j = json.load(open(f"{d}/{p}.json"))
    except FileNotFoundError: return None
    r = {}
    for f in j["testResults"]:
        fn = f["name"].split("pd-validate-a/")[-1]
        if not f["assertionResults"] and f.get("message"):
            r[(fn, "<FILE LOAD>")] = ("failed", f["message"][:300])
        for a in f["assertionResults"]:
            msg = (a.get("failureMessages") or [""])[0]
            msg = re.sub(r"\x1b\[[0-9;]*m", "", msg).split("\n")[0][:240]
            r[(fn, a["fullName"])] = (a["status"], msg)
    return r
b, af, ah = load("before"), load("after-fix"), load("after-head")
keys = list(dict.fromkeys(list(af) + list(b) + list(ah)))
cats = {"DISCRIMINATING (fail before, pass after-fix)": [], "NON-DISCRIMINATING (pass before and after-fix)": [], "FAIL AFTER-FIX": [], "ONLY IN HEAD": [], "OTHER": []}
for k in keys:
    sb = b.get(k, ("absent", ""))[0]; sa = af.get(k, ("absent", ""))[0]; sh = ah.get(k, ("absent", ""))[0]
    row = (k, sb, sa, sh, b.get(k, ("", ""))[1])
    if sa == "absent" and sb == "absent": cats["ONLY IN HEAD"].append(row)
    elif sb == "failed" and sa == "passed": cats["DISCRIMINATING (fail before, pass after-fix)"].append(row)
    elif sb == "passed" and sa == "passed": cats["NON-DISCRIMINATING (pass before and after-fix)"].append(row)
    elif sa != "passed": cats["FAIL AFTER-FIX"].append(row)
    else: cats["OTHER"].append(row)
for c, rows in cats.items():
    print(f"\n## {c}: {len(rows)}")
    for (fn, name), sb, sa, sh, msg in rows:
        print(f"- [{fn}] {name} | before={sb} after-fix={sa} head={sh}" + (f"\n    before-msg: {msg}" if sb == "failed" else ""))
