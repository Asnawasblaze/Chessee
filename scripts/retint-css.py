"""One-off sweep: maps the old cyan/navy palette in chapter stylesheets to the
global theme tokens. Cyan-ish colours become the accent, near-black navy becomes
the dark surface, pale tinted whites become the bright surface or ink."""
import re, sys, glob

def lum(r, g, b):
    return 0.299 * r + 0.587 * g + 0.114 * b

def classify(r, g, b):
    """Return token name for a colour, or None to leave untouched."""
    mx, mn = max(r, g, b), min(r, g, b)
    if mx <= 45:
        return "bg-dark"
    if mx <= 90 and b >= r:
        return "bg-dark-2"
    # pure greys / whites stay as-is (shadows, highlights)
    if mx - mn < 8:
        return None
    # cool tint: blue or green dominant over red
    cool = b > r + 6 and g > r
    if not cool:
        return None
    if lum(r, g, b) > 205:
        return "ink-on-dark"
    if lum(r, g, b) < 95:
        return "bg-dark-2"
    return "accent-1"

def rgba_sub(m):
    r, g, b = int(m.group(2)), int(m.group(3)), int(m.group(4))
    tok = classify(r, g, b)
    if not tok:
        return m.group(0)
    return f"rgba(var(--{tok}-rgb)"

def hex_sub(prop_ctx):
    def f(m):
        h = m.group(0)
        r, g, b = int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)
        if h.lower() == "#ffffff" or h.lower() == "#000000":
            return h
        tok = classify(r, g, b)
        if not tok:
            return h
        return f"var(--{tok})"
    return f

RGBA = re.compile(r"(rgba?)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)")
HEX = re.compile(r"#[0-9a-fA-F]{6}\b")

for path in glob.glob("src/components/*.css") + glob.glob("src/pages/*.css"):
    if path.endswith("StyleLab.css"):
        continue
    src = open(path).read()
    out = []
    for line in src.split("\n"):
        # keep rgb( triplets that are already var-based
        if "var(--" in line and "rgba(var(" in line:
            out.append(line)
            continue
        line = RGBA.sub(lambda m: rgba_sub(m) if m.group(1) == "rgba" else m.group(0), line)
        line = HEX.sub(hex_sub(None), line)
        out.append(line)
    new = "\n".join(out)
    if new != src:
        open(path, "w").write(new)
        print("retinted", path)
