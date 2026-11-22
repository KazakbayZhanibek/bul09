"""Bake a tile of single-jersey knit for the field tee (Python, NumPy, Pillow)."""
from pathlib import Path

import numpy as np
from PIL import Image


SIZE = 512
WALES = 38
COURSES = 48
OUTPUT = Path(__file__).resolve().parents[1] / 'assets' / 'models'


def bake():
    rng = np.random.default_rng(82173)
    y, x = np.mgrid[:SIZE, :SIZE] / SIZE
    frequencies = np.fft.fftfreq(SIZE) * SIZE
    kx, ky = np.meshgrid(frequencies, frequencies)

    def field(horizontal, vertical):
        # All perturbations share the tile period, including the tilted yarn nap.
        spectrum = np.fft.fft2(rng.standard_normal((SIZE, SIZE)))
        falloff = np.exp(-0.5 * ((kx / horizontal) ** 2 + (ky / vertical) ** 2))
        result = np.fft.ifft2(spectrum * falloff).real
        return (result - result.mean()) / result.std()

    wale = x * WALES + 0.068 * field(3, 5) + 0.029 * field(9, 15)
    course = y * COURSES + 0.062 * field(3, 4) + 0.029 * field(16, 7)
    u = (wale + 0.5) % 1 - 0.5
    v = (course + 0.5) % 1 - 0.5
    yarn_weight = np.clip(field(7, 10), -2.3, 2.3)
    thickness = 0.142 + 0.011 * yarn_weight
    height = np.zeros_like(x)

    # The two inclined legs emerge from beneath the crown of the next course.
    # Thickness and twist vary continuously along the yarn, even across the seam.
    for row in (-1, 0, 1):
        vy = v + row
        along = np.clip((vy + 0.48) / 1.02, 0, 1)
        for side in (-1, 1):
            center = side * (0.395 - 0.307 * along + 0.026 * np.sin(np.pi * 2 * along))
            dx = (u - center) * 1.1
            dy = vy + 0.48 - 1.02 * along
            strand = np.exp(-0.5 * (dx * dx + dy * dy) / thickness ** 2)
            twist = 0.034 * np.sin(2 * np.pi * (3.2 * along + side * dx * 5 + 0.12 * yarn_weight))
            height = np.maximum(height, strand * (0.81 + 0.19 * np.sin(np.pi * along) + twist))
        crown_y = -0.46 + 0.09 * (abs(u) / 0.38) ** 1.5
        crown_distance = (vy - crown_y) ** 2 + np.maximum(abs(u) - 0.34, 0) ** 2
        height = np.maximum(height, 0.5 * np.exp(-0.5 * crown_distance / 0.123 ** 2))

    # Sparse thicker sections and fibre bundles along/across the yarn give the
    # stochastically dyed cotton variation at intermediate viewing distances.
    slub = np.tanh(field(1.7, 33) * 0.8) + 0.51 * np.tanh(field(20, 2.4))
    flake = field(56, 24)
    nap = field(150, 67)
    height += 0.035 * slub + 0.028 * flake + 0.015 * nap
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / 2
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / 2
    normals = np.stack((-1.12 * dx, 1.12 * dy, np.ones_like(height)), axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)

    # Dye is sRGB encoded by the image. Cotton roughness and normals are linear.
    # The neutral dye tile is multiplied by the selected garment colour in glTF.
    dye = 226.5 + 17.0 * (height - height.mean()) + 4.0 * slub + 3.0 * flake + 2.3 * nap
    roughness = 0.95 - 0.043 * height + 0.011 * slub + 0.012 * flake
    maps = {
        'normal': (normals * 0.5 + 0.5) * 255,
        'dye': dye,
        'roughness': np.clip(roughness, 0.835, 0.988) * 255,
    }
    for name, pixels in maps.items():
        quantized = np.rint(np.clip(pixels, 0, 255)).astype(np.uint8)
        Image.fromarray(quantized).save(OUTPUT / f'jersey-v2-{name}.png', optimize=True)


if __name__ == '__main__':
    bake()
