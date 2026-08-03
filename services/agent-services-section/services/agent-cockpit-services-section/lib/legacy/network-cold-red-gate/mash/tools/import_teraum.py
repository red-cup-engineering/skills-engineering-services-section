#!/usr/bin/env python3
"""Parse teraum/*.md under triage/ and emit per-region Rust data tables
into crates/mash-scene-mud-teraum/src/regions/. One-off script; output
is committed.
"""
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

import yaml

SRC = Path(
    "/home/emsenn/561/operations/engineering/triage/content/relationality/"
    "triage/relational-hyperverse/domains/src/domains/toys/domains/teraum"
)
DST = Path("/home/emsenn/561/mash/crates/mash-scene-mud-teraum/src/regions")

# (region_slug, path_from_teraum_excluding_domains). Deeper paths FIRST
# so the prefix match picks the most specific region.
#
# A "region slug" here identifies the Rust module each generated file
# lands in (`regions/<slug>.rs`) and the short tag used in generated
# subject ids. Every room whose path prefix matches a row lands in
# that region's file. Every non-leaf directory in the Racket source
# becomes its own area subject (`area:<leaf-slug>`); the REGIONS list
# only controls which Rust *file* owns the rows, not the area
# hierarchy itself (see `REGION_HIERARCHY` below).
REGIONS = [
    ("honeyfern-labs", "eastlands/green-delta/game/south-arathel/honeyfern-labs"),
    ("gnalens",        "westlands/halfling-country/gnalens"),
    ("ack",            "eastlands/green-delta/game/ack"),
    ("bellybrush",     "eastlands/green-delta/game/bellybrush"),
    ("south-arathel",  "eastlands/green-delta/game/south-arathel"),
    ("arathel-county", "eastlands/green-delta/arathel-county"),
    ("pled-county",    "eastlands/green-delta/pled-county"),
    ("marby-county",   "eastlands/green-delta/marby-county"),
    ("sherwyn-county", "eastlands/green-delta/sherwyn-county"),
    ("jacobs-folly",   "eastlands/gloaming/jacobs-folly"),
    ("belcaer",        "eastlands/gloaming/belcaer"),
    ("central-plains", "eastlands/central-plains"),
    ("farsteppes",     "eastlands/farsteppes"),
    ("cut",            "eastlands/cut"),
    ("oru-valley",     "westlands/oru-valley"),
    # Meta-containers — match last so their sub-regions win first.
    ("gloaming",       "eastlands/gloaming"),
    ("game",           "eastlands/green-delta/game"),
]

# The full Teraum region hierarchy, rediscovered from every
# `_index.md` in the Racket source. The first entry in each row is
# the region's leaf slug (turned into subject `region:<slug>`); the
# second is the parent slug or `""` for a top-level root; the third
# is the rendered `has-name`.
#
# Terminology note: these are **regions** (`<>region` in the old
# qtops engine) — named groupings with no geography of their own.
# Individual places are **areas** (`<>area`), which carry exits,
# contents, and descriptions; scene areas all locate-at one of the
# regions below and are emitted as `area:*` subjects.
REGION_HIERARCHY = [
    # (slug, parent-slug, name)
    ("eastlands",       "",                   "Eastlands"),
    ("westlands",       "",                   "Westlands"),
    ("central-plains",  "eastlands",          "Central Plains"),
    ("cut",             "eastlands",          "Cut"),
    ("farsteppes",      "eastlands",          "Farsteppes"),
    ("gloaming",        "eastlands",          "Gloaming"),
    ("belcaer",         "gloaming",           "Belcaer"),
    ("jacobs-folly",    "gloaming",           "Jacob's Folly"),
    ("green-delta",     "eastlands",          "Green Delta"),
    ("arathel-county",  "green-delta",        "Arathel County"),
    ("game",            "green-delta",        "Game"),
    ("ack",             "game",               "Ack"),
    ("brass-ward",      "ack",                "Brass Ward"),
    ("dock-ward",       "ack",                "Dock Ward"),
    ("bellybrush",      "game",               "Bellybrush"),
    ("south-arathel",   "game",               "South Arathel"),
    ("honeyfern-labs",  "south-arathel",      "Honeyfern Labs"),
    ("marby-county",    "green-delta",        "Marby County"),
    ("pled-county",     "green-delta",        "Pled County"),
    ("sherwyn-county",  "green-delta",        "Sherwyn County"),
    ("halfling-country","westlands",          "Halfling Country"),
    ("gnalens",         "halfling-country",   "Gnalens"),
    ("oru-valley",      "westlands",          "Oru Valley"),
]
REGION_SLUGS = {slug for (slug, _, _) in REGION_HIERARCHY}

# Regions that are ALSO areas in their own right — the Racket
# source composes `(<>region (<>area t …))` on these: you can
# stand in "Ack" (the city center) or "Brass Ward" (the district
# as-a-whole) as well as visiting the streets underneath. For each,
# we emit a sibling `area:<slug>` subject located-at its own
# `region:<slug>`. Exits/contents on these composite areas aren't
# ported — the old Racket source didn't wire any, it just named
# them — but their existence lets references to the area (e.g.
# "Ack" as a place) resolve to a real subject.
COMPOSITE_AREAS = [
    # slug (same subject for both area and region, differing only
    # in the `area:` vs `region:` prefix).
    "ack",
    "brass-ward",
    "dock-ward",
]


# Cultures. Keys mirror the Racket quality files in
# teraum-mud/domains/qualities/; parents mirror each file's
# `require` chain (mostly flat -> teraumi, with Belkite going
# through Gloamer). These become `culture:<slug>` subjects in
# MASH, chained via `specializes-as` so `has-culture culture:ackian`
# automatically lifts into `has-culture culture:teraumi` at cascade.
CULTURE_HIERARCHY = [
    # (slug, parent-slug or "", pretty-name)
    ("teraumi",    "",         "Teraumi"),
    ("ackian",     "teraumi",  "Ackian"),
    ("arathellan", "teraumi",  "Arathellan"),
    ("brusher",    "teraumi",  "Brusher"),
    ("cutter",     "teraumi",  "Cutter"),
    ("deltan",     "teraumi",  "Deltan"),
    ("gamer",      "teraumi",  "Gamer"),
    ("gloamer",    "teraumi",  "Gloamer"),
    ("belkite",    "gloamer",  "Belkite"),
    ("gnalinne",   "teraumi",  "Gnalinne"),
    ("sherwyn",    "teraumi",  "Sherwyn"),
    ("stepper",    "teraumi",  "Stepper"),
]

# Region-slug (directory name just before `/area` in a .md's
# `base:` field) → culture slug. Regions without an explicit
# culture file in the Racket source don't appear here; areas
# basing on them emit no has-culture claim (the cascade still
# picks up ancestor cultures via the area's region chain if we
# layer that on top later).
BASE_REGION_TO_CULTURE = {
    "ack":             "ackian",
    "arathel-county":  "arathellan",
    "belcaer":         "belkite",
    "bellybrush":      "brusher",
    "cut":             "cutter",
    "farsteppes":      "stepper",
    "game":            "gamer",
    "gloaming":        "gloamer",
    "gnalens":         "gnalinne",
    "green-delta":     "deltan",
    "sherwyn-county":  "sherwyn",
    # Teraum-wide culture: anything basing on the root path.
    "teraum":          "teraumi",
}


def culture_subject(slug):
    return f"culture:{slug}"


def region_subject(slug):
    return f"region:{slug}"


def culture_for_base(base_path):
    """Map a .md front-matter `base:` value like
    `"teraum/eastlands/green-delta/game/ack/area"` to a culture
    subject, if we know a culture for the directory immediately
    before `/area`. Returns `None` otherwise."""
    if not isinstance(base_path, str):
        return None
    segs = strip_domains(base_path.split("/"))
    # base paths look like `teraum/.../<region>/area`; we want the
    # <region> segment, which is the second-to-last.
    if len(segs) < 2 or segs[-1] != "area":
        return None
    region = segs[-2]
    slug = BASE_REGION_TO_CULTURE.get(region)
    return culture_subject(slug) if slug else None


def classify_region(path_segs):
    """Given a sequence of path segments (like
    `['eastlands','green-delta','game','ack','dock-ward','harbour']`),
    return the subject of the most-specific *region* that contains
    it — the longest prefix whose final slug is in `REGION_SLUGS`.
    Returns `None` if no segment is a region."""
    for i in range(len(path_segs), 0, -1):
        if path_segs[i - 1] in REGION_SLUGS:
            return region_subject(path_segs[i - 1])
    return None


def strip_domains(segs):
    return [s for s in segs if s != "domains"]


def classify(segs):
    """Return (region_slug, remaining_segs) or None for an unknown path."""
    for region, rpath in REGIONS:
        rsegs = rpath.split("/")
        if segs[: len(rsegs)] == rsegs:
            return region, segs[len(rsegs):]
    return None


def slugify_name(name):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", name.lower()).strip("-")
    return s or "x"


def room_id_for_path(path_str):
    """Map `teraum/a/b/c` (as stored in exits: targets) to a room ID."""
    segs = path_str.split("/")
    if segs[0] != "teraum":
        return None
    segs = strip_domains(segs[1:])
    if not segs:
        return None
    c = classify(segs)
    if not c:
        return None
    region, rest = c
    if not rest:
        return None
    slug = "-".join(rest)
    return f"area:{region}-{slug}"


def load_frontmatter(path):
    txt = path.read_text(encoding="utf-8")
    m = re.match(r"---\s*\n(.*?)\n---\s*\n", txt, re.DOTALL)
    if not m:
        return None
    try:
        return yaml.safe_load(m.group(1))
    except yaml.YAMLError as e:
        print(f"yaml error in {path}: {e}", file=sys.stderr)
        return None


def rust_str(s):
    """Render a Python string as a Rust string literal."""
    if s is None:
        return '""'
    s = str(s)
    s = s.replace("\\", "\\\\").replace("\"", "\\\"")
    # Control chars: keep newlines as \n, tabs as \t.
    s = s.replace("\n", "\\n").replace("\t", "\\t").replace("\r", "")
    return f'"{s}"'


# Explicit redirects for exit targets that point at a domain path whose
# canonical room isn't the domain name itself. Preferred over alphabetic
# auto-resolution so the generator is predictable.
DOMAIN_REDIRECTS = {
    "area:ack-brass-ward": "area:ack-brass-ward-kingsroad",
    "area:ack-dock-ward":  "area:ack-dock-ward-main",
}


def gather():
    rooms = defaultdict(list)      # region -> [(room_id, name, desc, region_subject, culture_subject_or_empty)]
    exits = defaultdict(list)      # region -> [(from, exit_id, direction, has_dir, to)]
    trivia = defaultdict(list)     # region -> [(room_id, text)]
    lookables = defaultdict(list)  # region -> [(lookable_id, parent, keyword, desc)]
    noises = defaultdict(list)     # region -> [(noise_id, parent, weight, text)]
    npcs = defaultdict(list)       # region -> [(npc_id, room_id, name, desc, region_lock_subject, animations)]

    for path in sorted(SRC.rglob("*.md")):
        if path.name == "_index.md":
            continue
        rel = path.relative_to(SRC)
        segs = strip_domains(list(rel.parts))
        # Drop the .md suffix from the last segment
        segs[-1] = segs[-1][:-3]
        c = classify(segs)
        if not c:
            print(f"skip (no region): {rel}", file=sys.stderr)
            continue
        region, rest = c
        if not rest:
            continue
        room_slug = "-".join(rest)
        room_id = f"area:{region}-{room_slug}"

        fm = load_frontmatter(path)
        if not fm or not isinstance(fm, dict):
            continue

        # Only treat entries that locate an area as rooms.
        if fm.get("locates") != "area":
            continue

        name = fm.get("name") or room_slug.replace("-", " ").title()
        description = fm.get("description") or ""
        # Room's direct containing area = the deepest REGION_SLUGS
        # segment in its original path (walking the full
        # `strip_domains(rel.parts)` sequence, not the
        # REGIONS-derived slug). Falls back to the region slug.
        direct_area = classify_region(segs) or region_subject(region)

        # Culture derives from `base:` (list or string): the first
        # entry whose path ends in `/area` and names a region we
        # have a culture for. Missing → empty string, meaning
        # "emit no has-culture claim for this area."
        fm_base = fm.get("base") or []
        if isinstance(fm_base, str):
            fm_base = [fm_base]
        culture = ""
        for b in fm_base:
            subj = culture_for_base(b)
            if subj:
                culture = subj
                break

        rooms[region].append((room_id, name, description, direct_area, culture))

        # Exits
        fm_exits = fm.get("exits") or {}
        if isinstance(fm_exits, dict):
            for i, (direction, target) in enumerate(fm_exits.items()):
                if not target:
                    continue
                to = room_id_for_path(target)
                if not to:
                    # External/unresolvable; skip silently
                    continue
                exit_id = f"exit:{region}-{room_slug}-{direction}"
                has_dir = f"has-{direction}-exit"
                exits[region].append((room_id, exit_id, direction, has_dir, to))

        # Trivia
        for t in fm.get("trivia") or []:
            if isinstance(t, str):
                trivia[region].append((room_id, t))

        # Lookables
        for i, look in enumerate(fm.get("lookables") or []):
            if isinstance(look, dict) and "name" in look:
                keyword = look["name"]
                desc = look.get("description", "")
                kslug = slugify_name(keyword)
                lid = f"lookable:{region}-{room_slug}-{kslug}"
                lookables[region].append((lid, room_id, keyword, desc))

        # Noises
        for i, n in enumerate(fm.get("noises") or []):
            if isinstance(n, list) and len(n) == 2:
                weight, text = n
                nid = f"noise:{region}-{room_slug}-{i}"
                noises[region].append((nid, room_id, str(weight), text))

        # Contents (NPCs and similar)
        for i, c in enumerate(fm.get("contents") or []):
            if not isinstance(c, dict):
                continue
            cname = c.get("name", f"entity-{i}")
            cslug = slugify_name(cname)
            kind = c.get("base", "")
            # Use npc: prefix for everything that lists as NPC-ish
            npc_id = f"npc:{region}-{room_slug}-{cslug}"
            cdesc = c.get("description", "")
            rlock = c.get("region-lock", "")
            if isinstance(rlock, str) and rlock.startswith("teraum/"):
                # Resolve the path to the deepest area-subject it
                # passes through. If that succeeds, use it; if not
                # (e.g. path points at a specific room), fall back
                # to the old region-slug joining for safety.
                rsegs = strip_domains(rlock.split("/")[1:])
                resolved_area = classify_region(rsegs)
                if resolved_area is not None:
                    rlock = resolved_area
                else:
                    cc = classify(rsegs)
                    if cc:
                        base = cc[0]
                        rlock = region_subject(base)
            anims = c.get("animations") or []
            if isinstance(anims, list):
                anims = [a for a in anims if isinstance(a, str)]
            else:
                anims = []
            npcs[region].append((npc_id, room_id, cname, cdesc, rlock, anims))
            # NPC-attached noises
            for j, n in enumerate(c.get("noises") or []):
                if isinstance(n, list) and len(n) == 2:
                    nid = f"noise:{region}-{room_slug}-{cslug}-{j}"
                    noises[region].append((nid, npc_id, str(n[0]), n[1]))

    # Resolve broken exit targets: if a destination isn't a known room,
    # try the redirect table, then prefix-match against known rooms.
    known = set()
    for region_rooms in rooms.values():
        for r in region_rooms:
            known.add(r[0])  # r = (id, name, desc, area)

    dropped = 0
    for region, edges in exits.items():
        fixed = []
        for (fr, exit_id, direction, has_dir, to) in edges:
            if to in known:
                fixed.append((fr, exit_id, direction, has_dir, to))
                continue
            if to in DOMAIN_REDIRECTS and DOMAIN_REDIRECTS[to] in known:
                to = DOMAIN_REDIRECTS[to]
                fixed.append((fr, exit_id, direction, has_dir, to))
                continue
            # Prefix-match: pick the alphabetically first known sub-room.
            candidates = sorted(k for k in known if k.startswith(to + "-"))
            if candidates:
                fixed.append((fr, exit_id, direction, has_dir, candidates[0]))
                continue
            print(
                f"drop exit {exit_id}: {fr} -> {to} (no resolution)",
                file=sys.stderr,
            )
            dropped += 1
        exits[region] = fixed
    if dropped:
        print(f"dropped {dropped} unresolved exits", file=sys.stderr)

    return rooms, exits, trivia, lookables, noises, npcs


HEADER = """//! {region_title} — generated from old relational-hyperverse data
//! by tools/import_teraum.py. Edit the generator, not this file.

use crate::tables::*;
"""


def emit_region(region, rooms, exits, trivia, lookables, noises, npcs):
    lines = [HEADER.format(region_title=region.replace("-", " ").title())]

    def const_arr(name, typ, rows, fmt):
        if not rows:
            lines.append(f"pub(crate) const {name}: &[{typ}] = &[];\n")
            return
        lines.append(f"pub(crate) const {name}: &[{typ}] = &[")
        for row in rows:
            lines.append(f"    {fmt(row)},")
        lines.append("];\n")

    const_arr(
        "AREAS", "Area",
        rooms,
        lambda r: (
            f"({rust_str(r[0])}, {rust_str(r[1])}, {rust_str(r[2])}, "
            f"{rust_str(r[3])}, {rust_str(r[4])})"
        ),
    )
    const_arr(
        "EXITS", "Exit",
        exits,
        lambda e: (
            f"({rust_str(e[0])}, {rust_str(e[1])}, {rust_str(e[2])}, "
            f"{rust_str(e[3])}, {rust_str(e[4])})"
        ),
    )
    const_arr(
        "TRIVIA", "Trivia",
        trivia,
        lambda t: f"({rust_str(t[0])}, {rust_str(t[1])})",
    )
    const_arr(
        "LOOKABLES", "Lookable",
        lookables,
        lambda l: (
            f"({rust_str(l[0])}, {rust_str(l[1])}, {rust_str(l[2])}, "
            f"{rust_str(l[3])})"
        ),
    )
    const_arr(
        "NOISES", "Noise",
        noises,
        lambda n: (
            f"({rust_str(n[0])}, {rust_str(n[1])}, {rust_str(n[2])}, "
            f"{rust_str(n[3])})"
        ),
    )

    # NPCs need a nested slice for animations.
    if not npcs:
        lines.append("pub(crate) const NPCS: &[Npc] = &[];\n")
    else:
        lines.append("pub(crate) const NPCS: &[Npc] = &[")
        for (npc_id, room, name, desc, rlock, anims) in npcs:
            anims_arr = "&[" + ", ".join(rust_str(a) for a in anims) + "]"
            lines.append(
                f"    ({rust_str(npc_id)}, {rust_str(room)}, "
                f"{rust_str(name)}, {rust_str(desc)}, "
                f"{rust_str(rlock)}, {anims_arr}),"
            )
        lines.append("];\n")

    return "\n".join(lines)


def module_name(region):
    return region.replace("-", "_")


def composite_areas_rows():
    """Build the rows for areas that ALSO exist as regions
    (Ack, Brass Ward, Dock Ward). Each row matches the `Area`
    tuple shape: `(area-subject, name, description, region-subject,
    culture-subject)`. Name + culture come from the same slug's
    row in REGION_HIERARCHY + BASE_REGION_TO_CULTURE — so the
    city-of-Ack area is culturally Ackian, Brass Ward is Ackian,
    Dock Ward is Ackian, etc. Description is the region's name
    prefixed with "This is " as a default."""
    by_slug = {slug: (parent, name) for (slug, parent, name) in REGION_HIERARCHY}
    rows = []
    for slug in COMPOSITE_AREAS:
        if slug not in by_slug:
            continue
        _parent, name = by_slug[slug]
        # Walk up until we hit a region whose slug has a culture.
        culture_slug = BASE_REGION_TO_CULTURE.get(slug)
        if not culture_slug:
            cursor = slug
            while cursor in by_slug:
                parent, _ = by_slug[cursor]
                if not parent:
                    break
                if parent in BASE_REGION_TO_CULTURE:
                    culture_slug = BASE_REGION_TO_CULTURE[parent]
                    break
                cursor = parent
        culture = culture_subject(culture_slug) if culture_slug else ""
        rows.append((
            f"area:{slug}",
            name,
            f"This is {name}, the district-as-a-whole.",
            region_subject(slug),
            culture,
        ))
    return rows


def emit_regions_file():
    """Write `regions/_regions.rs` with the full REGION_HIERARCHY as
    const rows the scene's lib.rs iterates at boot. Subject ids
    are the canonical `region:<slug>` form (Racket `<>region`)."""
    lines = [
        "//! All Teraum regions. Generated from REGION_HIERARCHY in tools/import_teraum.py.",
        "//!",
        "//! Each row is `(subject, parent-region-or-empty, name, description)`.",
        "//! Regions are named containers (`<>region` in the Racket qtops",
        "//! engine); individual places (areas) located-at one of these",
        "//! regions, and regions chain upward via `located-at`.",
        "",
        "use crate::tables::*;",
        "",
        "pub(crate) const REGIONS_LIST: &[Region] = &[",
    ]
    for slug, parent, name in REGION_HIERARCHY:
        parent_subj = region_subject(parent) if parent else ""
        desc = ""  # Regions don't yet carry descriptions in .md front-matter at this level.
        lines.append(
            f"    ({rust_str(region_subject(slug))}, "
            f"{rust_str(parent_subj)}, "
            f"{rust_str(name)}, "
            f"{rust_str(desc)}),"
        )
    lines.append("];")
    lines.append("")
    (DST / "_regions.rs").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {DST/'_regions.rs'} ({len(REGION_HIERARCHY)} regions)")


def emit_cultures_file():
    """Write `regions/_cultures.rs` with the full CULTURE_HIERARCHY
    as const rows. Emitted as a generated file so regenerating the
    scene from markdown + the hierarchy table is a single-step
    operation."""
    lines = [
        "//! All Teraum cultures. Generated from CULTURE_HIERARCHY in tools/import_teraum.py.",
        "//!",
        "//! Each row is `(subject, parent-culture-or-empty, name)`.",
        "//! Cultures chain via `specializes-as` so a child culture",
        "//! (e.g. `culture:ackian`) lifts claims into its parent",
        "//! (`culture:teraumi`) at cascade time.",
        "",
        "use crate::tables::*;",
        "",
        "pub(crate) const CULTURES: &[Culture] = &[",
    ]
    for slug, parent, name in CULTURE_HIERARCHY:
        parent_subj = culture_subject(parent) if parent else ""
        lines.append(
            f"    ({rust_str(culture_subject(slug))}, "
            f"{rust_str(parent_subj)}, "
            f"{rust_str(name)}),"
        )
    lines.append("];")
    lines.append("")
    (DST / "_cultures.rs").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {DST/'_cultures.rs'} ({len(CULTURE_HIERARCHY)} cultures)")


def emit_composite_areas_file():
    """Write `regions/_composite_areas.rs`: the extra `Area` rows
    for subjects that are both areas and regions in the Racket
    source (Ack the city as a place + Ack the region-container,
    same for Brass Ward and Dock Ward)."""
    rows = composite_areas_rows()
    lines = [
        "//! Composite area rows: subjects that are both a place (Racket `<>area`)",
        "//! AND a region (`<>region`), like Ack itself or the Brass Ward as a",
        "//! district-as-a-whole. Generated from COMPOSITE_AREAS in",
        "//! tools/import_teraum.py; each row shares its slug with a",
        "//! corresponding `region:<slug>` defined in `_regions.rs`.",
        "",
        "use crate::tables::*;",
        "",
        "pub(crate) const COMPOSITE_AREAS: &[Area] = &[",
    ]
    for (subj, name, desc, parent_region, culture) in rows:
        lines.append(
            f"    ({rust_str(subj)}, {rust_str(name)}, "
            f"{rust_str(desc)}, {rust_str(parent_region)}, "
            f"{rust_str(culture)}),"
        )
    lines.append("];")
    lines.append("")
    (DST / "_composite_areas.rs").write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {DST/'_composite_areas.rs'} ({len(rows)} composite areas)")


def main():
    rooms, exits, trivia, lookables, noises, npcs = gather()

    DST.mkdir(parents=True, exist_ok=True)
    emit_regions_file()
    emit_cultures_file()
    emit_composite_areas_file()

    all_regions = sorted(set(rooms.keys()))
    for region in all_regions:
        content = emit_region(
            region,
            rooms.get(region, []),
            exits.get(region, []),
            trivia.get(region, []),
            lookables.get(region, []),
            noises.get(region, []),
            npcs.get(region, []),
        )
        out = DST / f"{module_name(region)}.rs"
        out.write_text(content, encoding="utf-8")
        print(
            f"{region}: {len(rooms.get(region, []))} rooms, "
            f"{len(exits.get(region, []))} exits, "
            f"{len(trivia.get(region, []))} trivia, "
            f"{len(lookables.get(region, []))} lookables, "
            f"{len(noises.get(region, []))} noises, "
            f"{len(npcs.get(region, []))} npcs "
            f"→ {out.name}"
        )

    # Emit a mod.rs that declares all region modules.
    mod_lines = ["//! Per-region data tables. Generated.", ""]
    mod_lines.append("#[path = \"_regions.rs\"]")
    mod_lines.append("pub(crate) mod hierarchy;")
    mod_lines.append("#[path = \"_cultures.rs\"]")
    mod_lines.append("pub(crate) mod cultures_mod;")
    mod_lines.append("#[path = \"_composite_areas.rs\"]")
    mod_lines.append("pub(crate) mod composite;")
    mod_lines.append("")
    for region in all_regions:
        mod_lines.append(f"pub(crate) mod {module_name(region)};")
    mod_lines.append("")
    mod_lines.append("/// `(region-slug, rooms, exits, trivia, lookables, noises, npcs)`")
    mod_lines.append("pub(crate) const REGIONS: &[RegionTables] = &[")
    for region in all_regions:
        m = module_name(region)
        mod_lines.append(
            f"    ({rust_str(region)}, {m}::AREAS, {m}::EXITS, "
            f"{m}::TRIVIA, {m}::LOOKABLES, {m}::NOISES, {m}::NPCS),"
        )
    mod_lines.append("];")
    mod_lines.append("")
    mod_lines.append(
        "pub(crate) type RegionTables = ("
        "&'static str, &'static [crate::tables::Area], "
        "&'static [crate::tables::Exit], &'static [crate::tables::Trivia], "
        "&'static [crate::tables::Lookable], &'static [crate::tables::Noise], "
        "&'static [crate::tables::Npc]);"
    )
    (DST / "mod.rs").write_text("\n".join(mod_lines) + "\n", encoding="utf-8")
    print(f"wrote {DST/'mod.rs'}")

    # Summary
    total_rooms = sum(len(v) for v in rooms.values())
    print(f"\nTotal: {total_rooms} rooms across {len(all_regions)} regions")


if __name__ == "__main__":
    main()
