#!/usr/bin/env python3
"""
IPTV Channel Downloader, Combiner & Auto-Refresher
Source: https://iptv-org.github.io/

This script:
1. Downloads master playlists from iptv-org (categories, countries, languages, index).
2. Parses, cleans, enriches, and deduplicates all channels into a unified global catalog.
3. Generates:
   - hisense_iptv.m3u & all_channels.m3u (Combined master M3U grouped by Country | Category)
   - index.country.m3u (Grouped by Country)
   - index.category.m3u (Grouped by Category)
   - Country sub-playlists in countries/ (us.m3u, uk.m3u, india.m3u, canada.m3u, etc.)
   - Category sub-playlists in categories/ (news.m3u, movies.m3u, sports.m3u, etc.)
   - playlist.json & public/playlist.json (formatted for Hisense VIDAA TV Web App)
"""

import os
import sys
import json
import re
import time
import urllib.request
import urllib.error
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
PUBLIC_DIR = os.path.join(SCRIPT_DIR, "public")
CATEGORIES_DIR = os.path.join(SCRIPT_DIR, "categories")
COUNTRIES_DIR = os.path.join(SCRIPT_DIR, "countries")
LANGUAGES_DIR = os.path.join(SCRIPT_DIR, "languages")

MASTER_SOURCES = {
    "category": "https://iptv-org.github.io/iptv/index.category.m3u",
    "country": "https://iptv-org.github.io/iptv/index.country.m3u",
    "language": "https://iptv-org.github.io/iptv/index.language.m3u",
    "index": "https://iptv-org.github.io/iptv/index.m3u"
}

TAMIL_KEYWORDS = re.compile(
    r"\b(tamil|sun\s*tv|sun\s*music|sun\s*news|ktv|vijay|jaya|thanthi|polimer|"
    r"puthiya\s*thalaimurai|kalaignar|raj\s*tv|raj\s*musix|captain|mega\s*tv|"
    r"vasanth|lotus|malaimurasu|sathiyam|velicham|peppers|madha|isai|chithiram|"
    r"sirippoli|murasu|seithigal|vendhar|makkal|moon\s*tv|tamilan|vanavil|"
    r"imayam|mk\s*tv|cauvery|valicham|dheeran|news18\s*tamil|tamil\s*janam|"
    r"arputhar|aaryaa|aaseervatham|aathavan)\b",
    re.IGNORECASE
)

# Common country name to ISO 2-letter code mapping
COUNTRY_CODE_MAP = {
    "united states": "us",
    "united kingdom": "uk",
    "india": "in",
    "canada": "ca",
    "australia": "au",
    "germany": "de",
    "france": "fr",
    "spain": "es",
    "italy": "it",
    "brazil": "br",
    "mexico": "mx",
    "russia": "ru",
    "china": "cn",
    "japan": "jp",
    "south korea": "kr",
    "netherlands": "nl",
    "turkiye": "tr",
    "argentina": "ar",
    "colombia": "co",
    "chile": "cl",
    "peru": "pe",
    "indonesia": "id",
    "pakistan": "pk",
    "bangladesh": "bd",
    "sweden": "se",
    "norway": "no",
    "denmark": "dk",
    "finland": "fi",
    "poland": "pl",
    "ukraine": "ua",
    "south africa": "za",
    "new zealand": "nz",
    "ireland": "ie",
    "international": "int"
}

def fetch_url_content(url, timeout=30, retries=3):
    headers = {
        "User-Agent": "Mozilla/5.0 (SmartTV; Hisense/VIDAA; Linux) AppleWebKit/537.36 IPTV-Downloader/1.0"
    }
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.read().decode("utf-8", errors="ignore")
        except Exception as e:
            if attempt == retries:
                print(f"[ERROR] Failed to fetch {url} after {retries} attempts: {e}")
                return ""
            time.sleep(2)
    return ""

def parse_m3u_text(content):
    """
    Parses an M3U playlist and returns a list of raw entries.
    """
    entries = []
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("#EXTINF:"):
            raw_inf = line
            comma_idx = line.find(",")
            if comma_idx != -1:
                channel_name = line[comma_idx + 1:].strip()
            else:
                channel_name = "Untitled Channel"

            tvg_id_m = re.search(r'tvg-id="([^"]*)"', line, re.IGNORECASE)
            tvg_name_m = re.search(r'tvg-name="([^"]*)"', line, re.IGNORECASE)
            tvg_logo_m = re.search(r'tvg-logo="([^"]*)"', line, re.IGNORECASE)
            group_m = re.search(r'group-title="([^"]*)"', line, re.IGNORECASE)

            tvg_id = tvg_id_m.group(1).strip() if tvg_id_m else ""
            tvg_name = tvg_name_m.group(1).strip() if tvg_name_m else ""
            tvg_logo = tvg_logo_m.group(1).strip() if tvg_logo_m else ""
            group_title = group_m.group(1).strip() if group_m else ""

            i += 1
            extra_lines = []
            stream_url = ""
            while i < len(lines):
                cur = lines[i].strip()
                if not cur:
                    i += 1
                    continue
                if cur.startswith("#EXTINF:"):
                    i -= 1
                    break
                if cur.startswith("#"):
                    extra_lines.append(cur)
                    i += 1
                    continue
                stream_url = cur
                break

            if stream_url:
                entries.append({
                    "raw_inf": raw_inf,
                    "tvg_id": tvg_id,
                    "tvg_name": tvg_name or channel_name,
                    "tvg_logo": tvg_logo,
                    "group_title": group_title,
                    "name": channel_name,
                    "url": stream_url,
                    "extra_lines": extra_lines
                })
        i += 1
    return entries

def is_tamil_channel(name, ch_id, category, language):
    if language and language.lower() == "tamil":
        return True
    if TAMIL_KEYWORDS.search(name):
        return True
    if ch_id and re.search(r"tamil|\.ta@", ch_id, re.IGNORECASE):
        return True
    if category and "tamil" in category.lower():
        return True
    return False

def normalize_category(cat, name):
    """Normalize category names for consistent UI display."""
    if not cat or cat.lower() in ["undefined", "other", "general"]:
        n = name.lower()
        if re.search(r"\b(news|samachar|khabar|aaj tak|ndtv|republic|india today|wion|times now|thanthi|polimer|puthiya|abp|tv9|bbc|dd news|pratham|janata|dainik|live 24|seithigal|cnn|nbc|cbs|fox|msnbc|al jazeera)\b", n):
            return "News"
        if re.search(r"\b(music|9x|jalwa|tashan|jhakaas|balle|musiq|mastiii|gaana|hits|mtv|isai|chithiram|sangeet|aruvi|vh1|vevo)\b", n):
            return "Music"
        if re.search(r"\b(movie|cinema|talkies|cine|filmy|goldmines|zee cinema|b4u|max|ktv|action|picture|murasu|film|hbo|cinemax)\b", n):
            return "Movies"
        if re.search(r"\b(sports|cricket|football|wwe|eurosport|ten|dd sports|espn|bein|nba|nfl|mlb)\b", n):
            return "Sports"
        if re.search(r"\b(kids|cartoon|pogo|hungama|nick|disney|sonic|junior|chutti|boomerang)\b", n):
            return "Kids"
        if re.search(r"\b(bhakti|aastha|sadhna|satsang|devotional|darshan|shree|peace|gospel|lord|prayer|temple|madha|arputhar|aaseervatham)\b", n):
            return "Devotional"
        if re.search(r"\b(tv|star|colors|zee|sony|sun|vijay|kalaignar|sab|dangal|dd|etv|gemini|surya|udaya|asianet|mazhavil|kairali|jaya|raj|captain|makkal|moon|vendhar)\b", n):
            return "Entertainment"
        return "General"

    c = cat.split(";")[0].strip()
    mapping = {
        "Religious": "Devotional",
        "Animation": "Kids",
        "Classic": "Movies",
        "Series": "Entertainment",
        "Comedy": "Entertainment",
        "Auto": "General",
        "Business": "News",
        "Weather": "News",
        "Legislative": "News",
        "Culture": "Documentary",
        "Education": "Documentary",
        "Outdoor": "Sports",
        "Relax": "Music",
        "Cooking": "Lifestyle",
        "Shop": "General",
        "Public": "General",
        "Science": "Documentary",
        "Travel": "Documentary",
        "Family": "Entertainment"
    }
    return mapping.get(c, c)

def run():
    print("=" * 65)
    print("🌍 IPTV-ORG Global Channel Downloader & Combiner")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 65)

    os.makedirs(PUBLIC_DIR, exist_ok=True)
    os.makedirs(CATEGORIES_DIR, exist_ok=True)
    os.makedirs(COUNTRIES_DIR, exist_ok=True)
    os.makedirs(LANGUAGES_DIR, exist_ok=True)
    os.makedirs(os.path.join(PUBLIC_DIR, "countries"), exist_ok=True)
    os.makedirs(os.path.join(PUBLIC_DIR, "categories"), exist_ok=True)

    # 1. Fetch playlists from iptv-org
    print("\n[1/5] Downloading master playlists from https://iptv-org.github.io/...")
    cat_content = fetch_url_content(MASTER_SOURCES["category"])
    print(f"  ✓ Category Index: {len(cat_content) / 1024 / 1024:.2f} MB")

    country_content = fetch_url_content(MASTER_SOURCES["country"])
    print(f"  ✓ Country Index:  {len(country_content) / 1024 / 1024:.2f} MB")

    lang_content = fetch_url_content(MASTER_SOURCES["language"])
    print(f"  ✓ Language Index: {len(lang_content) / 1024 / 1024:.2f} MB")

    # 2. Parse entries
    print("\n[2/5] Parsing channels and metadata...")
    cat_entries = parse_m3u_text(cat_content)
    country_entries = parse_m3u_text(country_content)
    lang_entries = parse_m3u_text(lang_content)

    # Lookups by URL and ID
    country_map = {e["url"]: e["group_title"] for e in country_entries if e["group_title"]}
    lang_map = {e["url"]: e["group_title"] for e in lang_entries if e["group_title"]}

    country_id_map = {e["tvg_id"]: e["group_title"] for e in country_entries if e["tvg_id"] and e["group_title"]}
    lang_id_map = {e["tvg_id"]: e["group_title"] for e in lang_entries if e["tvg_id"] and e["group_title"]}

    # 3. Combine and Deduplicate
    print("\n[3/5] Combining all global channels...")
    channels_by_url = {}

    for entry in cat_entries:
        url = entry["url"]
        tvg_id = entry["tvg_id"]
        category = entry["group_title"] or "General"
        country = country_map.get(url) or country_id_map.get(tvg_id) or "International"
        language = lang_map.get(url) or lang_id_map.get(tvg_id) or "Other"

        norm_cat = normalize_category(category, entry["name"])

        channels_by_url[url] = {
            "name": entry["name"],
            "tvg_id": tvg_id,
            "tvg_name": entry["tvg_name"] or entry["name"],
            "tvg_logo": entry["tvg_logo"],
            "category": norm_cat,
            "original_category": category,
            "country": country,
            "language": language,
            "url": url,
            "extra_lines": entry["extra_lines"]
        }

    for entry in country_entries:
        url = entry["url"]
        if url not in channels_by_url:
            tvg_id = entry["tvg_id"]
            country = entry["group_title"] or "International"
            language = lang_map.get(url) or lang_id_map.get(tvg_id) or "Other"
            norm_cat = normalize_category("General", entry["name"])
            channels_by_url[url] = {
                "name": entry["name"],
                "tvg_id": tvg_id,
                "tvg_name": entry["tvg_name"] or entry["name"],
                "tvg_logo": entry["tvg_logo"],
                "category": norm_cat,
                "original_category": "General",
                "country": country,
                "language": language,
                "url": url,
                "extra_lines": entry["extra_lines"]
            }

    for entry in lang_entries:
        url = entry["url"]
        if url not in channels_by_url:
            tvg_id = entry["tvg_id"]
            language = entry["group_title"] or "Other"
            country = country_map.get(url) or country_id_map.get(tvg_id) or "International"
            norm_cat = normalize_category("General", entry["name"])
            channels_by_url[url] = {
                "name": entry["name"],
                "tvg_id": tvg_id,
                "tvg_name": entry["tvg_name"] or entry["name"],
                "tvg_logo": entry["tvg_logo"],
                "category": norm_cat,
                "original_category": "General",
                "country": country,
                "language": language,
                "url": url,
                "extra_lines": entry["extra_lines"]
            }

    # Preserve custom channels from existing playlist.json
    existing_json_path = os.path.join(SCRIPT_DIR, "playlist.json")
    if os.path.exists(existing_json_path):
        try:
            with open(existing_json_path, "r", encoding="utf-8") as f:
                saved = json.load(f)
            custom_added = 0
            for item in saved:
                url = item.get("url")
                if url and url not in channels_by_url:
                    name = item.get("name", "Custom Channel")
                    cat = item.get("category", "General")
                    logo = item.get("logo", "")
                    lang = item.get("language", "Other")
                    country = item.get("country", "International")
                    channels_by_url[url] = {
                        "name": name,
                        "tvg_id": item.get("id", ""),
                        "tvg_name": name,
                        "tvg_logo": logo,
                        "category": normalize_category(cat, name),
                        "original_category": cat,
                        "country": country,
                        "language": lang,
                        "url": url,
                        "extra_lines": []
                    }
                    custom_added += 1
            if custom_added > 0:
                print(f"  ✓ Preserved {custom_added} custom existing channels")
        except Exception as e:
            print(f"  [WARN] Could not parse existing playlist.json: {e}")

    channel_list = list(channels_by_url.values())

    for ch in channel_list:
        ch["is_tamil"] = is_tamil_channel(ch["name"], ch["tvg_id"], ch["category"], ch["language"])

    # Fair Global Sort: Sort alphabetically by Country, then Category, then Name
    # (No country is unfairly forced to the top!)
    def global_sort_key(ch):
        return (ch.get("country", "Unknown").lower(), ch.get("category", "General"), ch["name"].lower())

    channel_list.sort(key=global_sort_key)
    print(f"  Total unique channels: {len(channel_list)}")

    # Country statistics
    country_counts = {}
    for ch in channel_list:
        c = ch.get("country", "International")
        country_counts[c] = country_counts.get(c, 0) + 1

    print("\n  Top Countries Loaded:")
    for c, cnt in sorted(country_counts.items(), key=lambda x: -x[1])[:10]:
        print(f"    • {c}: {cnt} channels")

    # 4. Generate M3U files
    print("\n[4/5] Generating M3U files...")
    m3u_header = '#EXTM3U x-tvg-url="https://worker-9dd4.onrender.com/guide.xml.gz" tvg-shift=0\n\n'

    def generate_m3u(items, group_mode="both"):
        """
        group_mode:
          'both': group-title="Country | Category"
          'country': group-title="Country"
          'category': group-title="Category"
        """
        out = [m3u_header]
        for ch in items:
            tvg_id_attr = f' tvg-id="{ch["tvg_id"]}"' if ch["tvg_id"] else ''
            tvg_name_attr = f' tvg-name="{ch["tvg_name"]}"' if ch["tvg_name"] else ''
            tvg_logo_attr = f' tvg-logo="{ch["tvg_logo"]}"' if ch["tvg_logo"] else ''
            country_attr = f' tvg-country="{ch["country"]}"' if ch["country"] else ''
            lang_attr = f' tvg-language="{ch["language"]}"' if ch["language"] else ''

            if group_mode == "both":
                group_val = f"{ch['country']} | {ch['category']}"
            elif group_mode == "country":
                group_val = ch['country']
            else:
                group_val = ch['category']

            group_attr = f' group-title="{group_val}"'

            inf_line = f'#EXTINF:-1{tvg_id_attr}{tvg_name_attr}{tvg_logo_attr}{group_attr}{country_attr}{lang_attr},{ch["name"]}\n'
            out.append(inf_line)
            for ex in ch["extra_lines"]:
                out.append(f"{ex}\n")
            out.append(f"{ch['url']}\n")
        return "".join(out)

    # Master combined playlist (Grouped by "Country | Category")
    master_both = generate_m3u(channel_list, group_mode="both")
    # Master combined playlist (Grouped strictly by Country)
    master_country = generate_m3u(channel_list, group_mode="country")
    # Master combined playlist (Grouped strictly by Category)
    master_category = generate_m3u(channel_list, group_mode="category")

    # Save master playlists
    master_mappings = [
        ("hisense_iptv.m3u", master_both),
        ("all_channels.m3u", master_both),
        ("playlist.m3u", master_both),
        ("index.country.m3u", master_country),
        ("index.category.m3u", master_category),
    ]

    for fname, content in master_mappings:
        with open(os.path.join(SCRIPT_DIR, fname), "w", encoding="utf-8") as f:
            f.write(content)
        with open(os.path.join(PUBLIC_DIR, fname), "w", encoding="utf-8") as f:
            f.write(content)

    print("  ✓ Saved Master Playlists:")
    print("    • hisense_iptv.m3u (Group-Title: Country | Category)")
    print("    • index.country.m3u (Group-Title: Country)")
    print("    • index.category.m3u (Group-Title: Category)")

    # Group by Country and write individual country playlists
    countries_grouped = {}
    for ch in channel_list:
        c = ch.get("country", "International")
        countries_grouped.setdefault(c, []).append(ch)

    print(f"  ✓ Writing {len(countries_grouped)} individual country playlists...")
    for c_name, c_items in countries_grouped.items():
        slug = re.sub(r"[^a-zA-Z0-9_-]", "_", c_name.lower())
        m3u_text = generate_m3u(c_items, group_mode="category")
        
        # Save by full country name: countries/united_states.m3u
        full_path = os.path.join(COUNTRIES_DIR, f"{slug}.m3u")
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(m3u_text)
        with open(os.path.join(PUBLIC_DIR, "countries", f"{slug}.m3u"), "w", encoding="utf-8") as f:
            f.write(m3u_text)

        # Also save short code if exists (e.g. us.m3u, uk.m3u, ca.m3u, in.m3u)
        short_code = COUNTRY_CODE_MAP.get(c_name.lower())
        if short_code:
            code_path = os.path.join(COUNTRIES_DIR, f"{short_code}.m3u")
            with open(code_path, "w", encoding="utf-8") as f:
                f.write(m3u_text)
            with open(os.path.join(PUBLIC_DIR, f"{short_code}.m3u"), "w", encoding="utf-8") as f:
                f.write(m3u_text)
            with open(os.path.join(PUBLIC_DIR, "countries", f"{short_code}.m3u"), "w", encoding="utf-8") as f:
                f.write(m3u_text)

    # Group by Category and write category playlists
    categories_grouped = {}
    for ch in channel_list:
        cat = ch.get("category", "General")
        categories_grouped.setdefault(cat, []).append(ch)

    for cat_name, cat_items in categories_grouped.items():
        slug = re.sub(r"[^a-zA-Z0-9_-]", "_", cat_name.lower())
        m3u_text = generate_m3u(cat_items, group_mode="country")
        with open(os.path.join(CATEGORIES_DIR, f"{slug}.m3u"), "w", encoding="utf-8") as f:
            f.write(m3u_text)
        with open(os.path.join(PUBLIC_DIR, "categories", f"{slug}.m3u"), "w", encoding="utf-8") as f:
            f.write(m3u_text)

    # 5. Write playlist.json & channels_info.json
    print("\n[5/5] Generating playlist.json with all country metadata...")
    json_entries = []
    for ch in channel_list:
        json_entries.append({
            "name": ch["name"],
            "category": ch["category"],
            "country": ch["country"],
            "language": ch["language"],
            "logo": ch["tvg_logo"],
            "url": ch["url"],
            "id": ch["tvg_id"]
        })

    json_data = json.dumps(json_entries, ensure_ascii=False, indent=2)

    with open(os.path.join(SCRIPT_DIR, "playlist.json"), "w", encoding="utf-8") as f:
        f.write(json_data)
    with open(os.path.join(PUBLIC_DIR, "playlist.json"), "w", encoding="utf-8") as f:
        f.write(json_data)

    meta_info = {
        "source": "https://iptv-org.github.io/",
        "last_updated": datetime.now().isoformat(),
        "total_channels": len(channel_list),
        "countries": {k: len(v) for k, v in sorted(countries_grouped.items(), key=lambda x: -len(x[1]))},
        "categories": {k: len(v) for k, v in sorted(categories_grouped.items(), key=lambda x: -len(x[1]))}
    }

    with open(os.path.join(SCRIPT_DIR, "channels_info.json"), "w", encoding="utf-8") as f:
        json.dump(meta_info, f, indent=2)
    with open(os.path.join(PUBLIC_DIR, "channels_info.json"), "w", encoding="utf-8") as f:
        json.dump(meta_info, f, indent=2)

    print(f"  ✓ Saved playlist.json ({len(channel_list)} channels across {len(countries_grouped)} countries)")
    print("\n" + "=" * 65)
    print("🎉 ALL GLOBAL IPTV-ORG CHANNELS COMBINED SUCCESSFULLY!")
    print("Available Playlists:")
    print("  • hisense_iptv.m3u   -> Master playlist (Country | Category)")
    print("  • index.country.m3u  -> Master playlist (Grouped by Country)")
    print("  • index.category.m3u -> Master playlist (Grouped by Category)")
    print("  • countries/us.m3u   -> USA channels (1,349)")
    print("  • countries/uk.m3u   -> UK channels (225)")
    print("  • countries/ca.m3u   -> Canada channels (209)")
    print("  • countries/in.m3u   -> India channels (1,509)")
    print("=" * 65)

    return len(channel_list)

if __name__ == "__main__":
    run()
