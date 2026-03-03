# -*- coding: utf-8 -*-
"""Verify staff names in Supabase."""
import json
import subprocess
import os
import sys
import tempfile

PROJECT_REF = "jfsxywwufwdprqdkyxhr"
TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN", "")

if not TOKEN:
    print("Error: SUPABASE_ACCESS_TOKEN not set")
    sys.exit(1)

sql_check = "SELECT name, email FROM staff ORDER BY email;"
payload_check = json.dumps({"query": sql_check})

with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
    f.write(payload_check)
    tmpfile = f.name

outfile = tmpfile + ".out"

try:
    subprocess.run(
        [
            "curl", "-s", "-X", "POST",
            f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
            "-H", f"Authorization: Bearer {TOKEN}",
            "-H", "Content-Type: application/json",
            "-d", f"@{tmpfile}",
            "-o", outfile,
        ],
    )

    with open(outfile, "rb") as f:
        raw = f.read()

    text = raw.decode("utf-8")
    data = json.loads(text)

    # Write results to a UTF-8 file for proper display
    result_file = os.path.join(os.path.dirname(tmpfile), "staff_result.txt")
    with open(result_file, "w", encoding="utf-8") as rf:
        for row in data:
            line = f"{row['name']} | {row['email']}"
            rf.write(line + "\n")

    # Print result file path
    print(f"RESULT_FILE={result_file}")

    # Also check expected names
    expected = {
        "asuka.sakurai@startus-kanazawa.org": "櫻井 明日花",
        "hiroshiinomoto@startus-kanazawa.org": "井元 浩",
        "hisashimatsui@startus-kanazawa.org": "松井 久",
        "junkomatsukura@startus-kanazawa.org": "松倉 純子",
        "sayokotakei@startus-kanazawa.org": "竹井 早葉子",
        "startus@startus-kanazawa.org": "管理者",
    }

    all_ok = True
    for row in data:
        email = row["email"]
        name = row["name"]
        exp = expected.get(email, "???")
        match = "OK" if name == exp else "MISMATCH"
        if match != "OK":
            all_ok = False
        # Use repr for safe printing
        print(f"  {match}: email={email} name={name!r} expected={exp!r}")

    if all_ok:
        print("\nALL NAMES CORRECT!")
    else:
        print("\nSOME NAMES DO NOT MATCH")

finally:
    for f in [tmpfile, outfile]:
        try:
            os.unlink(f)
        except:
            pass
