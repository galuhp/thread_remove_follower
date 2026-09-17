# make_icons.py — generator ikon extension "user + trash bin".
#
# Desain (sesuai ikon pilihan user):
#   - Siluet orang gaya outline, abu-abu kebiruan (#ADBEC9)
#   - Tempat sampah salmon (#F47A7A) di kanan-bawah, dengan 2 slot transparan
#   - Background transparan
#
# Digambar di kanvas master 2048x2048 (4x dari 512) lalu di-downscale dengan
# LANCZOS ke 512 (master), 128, 48, dan 16 px supaya tepi halus di semua ukuran.
#
# Jalankan:  python make_icons.py

from PIL import Image, ImageDraw

S = 2048                 # ukuran kanvas master (4x desain 512)
K = S / 512              # faktor skala dari koordinat desain 512

GRAY = (173, 190, 201, 255)    # outline orang
SALMON = (244, 122, 122, 255)  # tempat sampah
CLEAR = (0, 0, 0, 0)           # transparan (untuk slot tempat sampah)

STROKE = int(38 * K)           # ketebalan garis orang

def sc(*vals):
    """Skala koordinat desain 512 -> kanvas master."""
    return [v * K for v in vals]

def draw_icon():
    img = Image.new("RGBA", (S, S), CLEAR)
    d = ImageDraw.Draw(img)

    # ---- Orang (outline) ----------------------------------------------------
    # Kepala: lingkaran outline
    hx, hy, hr = sc(250, 170, 112)
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], outline=GRAY, width=STROKE)

    # Bahu: busur atas elips lebar (dari jam 9 ke jam 3 lewat jam 12)
    bx0, by0, bx1, by1 = sc(48, 255, 456, 655)
    d.arc([bx0, by0, bx1, by1], start=180, end=360, fill=GRAY, width=STROKE)

    # Sisi kiri & kanan turun dari ujung busur (ujung membulat)
    ey = by0 + (by1 - by0) / 2  # y ujung busur (tengah elips)
    for x in (bx0, bx1):
        d.line([x, ey, x, ey + 100 * K], fill=GRAY, width=STROKE)
        d.ellipse([x - STROKE / 2, ey + 100 * K - STROKE / 2,
                   x + STROKE / 2, ey + 100 * K + STROKE / 2], fill=GRAY)
        d.ellipse([x - STROKE / 2, ey - STROKE / 2,
                   x + STROKE / 2, ey + STROKE / 2], fill=GRAY)

    # ---- Tempat sampah (kanan-bawah, fill) ----------------------------------
    # Badan
    d.rounded_rectangle(sc(350, 372, 490, 512), radius=28 * K, fill=SALMON)
    # Tutup
    d.rounded_rectangle(sc(333, 322, 507, 358), radius=18 * K, fill=SALMON)
    # Pegangan tutup (outline)
    d.rounded_rectangle(sc(392, 292, 448, 326), radius=14 * K,
                        outline=SALMON, width=int(16 * K))
    # Dua slot transparan (lubang)
    for x0, x1 in ((378, 412), (428, 462)):
        d.rounded_rectangle(sc(x0, 402, x1, 472), radius=12 * K, fill=CLEAR)

    return img

def main():
    master = draw_icon()
    targets = {
        "icons/icon512.png": 512,   # master HD (opsional, tidak direferensikan manifest)
        "icons/icon128.png": 128,
        "icons/icon48.png": 48,
        "icons/icon16.png": 16,
    }
    for path, size in targets.items():
        master.resize((size, size), Image.LANCZOS).save(path, "PNG")
        print("written", path, f"{size}x{size}")

if __name__ == "__main__":
    main()