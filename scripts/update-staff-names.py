# -*- coding: utf-8 -*-
"""Update staff names in Supabase and verify results."""
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

sql = (
    "UPDATE staff SET name = '井元 浩' WHERE email = 'hiroshiinomoto@startus-kanazawa.org';\n"
    "UPDATE staff SET name = '松倉 純子' WHERE email = 'junkomatsukura@startus-kanazawa.org';\n"
    "UPDATE staff SET name = '竹井 早葉子' WHERE email = 'sayokotakei@startus-kanazawa.org';\n"
    "UPDATE staff SET name = '櫻井 明日花' WHERE email = 'asuka.sakurai@startus-kanazawa.org';\n"
    "SELECT name, email FROM staff ORDER BY email;\n"
)

payload = json.dumps({"query": sql})

# Write payload to temp file to avoid shell encoding issues
with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as f:
    f.write(payload)
    tmpfile = f.name

# Write output to temp file
outfile = tmpfile + ".out"

try:
    result = subprocess.run(
        [
            "curl", "-s", "-X", "POST",
            f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
            "-H", f"Authorization: Bearer {TOKEN}",
            "-H", "Content-Type: application/json; charset=utf-8",
            "-d", f"@{tmpfile}",
            "-o", outfile,
        ],
        capture_output=True,
    )

    # Read response as UTF-8
    with open(outfile, "r", encoding="utf-8") as f:
        response_text = f.read()

    data = json.loads(response_text)
    for row in data:
        name = row.get("name", "")
        email = row.get("email", "")
        print(f"  {name} | {email}")

finally:
    for f in [tmpfile, outfile]:
        try:
            os.unlink(f)
        except:
            pass
