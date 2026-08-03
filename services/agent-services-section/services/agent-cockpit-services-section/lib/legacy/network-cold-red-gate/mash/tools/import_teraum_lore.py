#!/usr/bin/env python3
"""Parse The Canonical Brave Old World → timeline / extras / beastiary
data tables in the mash-scene-mud-teraum crate.
"""
import re
from pathlib import Path

SRC = Path(
    "/home/emsenn/561/operations/engineering/triage/content/buckets/"
    "unsorted/text-to-process-someday/old-notes/"
    "The Canonical Brave Old World.md"
)
DST = Path("/home/emsenn/561/mash/crates/mash-scene-mud-teraum/src")


def rust_str(s):
    if s is None:
        return '""'
    s = str(s)
    s = s.replace("\\", "\\\\").replace("\"", "\\\"")
    s = s.replace("\n", "\\n").replace("\t", "\\t").replace("\r", "")
    return f'"{s}"'


def slugify(s):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return s or "x"


# ---------- Timeline ----------

YEAR_RE = re.compile(r"^### ([0-9,]+)(bc|bB|pc|aB)\s*$")
DAY_RE = re.compile(r"^#### (.+?)\s*$")
ENTRY_RE = re.compile(r"^\s*(?:---\s*)?\*\*\*([^.]+)\.\*\*\*\s*(.+)$")

MONTH_NAMES = {
    "Deepwinter", "Winter", "Sunsets", "Storms", "Melting", "Flowers",
    "Summertide", "Highsun", "Fading", "Leaffall", "Rotting", "Drawing",
    "Midwinter", "Greengrass", "Midsummer", "Highharvesttide",
    "Feast of the Moon", "Blooming",
}


def parse_day_heading(line):
    """Return (day-number-str-or-empty, month-str-or-empty) from a
    `Nth of Month` or bare `Month` or bare `Nth` heading."""
    m = re.match(r"^(\d+)(?:st|nd|rd|th)?\s*(?:of\s+(.+))?$", line.strip())
    if m:
        return m.group(1), (m.group(2) or "")
    if line.strip() in MONTH_NAMES:
        return "", line.strip()
    return "", ""


def parse_timeline(lines, start, end):
    """Yield (event_id, topic, text, year_str, era_marker, day, month, date_text)."""
    i = start
    cur_year = None
    cur_era = None
    cur_day = ""
    cur_month = ""
    event_seq = 0

    while i < end:
        line = lines[i].rstrip()

        m = YEAR_RE.match(line)
        if m:
            cur_year = m.group(1).replace(",", "")
            cur_era = m.group(2)
            cur_day = ""
            cur_month = ""
            i += 1
            continue

        m = DAY_RE.match(line)
        if m:
            cur_day, cur_month = parse_day_heading(m.group(1))
            i += 1
            continue

        # Entries like `---` reset the date within a year.
        if line.strip() == "---":
            cur_day = ""
            cur_month = ""
            i += 1
            continue

        m = ENTRY_RE.match(line)
        if m and cur_year is not None:
            topic = m.group(1).strip()
            text = m.group(2).strip()

            # Negative year for before-Break eras, positive for after.
            if cur_era in ("bc", "bB"):
                year_int = -int(cur_year)
            else:
                year_int = int(cur_year)

            date_text = f"{cur_year}{cur_era}"
            if cur_month:
                date_text = (
                    f"{cur_day}{ordinal(cur_day)} of {cur_month}, {date_text}"
                    if cur_day
                    else f"{cur_month}, {date_text}"
                )

            event_seq += 1
            ev_id = f"event:{year_int:+d}-{slugify(topic)}-{event_seq}"
            yield (
                ev_id,
                topic,
                text,
                str(year_int),
                cur_era,
                cur_day,
                cur_month,
                date_text,
            )
        i += 1


def ordinal(n):
    try:
        n = int(n)
    except ValueError:
        return ""
    if 10 <= n % 100 <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


# ---------- Extras / Beastiary ----------

# Extras section headings: `### Name` at top-level (not `## Name`).
# Beastiary entries appear as `> ## Name` inside block-quoted stat
# blocks.

def parse_extras(lines, start, end):
    """Yield (slug, name, type_line, biography) for each extra. Like
    the beastiary, entries are `> ## Name` block-quoted statblocks.
    Entries may optionally be preceded by `### Name` (Barnabus) or
    followed by a `#### History` section, which becomes biography."""
    entries = []
    i = start
    while i < end:
        line = lines[i].rstrip()
        m = re.match(r"^> ## (.+?)\s*$", line)
        if m:
            name = m.group(1).strip().strip('"')
            slug = slugify(name)
            type_line = ""
            body_lines = []
            j = i + 1
            while j < end:
                nxt = lines[j].rstrip()
                if re.match(r"^> ## ", nxt):
                    break
                if re.match(r"^### ", nxt):
                    break
                if re.match(r"^## ", nxt) or re.match(r"^# ", nxt):
                    break
                m2 = re.match(r"^>\s*\*(.+?)\*\s*$", nxt)
                if m2 and not type_line:
                    type_line = m2.group(1)
                body_lines.append(nxt)
                j += 1
            bio = extract_biography(body_lines)
            entries.append((slug, name, type_line, bio))
            i = j
        else:
            i += 1
    return entries


def extract_biography(body_lines):
    """Pull the `#### History` section (or subsequent prose) as a
    condensed single-string biography."""
    hist_start = None
    for idx, l in enumerate(body_lines):
        if re.match(r"^#### History\s*$", l.strip()) or re.match(
            r"^#### History and Significance\s*$", l.strip()
        ):
            hist_start = idx
            break
    if hist_start is None:
        return ""
    out = []
    for l in body_lines[hist_start + 1:]:
        s = l.strip()
        if not s or s == "<div class='pageNumber auto'></div>" or s == "\\page":
            continue
        if re.match(r"^####\s", s):
            break
        # Strip markdown bold markers
        s = s.replace("***", "").replace("**", "").replace("*", "")
        out.append(s)
    return " ".join(out).strip()


def parse_beastiary(lines, start, end):
    """Yield (slug, name, type_line, notes) for each creature entry.
    Entries appear as `> ## Name` inside blockquoted stat blocks,
    separated by `___` lines."""
    entries = []
    i = start
    while i < end:
        line = lines[i].rstrip()
        m = re.match(r"^> ## (.+?)\s*$", line)
        if m:
            name = m.group(1).strip().strip('"')
            slug = slugify(name)
            # Next line is usually the type line in italics.
            type_line = ""
            notes = []
            j = i + 1
            while j < end:
                nxt = lines[j].rstrip()
                if re.match(r"^> ## ", nxt):
                    break
                if re.match(r"^## ", nxt) or re.match(r"^# ", nxt):
                    break
                if re.match(r"^\s*$", nxt) and type_line:
                    # allow blanks within stat block
                    pass
                m2 = re.match(r"^>\s*\*(.+?)\*\s*$", nxt)
                if m2 and not type_line:
                    type_line = m2.group(1)
                # Parenthetical notes like "(sheep/gorilla hybrid)"
                m3 = re.match(r"^>\s*\((.+)\)\s*$", nxt)
                if m3:
                    notes.append(m3.group(1))
                j += 1
            entries.append((slug, name, type_line, " ".join(notes)))
            i = j
        else:
            i += 1
    return entries


# ---------- Driver ----------

def find_section(lines, heading):
    for i, l in enumerate(lines):
        if l.rstrip() == heading:
            return i
    return -1


def main():
    text = SRC.read_text(encoding="utf-8")
    lines = text.splitlines()

    prologue = find_section(lines, "## Prologue")
    act1 = find_section(lines, "## Act 1")
    settings = find_section(lines, "# Settings")
    cast = find_section(lines, "# Cast")
    extras = find_section(lines, "## Extras")
    beastiary = find_section(lines, "## Beastiary")
    props = find_section(lines, "# Props")

    print(
        f"offsets: prologue={prologue} act1={act1} settings={settings} "
        f"cast={cast} extras={extras} beastiary={beastiary} props={props}"
    )

    # Timeline spans prologue + act1 (not settings).
    tl1 = list(parse_timeline(lines, prologue, settings))
    print(f"timeline: {len(tl1)} events")

    ex = parse_extras(lines, extras, beastiary)
    print(f"extras: {len(ex)} entries")

    bs = parse_beastiary(lines, beastiary, props)
    print(f"beastiary: {len(bs)} entries")

    # ----- Emit timeline.rs -----
    lines_out = [
        "//! Timeline entries parsed from *The Canonical Brave Old World*",
        "//! by tools/import_teraum_lore.py. Each row is one dated event.",
        "",
        "/// `(event-id, topic, text, year, era, day, month, date-text)`.",
        "pub(crate) type TimelineEntry = (",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        ");",
        "",
        "pub(crate) const TIMELINE: &[TimelineEntry] = &[",
    ]
    for row in tl1:
        lines_out.append(
            "    ("
            + ", ".join(rust_str(x) for x in row)
            + "),"
        )
    lines_out.append("];")
    (DST / "timeline.rs").write_text("\n".join(lines_out) + "\n", "utf-8")
    print(f"wrote {DST/'timeline.rs'}")

    # ----- Emit extras.rs -----
    lines_out = [
        "//! Extras: minor cast characters parsed from *The Canonical",
        "//! Brave Old World* by tools/import_teraum_lore.py.",
        "",
        "/// `(extra-id, name, type-line, biography)`.",
        "pub(crate) type ExtraEntry = (",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        ");",
        "",
        "pub(crate) const EXTRAS: &[ExtraEntry] = &[",
    ]
    for (slug, name, type_line, bio) in ex:
        lines_out.append(
            f"    ({rust_str('extra:'+slug)}, {rust_str(name)}, "
            f"{rust_str(type_line)}, {rust_str(bio)}),"
        )
    lines_out.append("];")
    (DST / "extras.rs").write_text("\n".join(lines_out) + "\n", "utf-8")
    print(f"wrote {DST/'extras.rs'}")

    # ----- Emit beastiary.rs -----
    lines_out = [
        "//! Beastiary: creature species parsed from *The Canonical",
        "//! Brave Old World* by tools/import_teraum_lore.py.",
        "",
        "/// `(species-id, name, type-line, notes)`.",
        "pub(crate) type BeastEntry = (",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        "    &'static str,",
        ");",
        "",
        "pub(crate) const BEASTIARY: &[BeastEntry] = &[",
    ]
    for (slug, name, type_line, notes) in bs:
        lines_out.append(
            f"    ({rust_str('species:'+slug)}, {rust_str(name)}, "
            f"{rust_str(type_line)}, {rust_str(notes)}),"
        )
    lines_out.append("];")
    (DST / "beastiary.rs").write_text("\n".join(lines_out) + "\n", "utf-8")
    print(f"wrote {DST/'beastiary.rs'}")


if __name__ == "__main__":
    main()
