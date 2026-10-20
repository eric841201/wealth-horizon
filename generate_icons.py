import os
import zlib
import struct
import math

def create_png(width, height, draw_func):
    # PNG signature
    png = bytearray(b'\x89PNG\r\n\x1a\n')
    
    # IHDR chunk
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    png.extend(struct.pack('>I', 13))
    png.extend(b'IHDR')
    png.extend(ihdr)
    png.extend(struct.pack('>I', zlib.crc32(b'IHDR' + ihdr)))
    
    # Raw pixel data (RGBA)
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        for x in range(width):
            r, g, b, a = draw_func(x, y, width, height)
            raw.extend((r, g, b, a))
            
    # IDAT chunk
    compressed = zlib.compress(bytes(raw), 9)
    png.extend(struct.pack('>I', len(compressed)))
    png.extend(b'IDAT')
    png.extend(compressed)
    png.extend(struct.pack('>I', zlib.crc32(b'IDAT' + compressed)))
    
    # IEND chunk
    png.extend(struct.pack('>I', 0))
    png.extend(b'IEND')
    png.extend(struct.pack('>I', zlib.crc32(b'IEND')))
    
    return bytes(png)

def draw_icon(x, y, w, h):
    # Normalized coords from center [-1, 1]
    nx = (x - w / 2) / (w / 2)
    ny = (y - h / 2) / (h / 2)
    dist = math.sqrt(nx * nx + ny * ny)
    
    # Rounded rect background
    # Smooth corner radius = 0.25
    r_corner = 0.28
    qx = abs(nx) - (1.0 - r_corner)
    qy = abs(ny) - (1.0 - r_corner)
    if qx > 0 and qy > 0:
        d_corner = math.sqrt(qx * qx + qy * qy)
        if d_corner > r_corner:
            return (0, 0, 0, 0) # Transparent outside
    elif abs(nx) > 1.0 or abs(ny) > 1.0:
        return (0, 0, 0, 0)
        
    # Deep Cyber Dark gradient background
    bg_factor = (ny + 1) / 2
    bg_r = int(10 + bg_factor * 12)
    bg_g = int(14 + bg_factor * 16)
    bg_b = int(23 + bg_factor * 25)
    
    # Inner border glow
    if (qx > 0 and qy > 0 and math.sqrt(qx*qx + qy*qy) > r_corner - 0.04) or (abs(nx) > 0.94 or abs(ny) > 0.94):
        return (245, 158, 11, 180) # Gold border
        
    # Rocket Shape (Centered)
    # Rocket body: triangle / ellipse pointing up-right (45 deg)
    rx = (nx - ny) / 1.414
    ry = (nx + ny) / 1.414
    
    # Central fuselage
    in_fuselage = (abs(rx) < 0.22 * (1.0 - (ry + 0.3) * 0.8)) and (ry > -0.55 and ry < 0.55)
    # Nose cone
    in_nose = (ry <= -0.45 and (rx*rx*8 + (ry+0.45)*(ry+0.45)*16 < 0.15))
    # Wings
    in_wings = (ry > 0.15 and ry < 0.55 and abs(rx) < 0.55 * (ry - 0.15))
    
    if in_fuselage or in_nose:
        # Gold gradient
        gold_factor = (ry + 0.5)
        r = int(251 - gold_factor * 30)
        g = int(191 - gold_factor * 50)
        b = int(36)
        return (r, g, b, 255)
    elif in_wings:
        # Emerald wing accent
        return (16, 185, 129, 255)
        
    # Flame exhaust at bottom (ry > 0.55)
    if ry >= 0.55 and ry < 0.85 and abs(rx) < 0.18 * (1.0 - (ry - 0.55) / 0.3):
        return (239, 68, 68, 255) # Red-orange flame
        
    # Stars background
    if (abs(nx - 0.5) < 0.03 and abs(ny + 0.5) < 0.03) or (abs(nx + 0.6) < 0.03 and abs(ny - 0.4) < 0.03):
        return (255, 255, 255, 220)

    return (bg_r, bg_g, bg_b, 255)

os.makedirs('icons', exist_ok=True)

with open('icons/icon-192.png', 'wb') as f:
    f.write(create_png(192, 192, draw_icon))

with open('icons/icon-512.png', 'wb') as f:
    f.write(create_png(512, 512, draw_icon))

print("Successfully generated icons/icon-192.png and icons/icon-512.png")
