#!/usr/bin/env python3
import sys
import json
import csv
import urllib.request
import urllib.error

API_URL = "https://api.elevenlabs.io/v1/voices"


def fetch_voices(api_key: str):
    req = urllib.request.Request(API_URL)
    req.add_header("xi-api-key", api_key)

    try:
        with urllib.request.urlopen(req) as resp:
            data = resp.read().decode("utf-8")
            return json.loads(data)
    except urllib.error.HTTPError as e:
        print(f"HTTP error: {e.code} {e.reason}")
        try:
            body = e.read().decode("utf-8")
            print("Response body:", body)
        except Exception:
            pass
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}")
        sys.exit(1)


def export_to_json(data, filename="voices.json"):
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Wrote raw JSON to {filename}")


def export_to_csv(data, filename="voices.csv"):
    voices = data.get("voices", [])
    fieldnames = [
        "voice_id",
        "name",
        "category",
        "gender",
        "age",
        "accent",
        "description",
    ]

    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()

        for v in voices:
            labels = v.get("labels", {}) or {}
            row = {
                "voice_id": v.get("voice_id", ""),
                "name": v.get("name", ""),
                "category": v.get("category", ""),
                "gender": labels.get("gender", ""),
                "age": labels.get("age", ""),
                "accent": labels.get("accent", ""),
                "description": v.get("description", ""),
            }
            writer.writerow(row)

    print(f"Wrote CSV with {len(voices)} voices to {filename}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python export_elevenlabs_voices.py ELEVENLABS_API_KEY")
        sys.exit(1)

    api_key = sys.argv[1].strip()
    if not api_key:
        print("Error: empty API key.")
        sys.exit(1)

    print("Fetching voices from ElevenLabs...")
    data = fetch_voices(api_key)

    if "voices" not in data:
        print("Warning: 'voices' key not in response. Raw response:")
        print(json.dumps(data, indent=2))
        sys.exit(1)

    export_to_json(data)
    export_to_csv(data)


if __name__ == "__main__":
    main()
